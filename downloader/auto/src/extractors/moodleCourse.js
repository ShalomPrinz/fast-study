/**
 * @typedef {import('./VideoExtractor.js').Activity} Activity
 */

// Section-name / title hints that mark an activity as a recitation rather than a
// lecture. Extend as new wordings show up; matched case-insensitively.
// (Hebrew: תרגול / תרגיל = recitation; "tirgul" is the transliteration. Note
// תרגולים — "recitations" — contains תרגול, so it matches.)
const RECITATION_KEYWORDS = ['תרגול', 'תרגיל', 'recitation', 'tirgul'];

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

// Bounded wait for the first activity card. Long enough to cover a slow AJAX
// render, short enough that a legitimately-empty course doesn't hang the request.
const ACTIVITY_WAIT_MS = 10_000;

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
