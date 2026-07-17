/**
 * @typedef {import('./VideoExtractor.js').Activity} Activity
 */

// Section-name / title hints that mark an activity as a recitation rather than a
// lecture. Extend as new wordings show up; matched case-insensitively.
// (Hebrew: תרגול / תרגיל = recitation; "tirgul" is the transliteration. Note
// תרגולים — "recitations" — contains תרגול, so it matches.)
const RECITATION_KEYWORDS = ['תרגולים', 'תרגול', 'תרגיל', 'recitation', 'tirgul'];

// Section-name / title hints that a `url` module is a recording playlist rather
// than an unrelated link (syllabus, reading, drive folder). Matched
// case-insensitively. (Hebrew: הקלטות/הקלטה = recordings; הרצאות/הרצאה = lectures;
// תרגולים/תרגול = recitations.)
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

// Bounded wait for the first activity card. Long enough to cover a slow AJAX
// render, short enough that a legitimately-empty course doesn't hang the request.
const ACTIVITY_WAIT_MS = 10_000;

// Per-section wait for content to appear after its tile is clicked.
const TILE_CONTENT_WAIT_MS = 4_000;

/**
 * On format_tiles courses each section's body (activities AND summary — where the
 * zoom-share links live) is injected into the DOM only when its tile is clicked;
 * an unexpanded course parses as empty ("No recordings found"). Click every tile
 * once so all section content is present before parsing.
 *
 * No-op on other course formats (guarded by the format_tiles marker). Every click
 * and wait is best-effort — a single stubborn tile must not abort discovery — and
 * a section whose body is already present is skipped (clicking would just re-toggle
 * visibility; the content stays in the DOM either way, so the parser still sees it).
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
 * Per-LMS enumerator for a Moodle course page: walk every `li.activity` and
 * produce the activities present, regardless of module type. Pure DOM parse of
 * all sections (Moodle renders even visually-collapsed ones), no network sniff.
 * A bounded waitForSelector first, because some Moodle 4.x hosts inject the
 * activity cards after the `load` event — a bare $$eval would race and see zero.
 * On timeout (a genuinely empty course) we parse anyway and return []. Routing
 * each Activity to an extractor (and skipping unhandled types) is the caller's job.
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
