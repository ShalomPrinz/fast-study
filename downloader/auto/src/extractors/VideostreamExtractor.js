import { VideoExtractor } from './VideoExtractor.js';

/**
 * BIU Moodle `videostream` module: recorded lectures hosted in-site, each behind
 * its own /mod/videostream/view.php page. Listing is metadata-only (the parser
 * already did the DOM walk); the .mp4 lives on the view.php page and is a
 * download-phase concern (see captureVideo).
 */
export class VideostreamExtractor extends VideoExtractor {
  /**
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {boolean}
   */
  canHandle(activity) {
    return activity.modType === 'videostream';
  }

  /**
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {import('./VideoExtractor.js').Recording[]}
   */
  toRecordings(activity) {
    return [{ title: activity.title, pageUrl: activity.viewUrl, kind: activity.kind, strategy: 'videostream' }];
  }

  /**
   * DOWNLOAD PHASE (later).
   * @param {import('playwright').Page} page
   * @param {import('./VideoExtractor.js').Recording} rec
   * @returns {Promise<import('./VideoExtractor.js').VideoCapture>}
   */
  async captureVideo(page, rec) {
    // TODO(download phase): register a .mp4 sniffer on the context, navigate
    // rec.pageUrl (the view.php page), trigger playback if needed, capture the
    // first .mp4 request's url + request.headers() (live Referer/Origin/token —
    // short-lived, so grabbed fresh here), and POST server.js /download.
    throw new Error('VideostreamExtractor.captureVideo not implemented (download phase)');
  }
}
