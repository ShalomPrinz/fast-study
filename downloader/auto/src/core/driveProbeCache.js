// Session-scoped Drive probe cache. Resolving a Drive link's real filename costs an HTTP
// round-trip, and the answer only changes when the owner flips sharing on (which `forceCapture`
// re-probes), so keep it keyed by the Drive FILE ID — stable across ref re-encoding, unlike
// `ref`. In-memory only, dies with the process.

const entries = new Map(); // fileId -> { media, filename, reason }

// Store what one Drive file turned out to be. `media` null = the file can't land here: either a
// real file whose name is known (a .zip) or, with `reason:'unshared'`, one Drive serves no name
// for at all — both worth remembering exactly like a usable one.
export function cacheDriveMedia(fileId, media, filename, reason) {
  entries.set(fileId, { media, filename, reason });
}

/**
 * What a Drive file was probed as, or undefined when it was never probed.
 * @param {string} fileId
 * @returns {'video'|'material'|null|undefined}
 */
export function getDriveMedia(fileId) {
  return entries.has(fileId) ? entries.get(fileId).media : undefined;
}

/** The whole probe result ({ media, filename, reason }) or undefined — it names the 422. */
export function getDriveProbe(fileId) {
  return entries.get(fileId);
}
