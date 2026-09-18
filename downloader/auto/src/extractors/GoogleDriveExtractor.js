import { VideoExtractor } from './VideoExtractor.js';
import { isRecording } from '../discovery/moodleCourse.js';
import { UnsupportedError } from '../lib/errors.js';
import { cacheProbe, getProbe } from '../core/probeCache.js';
import { NAMED_FILE, classifyFilename, filenameFromDisposition } from '../lib/fileMedia.js';

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

/**
 * Drive file id out of the three single-file URL shapes, or null.
 * @param {string} url
 * @returns {string|null}
 */
export function driveFileId(url) {
  const u = safeUrl(url);
  if (!u || !DRIVE_HOSTS.has(u.hostname)) return null;
  const m = /^\/file\/d\/([^/]+)/.exec(u.pathname);
  if (m) return decodeURIComponent(m[1]);
  if (u.pathname === '/open' || u.pathname === '/uc') return u.searchParams.get('id') || null;
  return null;
}

/** The anonymous direct-download URL for a file id — what both the probe and `server/` fetch. */
export function driveDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}

/**
 * Filename out of a Drive HTML page, or null: the confirm interstitial a large file answers
 * with names it in `uc-name-size`/the virus-scan sentence, and `/view` puts it in the `<title>`.
 * @param {string} html
 * @returns {string|null}
 */
export function filenameFromHtml(html) {
  const text = String(html ?? '');
  const candidates = [
    /class="uc-name-size"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i.exec(text)?.[1],
    /([^\s<>"]+) \([\d.]+[KMG]?\) is too large/i.exec(text)?.[1],
    /<title>([^<]*)<\/title>/i.exec(text)?.[1]?.replace(/\s*-\s*Google Drive\s*$/i, ''),
  ];
  for (const c of candidates) {
    const name = c?.trim();
    if (name && NAMED_FILE.test(name)) return name;
  }
  return null;
}

// The file's real name without an API key: direct-download's Content-Disposition, else the large-
// file confirm interstitial, else `/view`'s <title>.
async function fetchDriveFilename(fileId) {
  const res = await fetch(driveDownloadUrl(fileId));
  const fromHeader = filenameFromDisposition(res.headers.get('content-disposition'));
  if (fromHeader) {
    await res.body?.cancel().catch(() => {});
    return fromHeader;
  }
  const fromHtml = filenameFromHtml(await res.text().catch(() => ''));
  if (fromHtml) return fromHtml;
  const view = await fetch(`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`);
  return filenameFromHtml(await view.text().catch(() => ''));
}

// One wording for the no-filename verdict, so a cache hit 422s as accurately as a fresh probe.
function unsharedError(url) {
  return new UnsupportedError(
    `Google Drive file is not publicly shared (or was removed): ${url}. Open it in a browser and download manually.`,
  );
}

/**
 * Resolve what a Drive link is before downloading it, memoized per file id (the unshared throw
 * included). Throws UnsupportedError (→ 422) when Drive serves no name. See docs/BROWSING.md.
 * @param {string} url
 * @param {{ force?: boolean }} [opts] force = ignore the cached verdict and probe fresh.
 * @returns {Promise<{ fileId: string, filename: string, media: 'video'|'material'|null,
 *                     downloadUrl: string }>} media null = a real file this service can't use.
 */
export async function probeDriveFile(url, { force = false } = {}) {
  const fileId = driveFileId(url);
  if (!fileId) throw new UnsupportedError(`not a Google Drive file link: ${url}`);
  const downloadUrl = driveDownloadUrl(fileId);

  const cached = force ? undefined : getProbe(fileId);
  if (cached) {
    if (cached.reason === 'unshared') throw unsharedError(url);
    return { fileId, filename: cached.filename, media: cached.media, downloadUrl };
  }

  const filename = await fetchDriveFilename(fileId);
  if (!filename) {
    cacheProbe(fileId, null, null, 'unshared');
    throw unsharedError(url);
  }
  const media = classifyFilename(filename);
  cacheProbe(fileId, media, filename);
  return { fileId, filename, media, downloadUrl };
}

/**
 * Moodle `url` module linking to a single Google Drive file; what the file IS only comes out of
 * the download-time probeDriveFile. No browser: Drive serves "anyone with the link" files anonymously.
 */
export class GoogleDriveExtractor extends VideoExtractor {
  /** Recording.strategy this extractor produces — used to route echoed-back recordings. */
  get strategy() {
    return 'google-drive';
  }

  /**
   * Claim a `url` module whose direct external target is a single Drive file (a folder falls to
   * DirectUrlExtractor).
   * @param {import('./VideoExtractor.js').Activity} activity
   * @returns {boolean}
   */
  canHandle(activity) {
    return activity.modType === 'url' && isDriveFileUrl(activity.externalUrl);
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
        likelyRecording: isRecording(activity.sectionName, activity.title),
      },
    ];
  }
}
