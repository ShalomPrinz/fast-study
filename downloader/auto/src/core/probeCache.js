// Session-scoped, in-memory probe verdicts under an opaque per-strategy PROBE KEY: the Drive file
// id (stable across ref re-encoding) or the normalized URL. `forceCapture` re-probes.

const entries = new Map(); // probeKey -> { media, filename, reason }

// `media` null = it can't land here: a named file (a .zip) or, with `reason:'unshared'`, one the
// host serves no name for — both remembered exactly like a usable one.
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
