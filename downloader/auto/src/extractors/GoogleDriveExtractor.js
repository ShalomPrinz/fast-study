import { VideoExtractor } from './VideoExtractor.js';
import { isRecording } from '../discovery/moodleCourse.js';
import { UnsupportedError } from '../lib/errors.js';
import { cacheProbe, getProbe } from '../core/probeCache.js';
import { NAMED_FILE, classifyFilename } from '../lib/fileMedia.js';

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
 * Filename out of a `Content-Disposition` header, or null. Handles both the plain
 * `filename="L1.zip"` and the RFC 5987 `filename*=UTF-8''L1.zip` Drive sends for non-ASCII names.
 * @param {string|null|undefined} header
 * @returns {string|null}
 */
export function filenameFromDisposition(header) {
  if (!header) return null;
  const ext = /filename\*=\s*[^']*''([^;]+)/i.exec(header);
  if (ext) {
    const decoded = decodeURIComponent(ext[1].trim());
    if (NAMED_FILE.test(decoded)) return decoded;
  }
  const plain = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i.exec(header);
  const name = (plain?.[1] ?? plain?.[2] ?? '').trim();
  return NAMED_FILE.test(name) ? name : null;
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

// Ask Drive for the file's real name without an API key. The direct-download URL answers a
// readable file with `Content-Disposition` (one request, happy path); a large one answers the
// confirm interstitial instead, which still carries the name; `/view`'s <title> is the fallback.
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
 * Resolve what a Drive link actually is before downloading it. `server/`'s download jobs are
 * fire-and-forget (200 immediately), so the routing decision has to be made here: the filename
 * is a fact about the file, unlike yt-dlp's stderr wording. Memoized per file id for the session,
 * including the throw below; `force` re-probes, since an owner can flip sharing on mid-session.
 * Throws UnsupportedError (→ 422) when Drive serves no name at all — the file isn't shared
 * "anyone with the link" (or was removed).
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
 * Moodle `url` module linking to a single Google Drive file. The target (contents[].fileurl)
 * is known at list time, so the Drive host + single-file path are decided with no fetch; what
 * the file IS only comes out of the download-time filename probe (probeDriveFile). Not
 * expandable (folder links are out of scope) and needs no browser: Drive serves "anyone with
 * the link" files without a Google session.
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
