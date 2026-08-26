// Session-scoped probe cache. Resolving what a link actually is costs an HTTP round-trip, and
// the answer only changes when the owner flips sharing on (which `forceCapture` re-probes), so
// remember it under an opaque per-strategy PROBE KEY: Drive passes its file id (stable across
// ref re-encoding, unlike `ref`), the generic probe passes its normalized URL. In-memory only,
// dies with the process.

const entries = new Map(); // probeKey -> { media, filename, reason }

// Store what one probed link turned out to be. `media` null = it can't land here: either a real
// file whose name is known (a .zip) or, with `reason:'unshared'`, one the host serves no name
// for at all — both worth remembering exactly like a usable one.
export function cacheProbe(probeKey, media, filename, reason) {
  entries.set(probeKey, { media, filename, reason });
}

/**
 * What a link was probed as, or undefined when it was never probed.
 * @param {string} probeKey
 * @returns {'video'|'material'|null|undefined}
 */
export function getProbedMedia(probeKey) {
  return entries.has(probeKey) ? entries.get(probeKey).media : undefined;
}

/** The whole probe result ({ media, filename, reason }) or undefined — it names the 422. */
export function getProbe(probeKey) {
  return entries.get(probeKey);
}
