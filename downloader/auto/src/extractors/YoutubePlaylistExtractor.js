import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VideoExtractor } from './VideoExtractor.js';
import { isRecording } from './moodleCourse.js';
import { UnsupportedError } from '../errors.js';

const execFileAsync = promisify(execFile);

// Hosts we accept as a YouTube redirect target. Anything else is unsupported for now.
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

// hostname of a URL, or null if it isn't a parseable absolute URL (e.g. about:blank
// before any commit) — lets the goto-catch guard probe page.url() without throwing.
function safeHost(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

// User-facing "this source can't be expanded" — names the host so the frontend can
// tell the user exactly what redirected off-YouTube.
function unsupported(host) {
  return new UnsupportedError(`Unsupported recording source (${host}). Only YouTube playlists can be expanded.`);
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
   * Claim a `url` module (target host unknown until navigated) only when a recording
   * keyword is present, else unrelated links get surfaced and blow up on expand.
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {boolean}
   */
  canHandle(activity) {
    return activity.modType === 'url' && isRecording(activity.sectionName, activity.title);
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
   * entries with yt-dlp. Pure listing — no prompting — backing the HTTP
   * /list/expand endpoint.
   * @param {import('playwright').Page} page
   * @param {import('./VideoExtractor.js').Recording} rec
   * @returns {Promise<{ title: string, url: string }[]>}
   */
  async listEntries(page, rec) {
    // `&redirect=1` is the Moodle onclick's jump-straight-to-target flag.
    const sep = rec.pageUrl.includes('?') ? '&' : '?';
    // waitUntil:'commit' (not 'load'): the final host is known at commit, and a heavy
    // non-YouTube target would otherwise hang the full timeout before the host check runs.
    try {
      await page.goto(`${rec.pageUrl}${sep}redirect=1`, { waitUntil: 'commit' });
    } catch (err) {
      // A throw that already committed onto a non-YouTube host is unsupported, not a
      // server fault; a YouTube/unknown host rethrows as a real error.
      const host = safeHost(page.url());
      if (host && !YOUTUBE_HOSTS.has(host)) throw unsupported(host);
      throw err;
    }
    const finalUrl = page.url();

    const host = new URL(finalUrl).hostname;
    if (!YOUTUBE_HOSTS.has(host)) throw unsupported(host);

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
}
