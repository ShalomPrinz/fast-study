// Wraps a "refetch on every ping" loop so only the newest reply publishes. The downloader server
// pings faster than a request answers, so several fetches overlap and can come back out of order —
// and an older reply landing after the terminal snapshot strands the UI on a superseded state
// forever, because nothing pings again to correct it. A failed fetch is a no-op; the stream
// reconnects and pings again. State is per call, so each provider effect gets its own counters.
export function sequencedRefresh<T>(
  fetchSnapshot: () => Promise<T>,
  onSnapshot: (snapshot: T) => void,
): () => void {
  let issued = 0
  let published = 0
  return () => {
    const seq = ++issued
    void fetchSnapshot()
      .then((snapshot) => {
        if (seq <= published) return
        published = seq
        onSnapshot(snapshot)
      })
      .catch(() => {})
  }
}
