/**
 * One `li.activity` from the Moodle course page (produced by the course parser).
 * @typedef {{ title: string, modType: string, viewUrl: string,
 *             sectionName: string, kind: 'lecture'|'recitation' }} Activity
 *
 * A listed recording — cheap metadata + which download strategy resolves it.
 * @typedef {{ title: string, pageUrl: string, kind: 'lecture'|'recitation',
 *             strategy: 'videostream'|'youtube-playlist' }} Recording
 *
 * A recording resolved for download — url = the .mp4 (videostream) or a YouTube
 * URL (playlist entry). Shape maps straight onto server.js's download endpoints.
 * @typedef {{ title: string, url: string, headers?: Record<string, string>,
 *             kind: string }} VideoCapture
 */

/**
 * Per-activity extraction strategy, selected by auto-detection (`canHandle`), not
 * by university or course page. Named by the mechanism/player it handles
 * (VideostreamExtractor, YoutubePlaylistExtractor, …). The per-LMS course parser
 * enumerates activities; each is routed to the extractor whose canHandle matches.
 */
export class VideoExtractor {
  /**
   * Does this strategy handle this activity? Keys off the Moodle module type
   * (and, for redirects, the resolved target host at download time). Sync + cheap.
   * @param {Activity} activity
   * @returns {boolean}
   */
  canHandle(activity) {
    throw new Error('not implemented');
  }

  /**
   * Turn one handled activity into its listed recording(s). Cheap — no navigation
   * (a YouTube playlist is listed as ONE unexpanded entry; it expands at download).
   * @param {Activity} activity
   * @returns {Recording[]}
   */
  toRecordings(activity) {
    throw new Error('not implemented');
  }

  /**
   * DOWNLOAD PHASE (later): resolve one Recording to a downloadable video.
   *  - videostream: navigate pageUrl, sniff the .mp4 (url + live headers) fresh
   *    (tokens are short-lived) → POST server.js /download.
   *  - youtube-playlist: navigate `…&redirect=1`, confirm YouTube, list entries
   *    (yt-dlp --flat-playlist), user picks one → POST server.js /download-youtube.
   * @param {import('playwright').Page} page
   * @param {Recording} rec
   * @returns {Promise<VideoCapture>}
   */
  async captureVideo(page, rec) {
    throw new Error('not implemented');
  }
}
