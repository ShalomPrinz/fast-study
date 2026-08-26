/**
 * One module from the Moodle WS course contents. `externalUrl` is the off-site target of
 * a `url` module (from contents[].fileurl) — the direct link a youtube playlist expands.
 * `fileurl`/`filename`/`mimetype` describe ONE file of a `resource` module (which can hold
 * several, hence one activity per file).
 * @typedef {{ title: string, modType: string, viewUrl: string, externalUrl?: string,
 *             fileurl?: string, filename?: string, mimetype?: string,
 *             sectionName: string, kind: 'lecture'|'recitation' }} Activity
 *
 * A listed recording — cheap metadata + which download strategy resolves it.
 * `section` is the Moodle course section heading (display metadata for grouping; '' when unnamed).
 * `likelyRecording` is the keyword hint (see `isRecording`); only a `url` module carries it, and
 * only the frontend's grouping reads it — nothing gates on it.
 * Every strategy but `moodle-file` carries a `pageUrl`; `moodle-file` carries the Moodle
 * `fileurl` the tokened download URL is built from instead.
 * @typedef {{ title: string, pageUrl?: string, fileurl?: string, filename?: string,
 *             kind: 'lecture'|'recitation',
 *             strategy: 'videostream'|'youtube-playlist'|'zoom'|'google-drive'|'moodle-file'|'direct-url',
 *             section: string, likelyRecording?: boolean }} Recording
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
   * DOWNLOAD PHASE template method (do NOT override; subclasses implement `_captureVideo`):
   * resolve one Recording to a downloadable video, then ALWAYS stop leftover playback.
   * @param {import('playwright').Page} page
   * @param {Recording} rec
   * @param {object} [opts]  strategy-specific options (e.g. zoom's `{ passcode }`); others ignore it
   * @returns {Promise<VideoCapture|VideoCapture[]>}
   */
  async captureVideo(page, rec, opts) {
    try {
      return await this._captureVideo(page, rec, opts);
    } finally {
      await this.stopPlayback(page);
    }
  }

  /**
   * Resolve one Recording to a downloadable video (per strategy). Not used by
   * youtube-playlist, which expands via listEntries + /list/expand instead.
   * @param {import('playwright').Page} page
   * @param {Recording} rec
   * @returns {Promise<VideoCapture|VideoCapture[]>}
   */
  async _captureVideo(page, rec) {
    throw new Error('not implemented');
  }

  // Pause every <video> after capture, else a recording keeps streaming in the
  // background on the long-lived session page (best-effort; a detached page is fine).
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
