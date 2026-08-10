// The PDF's mtime is the cache key: it changes exactly when the file changes and is stable across
// mounts, so a revisit reuses the browser cache only while the file on disk is unchanged.
export function cacheBustedUrl(baseUrl: string, mtime: number | null): string {
  if (mtime === null) return baseUrl
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}t=${mtime}`
}
