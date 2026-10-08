#!/usr/bin/env node
// Boot time across main's build.yml runs: `collect` grows a local JSON store from run artifacts and
// Releases through `gh`; `view` serves a live chart of it on 127.0.0.1. No stage named runs both.
//   node delivery/boot-timing.mjs [collect|view] [--repo owner/name]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const STORE = path.join(import.meta.dirname, 'boot-timing.local.json');
const ARTIFACT = 'boot-timing';
const ASSET = 'boot-timing.json';
const USAGE = 'usage: node delivery/boot-timing.mjs [collect|view] [--repo owner/name]';

function args(argv) {
  const out = { stage: null, repo: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo' && argv[i + 1] !== undefined) out.repo = argv[++i];
    else if (['collect', 'view'].includes(argv[i]) && out.stage === null) out.stage = argv[i];
    else {
      console.error(USAGE);
      process.exit(2);
    }
  }
  return out;
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { cursor: { runs: null, releases: null }, entries: {} };
    throw err;
  }
}

/** Temp file beside the store, renamed over it, so a crash never leaves half a file. */
function writeStore(store) {
  const tmp = `${STORE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
  fs.renameSync(tmp, STORE);
}

const gh = (...argv) =>
  execFileSync('gh', argv, {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const lines = (out) =>
  out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

/** Fails naming why when `gh` is missing or logged out, before any API call. */
function checkGh() {
  try {
    gh('--version');
  } catch (err) {
    throw new Error(
      err.code === 'ENOENT' ? 'gh is not installed or not on PATH' : `gh failed: ${err.message}`,
    );
  }
  try {
    gh('auth', 'status');
  } catch {
    throw new Error('gh is not logged in (run `gh auth login`)');
  }
}

const isoMinusSecond = (iso) => new Date(Date.parse(iso) - 1000).toISOString().replace('.000', '');

function collect(repoArg) {
  checkGh();
  const repo =
    repoArg ?? gh('repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner').trim();
  const store = readStore();
  const { entries } = store;
  let newRuns = 0;
  let newlyPublished = 0;

  // The runs cursor means "every main run created up to here is settled", so it stops one second
  // short of the oldest unfinished run and that run is listed again next time.
  const params = ['-f', 'branch=main', '-f', 'per_page=100'];
  if (store.cursor.runs) params.push('-f', `created=>${store.cursor.runs}`);
  const runs = lines(
    gh(
      'api',
      '-X',
      'GET',
      `repos/${repo}/actions/workflows/build.yml/runs`,
      ...params,
      '--paginate',
      '--jq',
      '.workflow_runs[] | {id, status, created_at, head_sha}',
    ),
  ).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const unfinished = runs.filter((r) => r.status !== 'completed');
  const settled = runs.filter((r) => r.status === 'completed' && !(r.id in entries));
  const artifacts = new Map(
    lines(
      gh(
        'api',
        '-X',
        'GET',
        `repos/${repo}/actions/artifacts`,
        '-f',
        `name=${ARTIFACT}`,
        '-f',
        'per_page=100',
        '--paginate',
        '--jq',
        '.artifacts[] | select(.expired | not) | {run: .workflow_run.id}',
      ),
    ).map((a) => [a.run, true]),
  );
  for (const run of settled) {
    if (!artifacts.has(run.id)) {
      console.log(`run ${run.id} (${run.created_at}): no ${ARTIFACT} artifact, skipped`);
      continue;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faststudy-boot-timing-'));
    try {
      gh('run', 'download', String(run.id), '-R', repo, '-n', ARTIFACT, '-D', dir);
      const timing = JSON.parse(fs.readFileSync(path.join(dir, ASSET), 'utf8'));
      entries[run.id] = {
        ...timing,
        created_at: run.created_at,
        head_sha: run.head_sha,
        release: null,
      };
      newRuns++;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  if (unfinished.length) store.cursor.runs = isoMinusSecond(unfinished[0].created_at);
  else if (runs.length) store.cursor.runs = runs.at(-1).created_at;

  // A Release maps to its run through the asset's run_id — exact even when one commit built twice.
  const releases = lines(
    gh(
      'api',
      `repos/${repo}/releases`,
      '--paginate',
      '--jq',
      `.[] | select(.draft | not) | {tag: .tag_name, created_at, published_at, asset: ([.assets[] | select(.name == "${ASSET}") | .id][0])}`,
    ),
  )
    .filter((r) => !store.cursor.releases || r.published_at > store.cursor.releases)
    .sort((a, b) => a.published_at.localeCompare(b.published_at));
  for (const rel of releases) {
    if (rel.asset == null) {
      console.log(`${rel.tag}: no ${ASSET} asset, skipped`);
      continue;
    }
    const timing = JSON.parse(
      gh(
        'api',
        '-H',
        'Accept: application/octet-stream',
        `repos/${repo}/releases/assets/${rel.asset}`,
      ),
    );
    if (timing.run_id == null) {
      console.log(`${rel.tag}: ${ASSET} has no run_id, skipped`);
      continue;
    }
    if (!(timing.run_id in entries)) {
      // The run's artifact expired: the asset is the entry. Its run record usually outlives the
      // artifact; if not, the commit is the asset's own and the date is the Release's commit date.
      let created_at = rel.created_at;
      let head_sha = timing.commit;
      try {
        const run = JSON.parse(
          gh(
            'api',
            `repos/${repo}/actions/runs/${timing.run_id}`,
            '--jq',
            '{created_at, head_sha}',
          ),
        );
        ({ created_at, head_sha } = run);
      } catch {
        console.log(`${rel.tag}: run ${timing.run_id} no longer listed, dated by the Release`);
      }
      entries[timing.run_id] = { ...timing, created_at, head_sha, release: null };
    }
    entries[timing.run_id].release = rel.tag;
    newlyPublished++;
  }
  if (releases.length) store.cursor.releases = releases.at(-1).published_at;

  writeStore(store);
  const total = Object.keys(entries).length;
  console.log(`${newRuns} new runs, ${newlyPublished} newly published, ${total} total`);
}

// The page: entries inlined as JSON, the chart drawn as SVG by its own script — no fetch, no CDN.
function page(entries) {
  const points = Object.entries(entries)
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const data = JSON.stringify(points).replace(/</g, '\\u003c');
  const body = points.length
    ? `<h1>Boot time per build</h1>
<p>Smoke-run launch to <code>app://bundle</code>, in seconds, on a windows-latest runner — one run per build of main, so single points are noisy. Ringed points were published; service ready times count from main's first log line.</p>
<div class="legend"><span style="--c: var(--s1)">Fresh install, first launch</span><span style="--c: var(--s2)">First launch after update</span></div>
<div class="chart"><svg id="chart"></svg><div class="tip" id="tip"></div></div>
<div class="table-wrap"><table id="table"></table></div>`
    : `<h1>Boot time per build</h1>
<p>No boot timings stored yet. Run <code>node delivery/boot-timing.mjs collect</code>, then refresh.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FastStudy boot time</title>
<style>
:root {
  color-scheme: light;
  --surface: #fcfcfb; --text: #0b0b0b; --text-2: #52514e; --grid: #e4e3df;
  --s1: #2a78d6; --s2: #eb6834;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #1a1a19; --text: #ffffff; --text-2: #c3c2b7; --grid: #383835;
    --s1: #3987e5; --s2: #d95926;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19; --text: #ffffff; --text-2: #c3c2b7; --grid: #383835;
  --s1: #3987e5; --s2: #d95926;
}
body { margin: 0; padding: 24px 16px; background: var(--surface); color: var(--text);
  font: 14px/1.45 system-ui, sans-serif; }
main { max-width: 960px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 4px; }
p { color: var(--text-2); margin: 0 0 16px; }
.legend { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 8px; color: var(--text-2); }
.legend span::before { content: ""; display: inline-block; width: 12px; height: 2px; margin: 0 6px 4px 0;
  background: var(--c); vertical-align: middle; }
.chart { position: relative; }
svg { display: block; width: 100%; height: auto; overflow: visible; }
svg text { fill: var(--text-2); font-size: 11px; }
svg text.tag { fill: var(--text); font-weight: 600; }
.tip { position: absolute; pointer-events: none; background: var(--surface); border: 1px solid var(--grid);
  border-radius: 6px; padding: 8px 10px; font-size: 12px; white-space: nowrap; display: none;
  box-shadow: 0 2px 8px rgb(0 0 0 / .15); }
.tip b { color: var(--text); }
.tip i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: var(--c); }
.table-wrap { overflow-x: auto; margin-top: 24px; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; width: 100%; }
th, td { text-align: right; padding: 4px 8px; border-bottom: 1px solid var(--grid); white-space: nowrap; }
th:nth-child(-n+3), td:nth-child(-n+3) { text-align: left; }
th { color: var(--text-2); font-weight: 500; }
</style>
</head>
<body>
<main>
${body}
</main>
<script>
const points = ${data};
if (points.length) {
const SERIES = [
  { key: 'fresh_install', label: 'Fresh install', color: 'var(--s1)' },
  { key: 'after_update', label: 'After update', color: 'var(--s2)' },
];
const SERVICES = ['database', 'auto', 'backend', 'server'];
const secs = (ms) => (ms == null ? null : ms / 1000);
const value = (p, key) => secs(p.boots?.[key]?.launch_to_app_ms);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => '&#' + c.charCodeAt(0) + ';');
const fmt = (s) => (s == null ? '—' : s.toFixed(1) + ' s');
const day = (iso) => iso.slice(0, 10);
const label = (p) => p.release ?? (p.version ? 'v' + p.version : 'run ' + p.id);

