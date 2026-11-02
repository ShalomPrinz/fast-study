// What a pruned copy drops; stage.mjs prunes with it and extension-version.mjs asks what ships.

// Dev-only weight that would otherwise ride along in the downloader trees and the extension.
const SKIP = new Set(['test', 'docs', 'CLAUDE.md', 'README.md', '.gitignore', 'package-lock.json']);
// Source maps and type declarations, dropped everywhere — `@sentry/*` alone is ~40MB per service.
export const SKIP_EXT = /\.(map|d\.[cm]?ts)$/;

/** Whether a pruned tree drops `rel`, a path relative to its root. */
export const pruned = (rel) => SKIP_EXT.test(rel) || SKIP.has(rel);
