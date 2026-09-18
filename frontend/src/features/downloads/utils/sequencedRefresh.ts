// Only the newest reply of a refetch-per-ping loop publishes: overlapping fetches can land out of
// order, and nothing pings again after the terminal one. Failures are no-ops; state is per call.
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