const W = 960, H = 360, L = 44, R = 16, T = 24, B = 40;
const svg = document.getElementById('chart');
svg.setAttribute('viewBox', \`0 0 \${W} \${H}\`);
const ns = 'http://www.w3.org/2000/svg';
const el = (name, attrs, parent = svg) => {
  const node = document.createElementNS(ns, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
};
const all = points.flatMap((p) => SERIES.map((s) => value(p, s.key))).filter((v) => v != null);
const step = (() => { const raw = Math.max(1, ...all) / 5; const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw); })();
const yMax = Math.ceil(Math.max(1, ...all) / step) * step;
const times = points.map((p) => Date.parse(p.created_at));
const t0 = times[0], t1 = times.at(-1);
const x = (t) => L + (t1 === t0 ? (W - L - R) / 2 : ((t - t0) * (W - L - R)) / (t1 - t0));
const y = (v) => T + (H - T - B) * (1 - v / yMax);
// Labels near either edge hang inward rather than spilling past the plot.
const anchor = (px) => (px < L + 40 ? 'start' : px > W - R - 40 ? 'end' : 'middle');

for (let v = 0; v <= yMax + 1e-9; v += step) {
  el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--grid)', 'stroke-width': v === 0 ? 1 : 0.5 });
  el('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }).textContent = v.toFixed(step < 1 ? 1 : 0);
}
el('text', { x: 0, y: T - 2 }).textContent = 's';
// Six evenly spaced date ticks across the span; one when every run shares an instant.
const ticks = t1 === t0 ? [t0] : Array.from({ length: 6 }, (_, k) => t0 + ((t1 - t0) * k) / 5);
for (const t of ticks)
  el('text', { x: x(t), y: H - B + 18, 'text-anchor': anchor(x(t)) }).textContent = day(new Date(t).toISOString());
const cursor = el('line', { y1: T, y2: H - B, stroke: 'var(--text-2)', 'stroke-width': 1, opacity: 0 });
for (const s of SERIES) {
  // A gap where a run has no value for this boot, rather than a line bridging it.
  let d = '', pen = false;
  points.forEach((p, i) => {
    const v = value(p, s.key);
    if (v == null) { pen = false; return; }
    d += (pen ? 'L' : 'M') + x(times[i]) + ' ' + y(v);
    pen = true;
  });
  el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round' });
  points.forEach((p, i) => {
    const v = value(p, s.key);
    if (v == null) return;
    if (p.release) el('circle', { cx: x(times[i]), cy: y(v), r: 7, fill: 'var(--surface)', stroke: s.color, 'stroke-width': 2 });
    el('circle', { cx: x(times[i]), cy: y(v), r: p.release ? 3.5 : 3, fill: s.color });
  });
}
// One tag per published run, above its highest point.
points.forEach((p, i) => {
  const vs = SERIES.map((s) => value(p, s.key)).filter((v) => v != null);
  if (p.release && vs.length)
    el('text', { class: 'tag', x: x(times[i]), y: y(Math.max(...vs)) - 12, 'text-anchor': anchor(x(times[i])) }).textContent = p.release;
});

const tip = document.getElementById('tip');
const hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
hit.addEventListener('pointermove', (event) => {
  const box = svg.getBoundingClientRect();
  const px = ((event.clientX - box.left) / box.width) * W;
  let i = 0;
  times.forEach((t, k) => { if (Math.abs(x(t) - px) < Math.abs(x(times[i]) - px)) i = k; });
  const p = points[i];
  cursor.setAttribute('x1', x(times[i])); cursor.setAttribute('x2', x(times[i])); cursor.setAttribute('opacity', 0.4);
  tip.innerHTML = \`<b>v\${esc(p.version ?? '?')}</b>\` + (p.release ? \` · published \${esc(p.release)}\` : '') +
    \` · \${esc(day(p.created_at))} · \${esc((p.head_sha ?? '').slice(0, 7))}\` +
    SERIES.map((s) => {
      const boot = p.boots?.[s.key];
      return \`<br><i style="--c: \${s.color}"></i>\${s.label}: <b>\${fmt(value(p, s.key))}</b>\` +
        (boot ? ' — ' + SERVICES.map((n) => \`\${n} \${fmt(secs(boot.ready_ms?.[n]))}\`).join(', ') : '');
    }).join('');
  tip.style.display = 'block';
  const left = (x(times[i]) / W) * box.width;
  tip.style.left = Math.max(0, Math.min(left + 12, box.width - tip.offsetWidth)) + 'px';
  tip.style.top = '8px';
});
hit.addEventListener('pointerleave', () => { tip.style.display = 'none'; cursor.setAttribute('opacity', 0); });

const head = ['Run', 'Date', 'Commit', ...SERIES.flatMap((s) => [s.label, ...SERVICES.map((n) => n + ' ready')])];
const rows = points.map((p) => [esc(label(p)), esc(day(p.created_at)), esc((p.head_sha ?? '').slice(0, 7)),
  ...SERIES.flatMap((s) => {
    const boot = p.boots?.[s.key];
    return [fmt(value(p, s.key)), ...SERVICES.map((n) => fmt(secs(boot?.ready_ms?.[n])))];
  })]);
document.getElementById('table').innerHTML =
  '<thead><tr>' + head.map((h) => \`<th>\${h}</th>\`).join('') + '</tr></thead><tbody>' +
  rows.reverse().map((r) => '<tr>' + r.map((c) => \`<td>\${c}</td>\`).join('') + '</tr>').join('') + '</tbody>';
}
</script>
</body>
</html>
`;
}

/** Rebuilds the page from the store on every request, so a refresh after a collect shows new data. */
function view() {
  const server = http.createServer((req, res) => {
    if (req.url !== '/') {
      res.writeHead(404).end();
      return;
    }
    let html;
    try {
      html = page(readStore().entries ?? {});
    } catch (err) {
      res
        .writeHead(500, { 'content-type': 'text/plain' })
        .end(`cannot read ${STORE}: ${err.message}`);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  server.listen(0, '127.0.0.1', () => {
    console.log(`http://127.0.0.1:${server.address().port}/`);
  });
  process.on('SIGINT', () => {
    server.closeAllConnections();
    server.close(() => process.exit(0));
  });
}

const opts = args(process.argv.slice(2));
if (opts.stage !== 'view') {
  try {
    collect(opts.repo);
  } catch (err) {
    console.error(`collect failed: ${err.message}`);
    if (opts.stage === 'collect') process.exit(1);
    console.error('viewing what is already stored');
  }
}
if (opts.stage !== 'collect') view();
