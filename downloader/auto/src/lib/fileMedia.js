// What a filename says the file is. Shared by every probe that ends up holding a name —
// one table, so a Drive link and a plain URL can never disagree about what a .mp4 is.

// A name counts only with an extension: that is what routing reads, and it rejects the page
// titles Drive serves ("Sign in", "Virus scan warning") for a file not readable anonymously.
export const NAMED_FILE = /^(.+)\.([A-Za-z0-9]{1,5})$/;

// Containers yt-dlp actually produces here; anything else it cannot turn into video.mp4.
const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'mov', 'webm', 'm4v', 'avi']);

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'wav',
  'aac',
  'flac',
  'ogg',
  'oga',
  'opus',
  'wma',
  'amr',
]);

/**
 * True for an `audio/*` mimetype or an audio extension: audio is never a material.
 * @param {string|null|undefined} mime
 * @param {string|null|undefined} filename
 * @returns {boolean}
 */
export function isAudioFile(mime, filename) {
  if (
    String(mime ?? '')
      .toLowerCase()
      .startsWith('audio/')
  )
    return true;
  const ext = NAMED_FILE.exec(String(filename ?? ''))?.[2]?.toLowerCase();
  return Boolean(ext) && AUDIO_EXTENSIONS.has(ext);
}

/**
 * 'video' (yt-dlp) for a video filename, else null: a probe can't tell whether any other file is
 * a material, an assignment or something else, so it never claims one.
 * @param {string|null} filename
 * @returns {'video'|null}
 */
export function classifyFilename(filename) {
  const ext = NAMED_FILE.exec(String(filename ?? ''))?.[2]?.toLowerCase();
  if (!ext) return null;
  return VIDEO_EXTENSIONS.has(ext) ? 'video' : null;
}

/**
 * Filename out of a `Content-Disposition` header, or null. Handles both the plain
 * `filename="L1.zip"` and the RFC 5987 `filename*=UTF-8''L1.zip` form used for non-ASCII names.
 * @param {string|null|undefined} header
 * @returns {string|null}
 */
export function filenameFromDisposition(header) {
  if (!header) return null;
  const ext = /filename\*=\s*[^']*''([^;]+)/i.exec(header);
  if (ext) {
    // A stray % in the header makes decodeURIComponent throw; an arbitrary host can send one, and
    // a malformed name is a reason to fall through to the plain form, never to fail the probe.
    let decoded;
    try {
      decoded = decodeURIComponent(ext[1].trim());
    } catch {
      decoded = '';
    }
    if (NAMED_FILE.test(decoded)) return decoded;
  }
  const plain = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i.exec(header);
  const name = (plain?.[1] ?? plain?.[2] ?? '').trim();
  return NAMED_FILE.test(name) ? name : null;
}
