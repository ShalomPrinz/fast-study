import { classifyKind } from './moodleCourse.js';

/**
 * @typedef {import('./VideoExtractor.js').Activity} Activity
 */

// Bounded wait for at least one section to render. format_tiles renders every
// section's `.summary` into the DOM up front and toggles visibility via CSS/JS,
// so parsing all `li.section` (regardless of the `state-visible` class) is the
// cheapest path that sees every tile's content — no per-tile click / navigation.
// ASSUMPTION (untestable here, no live site): summaries are NOT lazy-loaded on
// tile click. If a host is found that lazy-loads them, add a fallback that clicks
// each tile or `goto`s its `section.php?id=<data-true-sectionid>` before parsing.
const SECTION_WAIT_MS = 5_000;

/**
 * Discover zoom-share recordings sitting inside a course section's summary.
 *
 * A section summary (`li.section .summary .no-overflow`) holds repeated
 * `הרצאה מספר N:` labels, each followed by a `<p>` with a
 * `zoom.us/rec/share/…` link (as an `<a href>` OR bare text) plus a trailing
 * `Passcode: …`. We walk each summary's `<p>`s in order, tracking the most
 * recent label, and emit one synthetic `modType:'zoom'` activity per link.
 * `passcode` rides on the activity (ZoomExtractor.toRecordings reads it) and
 * must never leave the service except inside the opaque `ref`.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Activity[]>}  in document order
 */
export async function parseZoomSections(page) {
  await page.waitForSelector('li.section', { timeout: SECTION_WAIT_MS }).catch(() => {});

  const raw = await page.$$eval('li.section', (sections) => {
    // A zoom recording share link — matched both in <a href> and bare page text.
    // \s excludes   (the trailing &nbsp; the site emits after each URL), so
    // the tail stops cleanly before "Passcode:".
    const ZOOM_RE = /https?:\/\/[^\s"'<>]*zoom\.us\/rec\/share\/[^\s"'<>]+/g;
    // Number label preceding a link: "הרצאה מספר N" / "הרצאה N" / "שיעור N" /
    // "תרגול N". Longer wording first so it isn't shadowed by a shorter prefix.
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

        // Collect links in this <p> from anchors AND bare text, deduped by the
        // share token (the <a href> and its identical text would otherwise both
        // count for the first lecture, which uses a real anchor).
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

        const pcMatch = text.match(/Passcode:\s*(\S+)/i);
        const passcode = pcMatch ? pcMatch[1] : '';
        const seen = new Set();
        for (const url of urls) {
          const key = shareKey(url);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push({ shareUrl: url, title: label, passcode, sectionName });
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
    passcode: r.passcode,
    sectionName: r.sectionName,
    kind: classifyKind(r.sectionName, r.title),
  }));
}
