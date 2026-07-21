// Push side of the job registry (docs/JOBS.md): subscribers get one event when a
// download starts and one when it ends. Nothing in between — a consumer animates its
// bar against an ETA. A live byte count is not implemented (yet).
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
export function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subscribers) {
    try { res.write(frame); } catch { subscribers.delete(res); }
  }
}
