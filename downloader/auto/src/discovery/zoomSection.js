import { classifyKind } from './moodleCourse.js';

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

// WS returns summaries as HTML strings, so &amp; in a share URL's query would break the
// link the DOM parser saw decoded. Decode the handful of entities Moodle emits in hrefs/text.
function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// The DOM parser read p.textContent; here that's the tag-stripped, entity-decoded,
// whitespace-collapsed paragraph text.
function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

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
    const sectionName = section.name || '';

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
        if (LABEL_RE.test(text)) label = text;
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
