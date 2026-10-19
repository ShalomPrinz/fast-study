import { classifyKind } from './moodleCourse.js';
import { decodeEntities, stripTags } from '../lib/html.js';

/**
 * @typedef {import('../extractors/VideoExtractor.js').Activity} Activity
 */

// Zoom share link in an <a href> or bare text; \s stops the tail before a trailing &nbsp;/Passcode.
const ZOOM_RE = /https?:\/\/[^\s"'<>]*zoom\.us\/rec\/share\/[^\s"'<>]+/g;
// Number label preceding a link. Longer wording first so a shorter prefix can't shadow it.
const LABEL_RE = /(?:הרצאה\s+מספר|הרצאה|שיעור|תרגול|תרגיל)\s*(\d+)/;
// A paragraph that is only a kind word, no number ('תרגול:') — the week heading carries the number.
const KIND_WORD_RE = /^(?:הרצאה|שיעור|תרגול|תרגיל|lecture|recitation|tutorial)\s*[:.\-–—]?$/i;
// Week heading ('שבוע 1:', 'Week 2') prefixed to every label under it until the next one.
const WEEK_RE = /^(?:שבוע|week)\s*\d+\b/i;
// Any other label: a short line ending in ':' right before a link ('חזרה למבחן:'). The length cap
// (also on week headings) keeps a prose paragraph from becoming a title.
const MAX_LINE = 40;
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
 * paragraphs tracking the latest week heading (`שבוע N`) and kind label (`הרצאה מספר N`, a bare
 * `תרגול:`, or a short `…:` line just before a link), title each `zoom.us/rec/share` link
 * `<week> – <label>` and emit one synthetic `modType:'zoom'` activity per link, deduped by share token.
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

    let week = '';
    let label = '';
    let pending = ''; // free `…:` label, kept only if the next non-empty paragraph is a link
    // Split on the whole opening <p …> tag so each chunk is one paragraph's inner HTML, in
    // document order — a label paragraph titles the link paragraphs that follow it.
    for (const paragraph of summary.split(/<p\b[^>]*>/i)) {
      const text = stripTags(paragraph);

      // Links from anchors AND bare text, deduped by share token (the <a href> and its
      // identical visible text would otherwise both count for the first lecture).
      const urls = anchorShareUrls(paragraph);
      const textMatches = text.match(ZOOM_RE);
      if (textMatches) urls.push(...textMatches);

      if (urls.length === 0) {
        // Not a link paragraph — remember a heading or label for the following link(s).
        if (!text) continue;
        pending = '';
        if (LABEL_RE.test(text) || KIND_WORD_RE.test(text)) label = trimLabel(text);
        else if (WEEK_RE.test(text) && text.length <= MAX_LINE) {
          week = trimLabel(text);
          label = '';
        } else if (text.endsWith(':') && text.length <= MAX_LINE) pending = trimLabel(text);
        continue;
      }
      if (pending) label = pending;
      pending = '';
      // A numbered label carries its own number, so it stands alone: prefixing the week would put
      // the week's number first, and the frontend names the row by the first number in the title.
      const title = week && label && !LABEL_RE.test(label) ? `${week} – ${label}` : label || week;

      const seen = new Set();
      for (const url of urls) {
        const key = shareKey(url);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({
          modType: 'zoom',
          title,
          pageUrl: url,
          sectionName,
          kind: classifyKind(sectionName, title),
        });
      }
    }
  }
  return out;
}
