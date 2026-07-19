// The WS API returns section/module names and summaries as HTML strings, so any value
// destined for display or keyword matching has to be flattened to plain text first.

// Decode the handful of entities Moodle emits in hrefs/text — an &amp; inside a share
// URL's query would otherwise break the link the DOM parser saw decoded.
export function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// What textContent would have given: tag-stripped, entity-decoded, whitespace-collapsed.
export function stripTags(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
