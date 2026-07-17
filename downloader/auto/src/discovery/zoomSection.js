import { classifyKind } from './moodleCourse.js';

/**
 * @typedef {import('../extractors/VideoExtractor.js').Activity} Activity
 */

// Bounded wait for one section. format_tiles renders every `.summary` up front and
// toggles visibility via CSS, so parsing all `li.section` sees every tile's content.
const SECTION_WAIT_MS = 5_000;

/**
 * Discover zoom-share recordings in course section summaries: walk each summary's `<p>`s
 * tracking the most recent `הרצאה מספר N` label, emit one synthetic `modType:'zoom'`
 * activity per `zoom.us/rec/share` link. Passcode text is ignored (docs/ZOOM.md).
 * @param {import('playwright').Page} page
 * @returns {Promise<Activity[]>}  in document order
 */
export async function parseZoomSections(page) {
  await page.waitForSelector('li.section', { timeout: SECTION_WAIT_MS }).catch(() => {});

  const raw = await page.$$eval('li.section', (sections) => {
    // Zoom share link in <a href> or bare text; \s stops the tail before the trailing &nbsp;/Passcode.
    const ZOOM_RE = /https?:\/\/[^\s"'<>]*zoom\.us\/rec\/share\/[^\s"'<>]+/g;
    // Number label preceding a link. Longer wording first so a shorter prefix can't shadow it.
    const LABEL_RE = /(?:הרצאה\s+מספר|הרצאה|שיעור|תרגול|תרגיל)\s*(\d+)/;
    const shareKey = (u) => (u.split('/rec/share/')[1] || '').split(/[?#]/)[0];

    const out = [];
    for (const section of sections) {
      const noOverflow = section.querySelector('.summary .no-overflow');
      if (!noOverflow) continue;

      const sectionName =
        section.getAttribute('data-sectionname') ||
        section.querySelector('.sectiontitle h2, .sectiontitle h3, h2, h3')?.textContent.trim() ||
        '';

      let label = '';
      for (const p of noOverflow.querySelectorAll('p')) {
        const text = p.textContent || '';

        // Links from anchors AND bare text, deduped by share token (the <a href> and its
        // identical text would otherwise both count for the first lecture).
        const urls = [];
        p.querySelectorAll('a[href*="zoom.us/rec/share"]').forEach((a) => urls.push(a.href));
        const textMatches = text.match(ZOOM_RE);
        if (textMatches) urls.push(...textMatches);

        if (urls.length === 0) {
          // Not a link paragraph — if it names a lecture number, remember it as
          // the label for the following link(s).
          if (LABEL_RE.test(text)) label = text.trim();
          continue;
        }

        const seen = new Set();
        for (const url of urls) {
          const key = shareKey(url);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push({ shareUrl: url, title: label, sectionName });
        }
      }
    }
    return out;
  });

  // classifyKind is a Node module (reused from moodleCourse.js — do NOT fork the
  // recitation keyword list), so kind is assigned here rather than in the browser.
  return raw.map((r) => ({
    modType: 'zoom',
    title: r.title,
    pageUrl: r.shareUrl,
    sectionName: r.sectionName,
    kind: classifyKind(r.sectionName, r.title),
  }));
}
