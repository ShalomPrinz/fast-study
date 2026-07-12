import { VideoExtractor } from './VideoExtractor.js';

/**
 * Moodle `url` module that redirects off-site. We can't know the target host
 * without navigating, so canHandle claims `url` activities optimistically and the
 * download phase confirms the redirect actually lands on YouTube. For now only
 * YouTube playlists are supported; anything else is rejected at download time.
 */
export class YoutubePlaylistExtractor extends VideoExtractor {
  /**
   * Optimistic: assume `url` modules are the redirect-to-YouTube kind.
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {boolean}
   */
  canHandle(activity) {
    return activity.modType === 'url';
  }

  /**
   * List as ONE unexpanded entry — the playlist expands at download time (we
   * don't navigate during listing).
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {import('./VideoExtractor.js').Recording[]}
   */
  toRecordings(activity) {
    return [{ title: activity.title, pageUrl: activity.viewUrl, kind: activity.kind, strategy: 'youtube-playlist' }];
  }

  /**
   * DOWNLOAD PHASE (later).
   * @param {import('playwright').Page} page
   * @param {import('./VideoExtractor.js').Recording} rec
   * @returns {Promise<import('./VideoExtractor.js').VideoCapture>}
   */
  async captureVideo(page, rec) {
    // TODO(download phase): navigate `${rec.pageUrl}&redirect=1` (as the Moodle
    // onclick does) and wait for the final URL. Confirm its host is one of
    // {youtube.com, www.youtube.com, m.youtube.com, youtu.be}; otherwise throw
    // "unsupported redirect target" (only YouTube handled for now). Treat it as a
    // playlist → list entries via `yt-dlp --flat-playlist` → user picks one →
    // POST server.js /download-youtube with the chosen entry's URL.
    throw new Error('YoutubePlaylistExtractor.captureVideo not implemented (download phase)');
  }
}
