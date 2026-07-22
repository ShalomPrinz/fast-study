// Push side of the job registry (docs/JOBS.md): pure notification. Every transition
// fires one contentless `job:change` frame; the frame carries no state, it only tells
// the client to refetch `/jobs`, which is the single source of truth.
const subscribers = new Set();

// A silent stream is killed by idle timeouts; a comment line keeps it warm.
const KEEPALIVE_MS = 25_000;

export function subscribe(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform', // no-transform: no proxy may buffer/compress
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(': connected\n\n');
  subscribers.add(res);

  const keepalive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, KEEPALIVE_MS);
  keepalive.unref(); // an open stream must not hold the process alive
  res.on('close', () => { clearInterval(keepalive); subscribers.delete(res); });
}

// Fire-and-forget: a broken subscriber is dropped, never allowed to fail a download.
export function broadcast() {
  const frame = 'event: job:change\ndata: {}\n\n';
  for (const res of subscribers) {
    try { res.write(frame); } catch { subscribers.delete(res); }
  }
}
