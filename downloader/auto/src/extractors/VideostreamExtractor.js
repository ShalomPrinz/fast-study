import { VideoExtractor } from './VideoExtractor.js';

/**
 * Moodle `videostream` plugin module: an in-site recorded lecture behind its own view.php page.
 * Listing is metadata-only; core.js's resolveVideostream reads the .mp4 from the plugin's Moodle-app
 * handler at download time, so this extractor never captures.
 */
export class VideostreamExtractor extends VideoExtractor {
  /** Recording.strategy this extractor produces — used to route echoed-back recordings. */
  get strategy() {
    return 'videostream';
  }

  /**
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {boolean}
   */
  canHandle(activity) {
    return activity.modType === 'videostream';
  }

  // The resolve is a WS call to Moodle.
  reachesMoodle() {
    return true;
  }

  /**
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {import('./VideoExtractor.js').Recording[]}
   */
  toRecordings(activity) {
    return [
      {
        title: activity.title,
        pageUrl: activity.viewUrl,
        kind: activity.kind,
        strategy: 'videostream',
        section: activity.sectionName,
        courseId: activity.courseId,
      },
    ];
  }
}
