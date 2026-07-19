import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VideoExtractor } from './VideoExtractor.js';
import { isRecording } from '../discovery/moodleCourse.js';
import { UnsupportedError } from '../lib/errors.js';

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
 * Moodle `url` module that links off-site. canHandle claims recording-keyword `url`
 * activities; expand confirms the direct external target (contents[].fileurl) is a
 * YouTube host. For now only YouTube playlists are supported; anything else (Drive,
 * GitHub, …) is rejected as unsupported at expand time.
 */
export class YoutubePlaylistExtractor extends VideoExtractor {
  /** Recording.strategy this extractor produces — used to route echoed-back recordings. */
  get strategy() {
    return 'youtube-playlist';
  }

  /**
   * Claim a `url` module only when a recording keyword is present, else unrelated
   * links (syllabus, reading) get surfaced and rejected on expand.
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {boolean}
   */
  canHandle(activity) {
    return activity.modType === 'url' && isRecording(activity.sectionName, activity.title);
  }

  /**
   * List as ONE unexpanded entry — the playlist expands at download time. `pageUrl` is
   * the direct external target (contents[].fileurl), so expand runs yt-dlp straight on it.
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {import('./VideoExtractor.js').Recording[]}
   */
  toRecordings(activity) {
    return [{ title: activity.title, pageUrl: activity.externalUrl, kind: activity.kind, strategy: 'youtube-playlist' }];
  }

  /**
   * Flat-list a YouTube playlist with yt-dlp, straight on the direct external URL from
   * the ref — no browser, no page navigation. Backs the HTTP /list/expand endpoint.
   * @param {import('./VideoExtractor.js').Recording} rec  rec.pageUrl = the external target
   * @returns {Promise<{ title: string, url: string }[]>}
   */
  async listEntries(rec) {
    const finalUrl = rec.pageUrl;
    // The direct target host is known without navigating; only YouTube playlists expand.
    const host = safeHost(finalUrl);
    if (!host || !YOUTUBE_HOSTS.has(host)) throw unsupported(host || finalUrl);

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
