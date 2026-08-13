import { classifyKind } from './moodleCourse.js';
import { decodeEntities, stripTags } from '../lib/html.js';

/**
 * @typedef {import('../extractors/VideoExtractor.js').Activity} Activity
 */

// Zoom share link in an <a href> or bare text; \s stops the tail before a trailing &nbsp;/Passcode.
const ZOOM_RE = /https?:\/\/[^\s"'<>]*zoom\.us\/rec\/share\/[^\s"'<>]+/g;
// Number label preceding a link. Longer wording first so a shorter prefix can't shadow it.
const LABEL_RE = /(?:הרצאה\s+מספר|הרצאה|שיעור|תרגול|תרגיל)\s*(\d+)/;
// href value of any anchor (both quote styles), captured for a zoom.us/rec/share filter.
const ANCHOR_HREF_RE = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi;
const shareKey = (u) => (u.split('/rec/share/')[1] || '').split(/[?#]/)[0];
// The paragraph is used verbatim as the row title, so drop the punctuation that only
// separated it from the link that followed ('הרצאה מספר 1:' -> 'הרצאה מספר 1').
const trimLabel = (text) => text.replace(/[\s:.,;\-–—]+$/, '');

function anchorShareUrls(paragraph) {
  const out = [];
  for (const m of paragraph.matchAll(ANCHOR_HREF_RE)) {
    const href = decodeEntities(m[2]);
    if (href.includes('zoom.us/rec/share')) out.push(href);
  }
  return out;
}

/**
 * Discover zoom-share recordings in the WS `section.summary` HTML: walk each summary's
 * paragraphs tracking the most recent `הרצאה מספר N` label, emit one synthetic
 * `modType:'zoom'` activity per `zoom.us/rec/share` link. Same regex + label-precedes-link
 * + dedup-by-share-token logic the DOM parser ran, but over the summary string in Node.
 * Passcode text is ignored (docs/ZOOM.md).
 * @param {Array<{ name?: string, summary?: string }>} sections  core_course_get_contents result
 * @returns {Activity[]}  in document order
 */
export function parseZoomSummaries(sections) {
  const out = [];
  for (const section of sections ?? []) {
    const summary = section?.summary;
    if (typeof summary !== 'string' || !summary) continue;
    const sectionName = stripTags(section.name || '');

    let label = '';
    // Split on the whole opening <p …> tag so each chunk is one paragraph's inner HTML —
    // preserves the ordering the DOM's querySelectorAll('p') walk relied on to title links.
    for (const paragraph of summary.split(/<p\b[^>]*>/i)) {
      const text = stripTags(paragraph);

      // Links from anchors AND bare text, deduped by share token (the <a href> and its
      // identical visible text would otherwise both count for the first lecture).
      const urls = anchorShareUrls(paragraph);
      const textMatches = text.match(ZOOM_RE);
      if (textMatches) urls.push(...textMatches);

      if (urls.length === 0) {
        // Not a link paragraph — if it names a lecture number, remember it as the
        // label for the following link(s).
        if (LABEL_RE.test(text)) label = trimLabel(text);
        continue;
      }

      const seen = new Set();
      for (const url of urls) {
        const key = shareKey(url);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({
          modType: 'zoom',
          title: label,
          pageUrl: url,
          sectionName,
          kind: classifyKind(sectionName, label),
        });
      }
    }
  }
  return out;
}
