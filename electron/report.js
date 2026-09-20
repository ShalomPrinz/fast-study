// The error report's `mailto:` composition — pure string work, kept out of main.js to be testable.

const REPORT_RECIPIENT = 'fast-study-reports@googlegroups.com';
// The Windows shell caps a mailto near 2KB, so the body is trimmed to fit the *encoded* URL under
// this; the rest of the report rides in the file whose path the body names.
const MAILTO_LIMIT = 1800;

/** Unpaired surrogates replaced: `encodeURIComponent` throws `URIError: URI malformed` on one, and a
 *  crash message that carries half an emoji must still be mailable. */
function pairedOnly(text) {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '�',
  );
}

function mailtoUrl(subject, body) {
  const q = (text) => encodeURIComponent(pairedOnly(text));
  return `mailto:${REPORT_RECIPIENT}?subject=${q(subject)}&body=${q(body)}`;
}

/** A prefix of `body`, never ending mid-surrogate-pair — so a cut lands between emoji, not inside one. */
function cut(body, length) {
  const text = body.slice(0, length);
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text;
}

/** Trim the body until the *encoded* URL fits the limit. Binary search rather than a character
 *  budget: escaping is 1–6 characters each, so Hebrew and ASCII bodies have no common ratio. */
function fitBody(subject, body) {
  const marker = '\n[truncated — see the attached report]';
  if (mailtoUrl(subject, body).length <= MAILTO_LIMIT) return body;
  let low = 0;
  let high = body.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (mailtoUrl(subject, cut(body, mid) + marker).length <= MAILTO_LIMIT) low = mid;
    else high = mid - 1;
  }
  return cut(body, low) + marker;
}

module.exports = { MAILTO_LIMIT, REPORT_RECIPIENT, cut, fitBody, mailtoUrl, pairedOnly };
