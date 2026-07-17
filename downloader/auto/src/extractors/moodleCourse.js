/**
 * @typedef {import('./VideoExtractor.js').Activity} Activity
 */

// Hints (case-insensitive) marking an activity as a recitation, not a lecture.
// (Hebrew: תרגול/תרגיל = recitation; תרגולים contains תרגול so it matches too.)
const RECITATION_KEYWORDS = ['תרגולים', 'תרגול', 'תרגיל', 'recitation', 'tirgul'];

// Hints that a `url` module is a recording playlist, not an unrelated link (syllabus,
// reading, drive folder). (Hebrew: הקלטות/הקלטה = recordings; הרצאות/הרצאה = lectures.)
const RECORDING_KEYWORDS = ['הקלטות', 'הרצאות', 'הקלטה', 'הרצאה', 'recording', 'lecture', ...RECITATION_KEYWORDS];

/**
 * Section name / title text ⇒ activity kind. Defaults to 'lecture' when no
 * recitation hint is present (per the course-example guidance).
 * @param {string} sectionName
 * @param {string} title
 * @returns {'lecture'|'recitation'}
 */
export function classifyKind(sectionName, title) {
  const hay = `${sectionName} ${title}`.toLowerCase();
  return RECITATION_KEYWORDS.some((k) => hay.includes(k.toLowerCase())) ? 'recitation' : 'lecture';
}

/**
 * Does this activity's section heading OR title mark it as a recording?
 * @param {string} sectionName
 * @param {string} title
 * @returns {boolean}
 */
// Allow-list gating which `url` modules are treated as recordings — considers the
// owning section heading AND the activity's own title.
export function isRecording(sectionName, title) {
  const hay = `${sectionName} ${title}`.toLowerCase();
  return RECORDING_KEYWORDS.some((k) => hay.includes(k.toLowerCase()));
}

// Bounded wait for the first activity card (covers slow AJAX; empty course won't hang).
const ACTIVITY_WAIT_MS = 10_000;

// Per-section wait for content to appear after its tile is clicked.
const TILE_CONTENT_WAIT_MS = 4_000;

/**
 * format_tiles injects each section's body (activities AND summary) into the DOM only
 * when its tile is clicked, so an unexpanded course parses as empty — click every tile
 * first. No-op on other formats; best-effort per tile; already-loaded sections skipped.
 * See docs/BROWSING.md.
 * @param {import('playwright').Page} page
 */
export async function expandTiles(page) {
  const isTiles = await page
    .$('body.format-tiles, .format-tiles, .format-tiles-cm-list')
    .then((el) => !!el)
    .catch(() => false);
  if (!isTiles) return;

  // Section numbers carried on tiles / section stubs (section 0 is the always-open
  // "general" section — no tile to click).
  const nums = await page
    .$$eval('[data-section]', (els) =>
      [...new Set(els.map((e) => e.getAttribute('data-section')))].filter((s) => /^[1-9]\d*$/.test(s)),
    )
    .catch(() => []);

  for (const n of nums) {
    const contentSel = `#section-${n} .no-overflow, #section-${n} li.activity`;
    if (await page.$(contentSel).catch(() => null)) continue; // already loaded
    const tile = await page
      .$(`#tile-${n}, li.tile[data-section="${n}"], .tile[data-section="${n}"]`)
      .catch(() => null);
    if (!tile) continue;
    await tile.click({ timeout: 2000 }).catch(() => {});
    await page.waitForSelector(contentSel, { timeout: TILE_CONTENT_WAIT_MS }).catch(() => {});
  }
}

/**
 * Per-LMS enumerator: pure DOM walk of every `li.activity` (any module type), no sniff.
 * A bounded waitForSelector first (some Moodle 4.x hosts inject cards after `load`);
 * on timeout parse anyway and return []. Routing to extractors is the caller's job.
 * @param {import('playwright').Page} page
 * @returns {Promise<Activity[]>}  in document order
 */
export async function parseMoodleCourse(page) {
  await page.waitForSelector('li.activity', { timeout: ACTIVITY_WAIT_MS }).catch(() => {});
  const raw = await page.$$eval('li.activity', (items) =>
    items.map((li) => {
      // modType from the `modtype_<x>` class token (e.g. modtype_videostream → 'videostream').
      const modClass = [...li.classList].find((c) => c.startsWith('modtype_'));
      const modType = modClass ? modClass.slice('modtype_'.length) : '';

      const card = li.querySelector('.activity-item[data-region="activity-card"]');
      // .instancename embeds a nested .accesshide span (e.g. "שילוב סרטון") — strip
      // it so the fallback title is just the visible name, not the a11y suffix.
      let instanceName = '';
      const nameEl = li.querySelector('.instancename');
      if (nameEl) {
        const clone = nameEl.cloneNode(true);
        clone.querySelectorAll('.accesshide').forEach((n) => n.remove());
        instanceName = clone.textContent.trim();
      }
      const title = (card?.getAttribute('data-activityname') || instanceName).trim();

      const link = li.querySelector('a.aalink[href]');
      const viewUrl = link ? link.href : ''; // .href is absolute

      const section = li.closest('li.section[data-sectionname]');
      const sectionName = section?.getAttribute('data-sectionname') || '';

      return { title, modType, viewUrl, sectionName };
    }),
  );

  return raw
    .filter((a) => a.viewUrl)
    .map((a) => ({ ...a, kind: classifyKind(a.sectionName, a.title) }));
}
