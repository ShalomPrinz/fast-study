import { VideoExtractor } from './VideoExtractor.js';
import { isRecording } from '../discovery/moodleCourse.js';
import { getProbe } from '../core/probeCache.js';
import { probeKeyForUrl } from '../lib/probeUrl.js';
import { onMoodleHost } from '../moodle/site.js';

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
 * claimed, listed as Unknown until the download-time `probeUrl` decides. Registered LAST.
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

  // Only a link on the Moodle host, or one the probe saw redirect there, is Moodle traffic. Before
  // any probe an off-site link that redirects to Moodle reads false — the gate still catches it.
  reachesMoodle(recording) {
    const finalUrl = getProbe(probeKeyForUrl(recording.pageUrl))?.finalUrl;
    return onMoodleHost(recording.pageUrl) || Boolean(finalUrl && onMoodleHost(finalUrl));
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
        likelyRecording: isRecording(activity.sectionName, activity.title),
      },
    ];
  }
}
