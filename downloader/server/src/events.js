// SSE push (docs/JOBS.md): a contentless `job:change`/`run:change` per transition, plus `folder:pick
// {folder}`, sent only to `?picker=1` streams — windows that can open a native picker.
const subscribers = new Set();
const pickers = new Set();

// A silent stream is killed by idle timeouts; a comment line keeps it warm.
const KEEPALIVE_MS = 25_000;

export function subscribe(res, { picker = false } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform', // no-transform: no proxy may buffer/compress
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(': connected\n\n');
  subscribers.add(res);
  if (picker) pickers.add(res);

  const keepalive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {}
  }, KEEPALIVE_MS);
  keepalive.unref(); // an open stream must not hold the process alive
  res.on('close', () => {
    clearInterval(keepalive);
    subscribers.delete(res);
    pickers.delete(res);
  });
}

// Fire-and-forget: a broken subscriber is dropped, never allowed to fail a download.
function send(event, data = {}, to = subscribers) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of to) {
    try {
      res.write(frame);
    } catch {
      subscribers.delete(res);
      pickers.delete(res);
    }
  }
}

export function broadcastJobs() {
  send('job:change');
}

export function broadcastRuns() {
  send('run:change');
}

// How many picker streams are open — zero means no app window could answer a `folder:pick`.
export function pickerCount() {
  return pickers.size;
}

export function broadcastFolderPick(folder) {
  send('folder:pick', { folder }, pickers);
}
