import { VideoExtractor } from './VideoExtractor.js';

/**
 * Moodle `resource` module file — a course-hosted PDF that lands as one of the lecture's
 * materials. No capture phase: the WS token makes `fileurl` a plain URL `server/` fetches.
 */
export class MoodleFileExtractor extends VideoExtractor {
  /** Recording.strategy this extractor produces — used to route echoed-back recordings. */
  get strategy() {
    return 'moodle-file';
  }

  /**
   * Claim a resource file by mimetype alone — exact where a keyword is a guess, and a listed
   * grade-sheet PDF costs less than a missed slide deck.
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {boolean}
   */
  canHandle(activity) {
    return activity.modType === 'resource' && activity.mimetype === 'application/pdf';
  }

  /**
   * One downloadable file. `fileurl` rides along in the ref so /resolve rebuilds the
   * tokened URL from the ref alone, with no course re-listing.
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {import('./VideoExtractor.js').Recording[]}
   */
  toRecordings(activity) {
    return [
      {
        title: activity.title,
        fileurl: activity.fileurl,
        filename: activity.filename,
        kind: activity.kind,
        strategy: 'moodle-file',
        section: activity.sectionName,
      },
    ];
  }
}
