// The manual form's `/download-url`: auto decides the link, unmarked (a click), and its answer
// becomes one job — yt-dlp for an off-site link, curl on auto for a Moodle one — or is forwarded.
// auto is a local stand-in; nothing leaves loopback.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let answer = (req, res) => res.end();
const seen = [];
const auto = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    seen.push({
      method: req.method,
      path: req.url,
      wait: req.headers['x-faststudy-moodle-wait'] ?? null,
      body: raw ? JSON.parse(raw) : null,
    });
    answer(req, res);
  });
});
await new Promise((r) => auto.listen(0, '127.0.0.1', r));
test.after(() => {
  auto.closeAllConnections();
  auto.close();
});

process.env.AUTODL_URL = `http://127.0.0.1:${auto.address().port}`;
const { downloadUrl } = await import('../src/routes/downloadItem.js');
const { listJobs } = await import('../src/jobs.js');

const json = (status, body) => (req, res) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

// A file auto proxies is a 404 here, so a started curl job ends at once and stays on loopback.
const autoWith = (resolveAnswer) => (req, res) =>
  req.url === '/resolve' ? resolveAnswer(req, res) : res.writeHead(404).end();

// A port just freed, so nothing listens: an off-site target's yt-dlp job is refused at once,
// without leaving the machine.
const freed = http.createServer();
await new Promise((r) => freed.listen(0, '127.0.0.1', r));
const DEAD = `http://127.0.0.1:${freed.address().port}/l1.mp4`;
await new Promise((r) => freed.close(r));

const jobOf = (id) => listJobs().find((j) => j.id === id);

test('an off-site answer is a yt-dlp job, and the click is never marked to wait', async () => {
  answer = autoWith(
    json(200, {
      media: 'video',
      targets: [{ name: 'L1', tool: 'ytdlp', url: DEAD, fromCache: false }],
    }),
  );
  seen.length = 0;
  const { status, body } = await downloadUrl({
    url: DEAD,
    course: 'C',
    lecture: 'L1',
    kind: 'lecture',
  });
  assert.equal(status, 200);
  assert.equal(body.target, 'C/L1');
  assert.equal(jobOf(body.jobId).tool, 'yt-dlp');
  assert.deepEqual(seen[0], {
    method: 'POST',
    path: '/resolve',
    wait: null,
    body: { url: DEAD, course: 'C', name: 'L1', kind: 'lecture', only: false, forceCapture: false },
  });
});

test("a Moodle link's proxied answer is a curl job on auto, whose fetch queues", async () => {
  answer = autoWith(
    json(200, {
      media: 'video',
      targets: [
        { name: 'L2', tool: 'curl', url: '/moodle/file/abc', headers: [], fromCache: true },
      ],
    }),
  );
  seen.length = 0;
  const { status, body } = await downloadUrl({
    url: 'https://moodle.test/pluginfile.php/1/l2.mp4',
    course: 'C',
    lecture: 'L2',
    kind: 'lecture',
  });
  assert.equal(status, 200);
  const job = jobOf(body.jobId);
  assert.equal(job.tool, 'curl');
  assert.equal(job.ref, null);
  // The job's own request to auto is not the click: it carries the wait marker.
  for (let i = 0; i < 100 && !seen.some((s) => s.method === 'GET'); i++)
    await new Promise((r) => setTimeout(r, 20));
  const fetched = seen.find((s) => s.method === 'GET');
  assert.equal(fetched.path, '/moodle/file/abc');
  assert.equal(fetched.wait, '1');
});

test('a proxied id auto forgot re-resolves once from the same url, waiting its turn', async () => {
  let resolves = 0;
  answer = (req, res) => {
    if (req.url === '/resolve') {
      resolves++;
      const id = resolves === 1 ? 'forgotten' : 'fresh';
      return json(200, {
        media: 'video',
        targets: [
          { name: 'L5', tool: 'curl', url: `/moodle/file/${id}`, headers: [], fromCache: true },
        ],
      })(req, res);
    }
    // auto restarted: the first id is unknown (401); the fresh one is a plain 404 that ends the job.
    res.writeHead(req.url === '/moodle/file/forgotten' ? 401 : 404).end();
  };
  seen.length = 0;
  const url = 'https://moodle.test/pluginfile.php/1/l5.mp4';
  const { body } = await downloadUrl({ url, course: 'C', lecture: 'L5', kind: 'lecture' });
  // curl retries each failure 3× 2s apart, so the two attempts take ~12s.
  for (let i = 0; i < 1000 && jobOf(body.jobId).status !== 'error'; i++)
    await new Promise((r) => setTimeout(r, 20));
  const again = seen.filter((s) => s.path === '/resolve')[1];
  assert.equal(again.wait, '1');
  assert.equal(again.body.url, url);
  assert.ok(seen.some((s) => s.path === '/moodle/file/fresh'));
  assert.equal(jobOf(body.jobId).code, 'download_tool_failed');
});

test("a busy lock's 429 moodle_busy is forwarded verbatim, and no job starts", async () => {
  const busy = { status: 'busy', error: 'busy', code: 'moodle_busy', params: {} };
  answer = json(429, busy);
  const before = listJobs().length;
  assert.deepEqual(await downloadUrl({ url: DEAD, course: 'C', lecture: 'L3', kind: 'lecture' }), {
    status: 429,
    body: busy,
  });
  assert.equal(listJobs().length, before);
});

test('an unreachable auto fails the click closed, whatever the link', async () => {
  answer = (req) => req.socket.destroy();
  const { status, body } = await downloadUrl({
    url: 'https://videos.example.test/l4.mp4',
    course: 'C',
    lecture: 'L4',
    kind: 'lecture',
  });
  assert.equal(status, 502);
  assert.equal(body.code, 'autodl_unreachable');
});
