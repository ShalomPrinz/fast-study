// Bytes on the Moodle host that server/ fetches through auto: an opaque id per resolved file, so the
// token and any captured cookies never leave this process and every byte crosses the gate
// (docs/GATE.md). Memory only — after a restart an id is unknown, and server/ re-resolves.
import { randomUUID } from 'node:crypto';

// id → { pluginfile: true, fileurl, size } | { url, headers, size }
const files = new Map();

/**
 * Keep a file auto will stream, → the cap server/ fetches it by: a path on auto, no headers, and
 * `proxied` so its target always says `fromCache` (a restart forgets the id).
 * @param {{ fileurl: string, size?: number|null } | { url: string, headers?: Array<{name: string, value: string}>, size?: number|null }} file
 *   a `fileurl` is a pluginfile URL the WS token is added to at stream time; a `url` is fetched as
 *   it is, with its captured `headers`.
 */
export function proxyCap(file) {
  const id = randomUUID();
  files.set(id, file.fileurl ? { pluginfile: true, ...file } : { headers: [], ...file });
  return { url: `/moodle/file/${id}`, headers: [], proxied: true };
}

/** The file behind an id, or undefined when this process never minted it. */
export function fileById(id) {
  return files.get(id);
}
