import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VideoExtractor } from './VideoExtractor.js';
import { isRecording } from '../discovery/moodleCourse.js';
import { UnsupportedError } from '../lib/errors.js';

const execFileAsync = promisify(execFile);

// Hosts that serve Google Drive file links. Anything else isn't Drive.
const DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com']);

// hostname of a URL, or null if it isn't a parseable absolute URL — lets canHandle
// probe an arbitrary externalUrl (or undefined) without throwing.
function safeUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// A Drive URL pointing at one video file.
function isDriveFileUrl(url) {
  const u = safeUrl(url);
  if (!u || !DRIVE_HOSTS.has(u.hostname)) return false;
  if (/^\/file\/d\/[^/]+/.test(u.pathname)) return true;
  return (u.pathname === '/open' || u.pathname === '/uc') && !!u.searchParams.get('id');
}

// yt-dlp stderr fragments that mean "this file isn't readable without a Google session".
// Drive answers 404 (never 403) for a file the anonymous caller may not see, so any 40x
// on a Drive URL is a sharing problem, not a retryable one. 429 stays retryable.
const NOT_SHARED_PATTERNS = [
  /sign in/i,
  /permission/i,
  /not publicly shared/i,
  /private/i,
  /HTTP Error 40\d/i,
];

/** Does this yt-dlp stderr mean the Drive file isn't shared publicly? */
function isNotSharedStderr(detail) {
  return NOT_SHARED_PATTERNS.some((re) => re.test(detail));
}

/**
 * Cheap synchronous preflight before handing a Drive URL to `server/`. `server/`'s
 * /download-youtube is fire-and-forget (200 immediately, yt-dlp in a background job),
 * so a permission failure there could never reach the frontend — resolve it here.
 * Throws UnsupportedError (→ 422) when Drive won't serve the file anonymously; any
 * other yt-dlp failure stays a plain Error (→ 500 "try again").
 * @param {string} url
 */
export async function assertPubliclyShared(url) {
  try {
    await execFileAsync('yt-dlp', ['--skip-download', '--print', 'id', url]);
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('yt-dlp not found on PATH');
    const detail = err.stderr || err.message || '';
    if (isNotSharedStderr(detail)) {
      throw new UnsupportedError(
        `Google Drive file is not publicly shared (or was removed): ${url}. Open it in a browser and download manually.`,
      );
    }
    throw new Error(`yt-dlp failed to resolve Google Drive file: ${detail}`);
  }
}

/**
 * Moodle `url` module linking to a single Google Drive video file. The target
 * (contents[].fileurl) is known at list time, so the Drive host + single-file path are
 * decided with no fetch. Not expandable (folder links are out of scope) and needs no
 * browser: `server/` runs yt-dlp straight on the Drive URL, which serves
 * "anyone with the link" files without a Google session.
 */
export class GoogleDriveExtractor extends VideoExtractor {
  /** Recording.strategy this extractor produces — used to route echoed-back recordings. */
  get strategy() {
    return 'google-drive';
  }

  /**
   * Claim a `url` module only when a recording keyword is present AND its direct
   * external target is a single Drive file. Both gates are needed: a Google Doc titled
   * "…לתרגילים" passes the keyword gate, and only the single-file path check rejects it.
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {boolean}
   */
  canHandle(activity) {
    return (
      activity.modType === 'url' &&
      isRecording(activity.sectionName, activity.title) &&
      isDriveFileUrl(activity.externalUrl)
    );
  }

  /**
   * One directly-downloadable recording — `pageUrl` is the Drive file URL yt-dlp resolves.
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {import('./VideoExtractor.js').Recording[]}
   */
  toRecordings(activity) {
    return [
      {
        title: activity.title,
        pageUrl: activity.externalUrl,
        kind: activity.kind,
        strategy: 'google-drive',
        section: activity.sectionName,
      },
    ];
  }
}
