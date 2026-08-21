import { VideoExtractor } from './VideoExtractor.js';

/**
 * Is this an absolute http(s) target? Anything else (mailto:, a relative fragment,
 * an unparseable string) is not something the probe could ever fetch.
 * @param {string|undefined} url
 * @returns {boolean}
 */
export function isHttpUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The catch-all for a Moodle `url` module: any off-site http(s) link no host-specific extractor
 * claimed. Nothing about the WS payload says what it is, so it lists as an Unknown row and the
 * download-time `probeUrl` decides — a link with an unhelpful title is visible and honest
 * instead of silently dropped. Registered LAST in EXTRACTORS, so YouTube and Drive keep their
 * own targets. Not expandable and needs no browser.
 */
export class DirectUrlExtractor extends VideoExtractor {
  /** Recording.strategy this extractor produces — used to route echoed-back recordings. */
  get strategy() {
    return 'direct-url';
  }

  /**
   * Claim any `url` module with a fetchable http(s) target. The registry's first-match-wins
   * order is the whole "no earlier extractor wanted it" check — this one is last.
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {boolean}
   */
  canHandle(activity) {
    return activity.modType === 'url' && isHttpUrl(activity.externalUrl);
  }

  /**
   * One row of unknown type — `pageUrl` is the direct external target the probe reads.
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {import('./VideoExtractor.js').Recording[]}
   */
  toRecordings(activity) {
    return [
      {
        title: activity.title,
        pageUrl: activity.externalUrl,
        kind: activity.kind,
        strategy: 'direct-url',
        section: activity.sectionName,
      },
    ];
  }
}
