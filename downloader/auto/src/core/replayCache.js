// Session-scoped replay cache. A capture is expensive (open the share, clear the passcode,
// sniff the .mp4), so keep each resulting cap keyed by its FINAL download target for cheap
// replay on retry. In-memory only — dies with the process.

// Collision-safe key over the download target:
// course/lecture/kind pick the folder, `media` ('video'|'material') picks which file it becomes
function keyOf(course, lecture, kind, media) {
  return JSON.stringify([course, lecture, kind, media]);
}

const entries = new Map(); // key -> { cap, ref }

// Store the cap for one target.
// `cap` is {url, headers} (curl) or {url} (yt-dlp); `ref` is the discovery row that produced it.
export function cacheCap(course, lecture, kind, media, cap, ref) {
  entries.set(keyOf(course, lecture, kind, media), { cap, ref });
}

// Cached cap for one target, or null.
export function getCap(course, lecture, kind, media) {
  return entries.get(keyOf(course, lecture, kind, media)) ?? null;
}
