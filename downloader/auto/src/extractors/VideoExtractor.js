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
   * Which browser profile this extractor's captureVideo needs (dependency injection
   * for the session registry). Default 'plain' = headless bundled Chromium; the zoom
   * player needs 'zoom' (chrome+stealth+Xvfb). @returns {'plain'|'zoom'}
   */
  get browserProfile() {
    return 'plain';
  }

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
   * DOWNLOAD PHASE (template method — do NOT override; subclasses implement
   * `_captureVideo`): resolve one Recording to a downloadable video, then ALWAYS
   * stop any playback the sniff left running. Keeping the stop step here (not in
   * each subclass) makes it apply to every extractor / browser profile.
   * @param {import('playwright').Page} page
   * @param {Recording} rec
   * @returns {Promise<VideoCapture|VideoCapture[]>}
   */
  async captureVideo(page, rec) {
    try {
      return await this._captureVideo(page, rec);
    } finally {
      await this.stopPlayback(page);
    }
  }

  /**
   * Resolve one Recording to a downloadable video (implemented per strategy).
   *  - videostream: navigate pageUrl, sniff the .mp4 (url + live headers) fresh
   *    (tokens are short-lived) → POST server.js /download.
   *  - youtube-playlist: expansion (navigate `…&redirect=1`, confirm YouTube,
   *    list entries via yt-dlp --flat-playlist) is handled by listEntries and the
   *    /list/expand endpoint, so this template isn't used for youtube recordings.
   * @param {import('playwright').Page} page
   * @param {Recording} rec
   * @returns {Promise<VideoCapture|VideoCapture[]>}
   */
  async _captureVideo(page, rec) {
    throw new Error('not implemented');
  }

  // Recordings autoplay so the .mp4 request fires; on the long-lived session page a
  // captured recording would otherwise keep streaming in the background afterward.
  // Pause every <video> once capture is done (best-effort; a detached page is fine).
  async stopPlayback(page) {
    await page
      .evaluate(() => {
        for (const v of document.querySelectorAll('video')) {
          try {
            v.pause();
          } catch {}
        }
      })
      .catch(() => {});
  }
}
