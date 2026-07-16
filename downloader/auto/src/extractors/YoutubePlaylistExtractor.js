import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VideoExtractor } from './VideoExtractor.js';
import { askUntil } from '../prompt.js';

const execFileAsync = promisify(execFile);

// Hosts we accept as a YouTube redirect target. Anything else is unsupported for now.
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

/** Prompt on the terminal for a 1-based index into `entries`; re-asks until valid. */
function pickEntry(entries) {
  return askUntil('Pick a playlist entry number: ', (answer) => {
    const i = parseInt(answer, 10);
    return Number.isInteger(i) && i >= 1 && i <= entries.length ? entries[i - 1] : null;
  });
}

/**
 * Moodle `url` module that redirects off-site. We can't know the target host
 * without navigating, so canHandle claims `url` activities optimistically and the
 * download phase confirms the redirect actually lands on YouTube. For now only
 * YouTube playlists are supported; anything else is rejected at download time.
 */
export class YoutubePlaylistExtractor extends VideoExtractor {
  /** Recording.strategy this extractor produces — used to route echoed-back recordings. */
  get strategy() {
    return 'youtube-playlist';
  }

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
   * Follow the Moodle url-module redirect to YouTube and flat-list its playlist
   * entries with yt-dlp. Pure listing — no prompting — so both the CLI download
   * flow and the HTTP /playlist/entries endpoint reuse it.
   * @param {import('playwright').Page} page
   * @param {import('./VideoExtractor.js').Recording} rec
   * @returns {Promise<{ title: string, url: string }[]>}
   */
  async listEntries(page, rec) {
    // `&redirect=1` is what the Moodle onclick uses to jump straight to the target.
    const sep = rec.pageUrl.includes('?') ? '&' : '?';
    await page.goto(`${rec.pageUrl}${sep}redirect=1`, { waitUntil: 'load' });
    const finalUrl = page.url();

    const host = new URL(finalUrl).hostname;
    if (!YOUTUBE_HOSTS.has(host)) throw new Error(`unsupported redirect target: ${host}`);

    // Flat-list the playlist (title<TAB>url per entry). argv array — never a shell
    // string — so titles with metacharacters can't inject.
    let stdout;
    try {
      ({ stdout } = await execFileAsync('yt-dlp', ['--flat-playlist', '--print', '%(title)s\t%(url)s', finalUrl]));
    } catch (err) {
      const detail = err.code === 'ENOENT' ? 'yt-dlp not found on PATH' : err.stderr || err.message;
      throw new Error(`yt-dlp failed to list playlist: ${detail}`);
    }

    const entries = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [title, url] = line.split('\t');
        return { title, url };
      })
      .filter((e) => e.url);
    if (!entries.length) throw new Error(`no playlist entries found at ${finalUrl}`);
    return entries;
  }

  /**
   * DOWNLOAD PHASE: list the playlist entries, let the user pick one on the
   * terminal. No headers — server.js's /download-youtube runs yt-dlp, which
   * manages its own session.
   * @param {import('playwright').Page} page
   * @param {import('./VideoExtractor.js').Recording} rec
   * @returns {Promise<import('./VideoExtractor.js').VideoCapture>}
   */
  async _captureVideo(page, rec) {
    const entries = await this.listEntries(page, rec);
    console.log(`\nPlaylist entries (${entries.length}):`);
    entries.forEach((e, i) => console.log(`  [${i + 1}] ${e.title}`));
    const chosen = await pickEntry(entries);
    return { title: chosen.title, url: chosen.url, kind: rec.kind, strategy: 'youtube-playlist' };
  }
}
