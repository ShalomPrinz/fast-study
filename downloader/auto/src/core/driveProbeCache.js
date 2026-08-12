// Session-scoped Drive probe cache. Resolving a Drive link's real filename costs an HTTP
// round-trip, and the answer never changes for a given file, so keep it keyed by the Drive
// FILE ID — stable across ref re-encoding, unlike `ref`. In-memory only, dies with the process.

const entries = new Map(); // fileId -> { media, filename }

// Store what one Drive file turned out to be. `media` null = a real file (its name is known)
// that this service can't use, which is worth remembering exactly like a usable one.
export function cacheDriveMedia(fileId, media, filename) {
  entries.set(fileId, { media, filename });
}

/**
 * What a Drive file was probed as, or undefined when it was never probed.
 * @param {string} fileId
 * @returns {'video'|'material'|null|undefined}
 */
export function getDriveMedia(fileId) {
  return entries.has(fileId) ? entries.get(fileId).media : undefined;
}

/** The whole probe result ({ media, filename }) or undefined — the filename names the 422. */
export function getDriveProbe(fileId) {
  return entries.get(fileId);
}
