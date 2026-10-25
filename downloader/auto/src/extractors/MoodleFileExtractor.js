import { VideoExtractor } from './VideoExtractor.js';
import { isAudioFile } from '../lib/fileMedia.js';

/**
 * Moodle `resource` module file — a course-hosted file of any type but audio or video that lands as one of the lecture's
 * materials. No capture phase: the WS token makes `fileurl` a plain URL `server/` fetches.
 */
export class MoodleFileExtractor extends VideoExtractor {
  /** Recording.strategy this extractor produces — used to route echoed-back recordings. */
  get strategy() {
    return 'moodle-file';
  }

  /**
   * Claim every resource except video (too large for a material), audio (not a material) and HTML
   * (indistinguishable from a block page at preflight).
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {boolean}
   */
  canHandle(activity) {
    if (activity.modType !== 'resource') return false;
    const mime = String(activity.mimetype ?? '').toLowerCase();
    if (mime.startsWith('video/') || mime === 'text/html') return false;
    return !isAudioFile(activity.mimetype, activity.filename);
  }

  // A course file: the preflight and every byte come from Moodle.
  reachesMoodle() {
    return true;
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
