// The shape `/resolve` hands to server/: which of server/'s three downloaders fetches a
// resolved cap, and the wire object describing one download target.

/**
 * Pick server/'s downloader key for a strategy. A browser-captured .mp4 is only fetchable by
 * replaying its captured headers (curl); yt-dlp owns the pages whose real stream it resolves
 * itself (YouTube, a Drive or direct video); everything else is a plain tokened URL.
 * @param {string} strategy  the Recording strategy
 * @param {'video'|'material'} [media]  only the probed strategies need it — the probe decides theirs
 * @returns {'curl'|'fetch'|'ytdlp'}
 */
export function toolFor(strategy, media) {
  if (strategy === 'moodle-file') return 'fetch';
  if (strategy === 'youtube-playlist') return 'ytdlp';
  if (strategy === 'google-drive' || strategy === 'direct-url')
    return media === 'video' ? 'ytdlp' : 'fetch';
  return 'curl'; // videostream, zoom — browser capture
}

/**
 * One resolved cap as a `/resolve` target. `headers` rides only with curl (nothing else replays
 * them) and stays the `[{name, value}]` array server/'s curl iterates — the same shape the
 * extension's webRequest capture has. `fromCache` tells server/ whether an auth failure is
 * worth re-resolving.
 * @param {{ name: string, cap: { url: string, headers?: Array<{name: string, value: string}> },
 *           tool: 'curl'|'fetch'|'ytdlp', fromCache: boolean }} args
 */
export function toTarget({ name, cap, tool, fromCache }) {
  return {
    name,
    tool,
    url: cap.url,
    ...(tool === 'curl' ? { headers: cap.headers ?? [] } : {}),
    fromCache: Boolean(fromCache),
  };
}
