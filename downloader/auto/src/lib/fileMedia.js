// What a filename says the file is. Shared by every probe that ends up holding a name —
// one table, so a Drive link and a plain URL can never disagree about what a .mp4 is.

// A name only counts as resolved when it carries an extension: that is what the routing
// reads, and it also rejects the page titles Drive serves instead ("Sign in", "Virus scan
// warning") when the file isn't readable anonymously.
export const NAMED_FILE = /^(.+)\.([A-Za-z0-9]{1,5})$/;

// Containers yt-dlp actually produces here; anything else it cannot turn into video.mp4.
const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'mov', 'webm', 'm4v', 'avi']);

/**
 * Which file a filename would land as: 'video' (yt-dlp), 'material' (a lecture PDF),
 * or null for anything this service can't use (archives, slides decks, …).
 * @param {string|null} filename
 * @returns {'video'|'material'|null}
 */
export function classifyFilename(filename) {
  const ext = NAMED_FILE.exec(String(filename ?? ''))?.[2]?.toLowerCase();
  if (!ext) return null;
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return ext === 'pdf' ? 'material' : null;
}
