#!/usr/bin/env node
// Graphs boot time across every published version: fetches each Release's boot-timing.json through
// `gh` (or reads a local dir of them with --from) and writes one self-contained HTML chart.
//   node delivery/boot-timing.mjs [--repo owner/name] [--from <dir>] [--out <file.html>]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ASSET = 'boot-timing.json';

function args(argv) {
  const out = {
    repo: '{owner}/{repo}',
    from: null,
    out: path.join(os.tmpdir(), 'faststudy-boot-timing.html'),
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in out) || argv[i + 1] === undefined) {
      console.error(
        'usage: node delivery/boot-timing.mjs [--repo owner/name] [--from <dir>] [--out <file.html>]',
      );
      process.exit(2);
    }
    out[key] = argv[++i];
  }
  return out;
}

const gh = (...argv) => execFileSync('gh', argv, { encoding: 'utf8', maxBuffer: 64 << 20 });

/** Every non-draft Release carrying the asset, oldest first, as `{ tag, published, timing }`. */
function fromReleases(repo) {
  const releases = gh(
    'api',
    `repos/${repo}/releases`,
    '--paginate',
    '--jq',
    `.[] | select(.draft | not) | {tag: .tag_name, published: .published_at, asset: ([.assets[] | select(.name == "${ASSET}") | .id][0])}`,
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const points = [];
  for (const { tag, published, asset } of releases) {
    if (asset == null) {
      console.error(`${tag}: no ${ASSET}, skipped`);
      continue;
    }
    const body = gh(
      'api',
      '-H',
      'Accept: application/octet-stream',
      `repos/${repo}/releases/assets/${asset}`,
    );
    points.push({ tag, published, timing: JSON.parse(body) });
  }
  return points.sort((a, b) => a.published.localeCompare(b.published));
}

/** A local dir of boot-timing JSON files, ordered by version — for checking the chart offline. */
function fromDir(dir) {
  const semver = (v) => v.split('.').map(Number);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')))
    .map((timing) => ({ tag: `v${timing.version}`, published: null, timing }))
    .sort((a, b) => {
      const [x, y] = [semver(a.timing.version), semver(b.timing.version)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
}

// The page itself: data inlined as JSON, the chart drawn as SVG by its own script — no fetch, no CDN.
function page(points) {
  const data = JSON.stringify(points).replace(/</g, '\\u003c');
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
.legend { display: flex; gap: 16px; margin-bottom: 8px; color: var(--text-2); }
.legend span::before { content: ""; display: inline-block; width: 12px; height: 2px; margin: 0 6px 4px 0;
  background: var(--c); vertical-align: middle; }
.chart { position: relative; }
svg { display: block; width: 100%; height: auto; overflow: visible; }
svg text { fill: var(--text-2); font-size: 11px; }
.tip { position: absolute; pointer-events: none; background: var(--surface); border: 1px solid var(--grid);
  border-radius: 6px; padding: 8px 10px; font-size: 12px; white-space: nowrap; display: none;
  box-shadow: 0 2px 8px rgb(0 0 0 / .15); }
.tip b { color: var(--text); }
.tip i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: var(--c); }
.table-wrap { overflow-x: auto; margin-top: 24px; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; width: 100%; }
th, td { text-align: right; padding: 4px 8px; border-bottom: 1px solid var(--grid); white-space: nowrap; }
th:first-child, td:first-child { text-align: left; }
th { color: var(--text-2); font-weight: 500; }
</style>
</head>
<body>
<main>
<h1>Boot time per release</h1>
<p>Smoke-run launch to <code>app://bundle</code>, in seconds, on a windows-latest runner — one run per release, so single points are noisy. Service ready times in the table count from main's first log line.</p>
<div class="legend"><span style="--c: var(--s1)">Fresh install, first launch</span><span style="--c: var(--s2)">First launch after update</span></div>
<div class="chart"><svg id="chart"></svg><div class="tip" id="tip"></div></div>
<div class="table-wrap"><table id="table"></table></div>
</main>
<script>
const points = ${data};
const SERIES = [
  { key: 'fresh_install', label: 'Fresh install', color: 'var(--s1)' },
  { key: 'after_update', label: 'After update', color: 'var(--s2)' },
];
const SERVICES = ['database', 'auto', 'backend', 'server'];
const secs = (ms) => (ms == null ? null : ms / 1000);
const value = (p, key) => secs(p.timing.boots?.[key]?.launch_to_app_ms);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => '&#' + c.charCodeAt(0) + ';');
const fmt = (s) => (s == null ? '—' : s.toFixed(1) + ' s');

const W = 960, H = 360, L = 44, R = 16, T = 12, B = 40;
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
const x = (i) => L + (points.length < 2 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
const y = (v) => T + (H - T - B) * (1 - v / yMax);

for (let v = 0; v <= yMax + 1e-9; v += step) {
  el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--grid)', 'stroke-width': v === 0 ? 1 : 0.5 });
  el('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }).textContent = v.toFixed(step < 1 ? 1 : 0);
}
el('text', { x: 0, y: T - 2 }).textContent = 's';
const every = Math.ceil(points.length / 12);
points.forEach((p, i) => {
  if (i % every === 0 || i === points.length - 1)
    el('text', { x: x(i), y: H - B + 18, 'text-anchor': 'middle' }).textContent = p.tag;
});
const cursor = el('line', { y1: T, y2: H - B, stroke: 'var(--text-2)', 'stroke-width': 1, opacity: 0 });
for (const s of SERIES) {
  // A gap where a release has no value for this boot, rather than a line bridging it.
  let d = '', pen = false;
  points.forEach((p, i) => {
    const v = value(p, s.key);
    if (v == null) { pen = false; return; }
    d += (pen ? 'L' : 'M') + x(i) + ' ' + y(v);
    pen = true;
  });
  el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round' });
  points.forEach((p, i) => {
    const v = value(p, s.key);
    if (v != null) el('circle', { cx: x(i), cy: y(v), r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 });
  });
}

const tip = document.getElementById('tip');
const hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
hit.addEventListener('pointermove', (event) => {
  const box = svg.getBoundingClientRect();
  const px = ((event.clientX - box.left) / box.width) * W;
  const i = Math.max(0, Math.min(points.length - 1, Math.round(points.length < 2 ? 0 : ((px - L) / (W - L - R)) * (points.length - 1))));
  const p = points[i];
  cursor.setAttribute('x1', x(i)); cursor.setAttribute('x2', x(i)); cursor.setAttribute('opacity', 0.4);
  tip.innerHTML = \`<b>\${esc(p.tag)}</b>\` + (p.published ? \` · \${p.published.slice(0, 10)}\` : '') +
    SERIES.map((s) => \`<br><i style="--c: \${s.color}"></i>\${s.label}: <b>\${fmt(value(p, s.key))}</b>\`).join('');
  tip.style.display = 'block';
  const left = (x(i) / W) * box.width;
  tip.style.left = Math.min(left + 12, box.width - tip.offsetWidth) + 'px';
  tip.style.top = '8px';
});
hit.addEventListener('pointerleave', () => { tip.style.display = 'none'; cursor.setAttribute('opacity', 0); });

const head = ['Release', ...SERIES.flatMap((s) => [s.label, ...SERVICES.map((n) => n + ' ready')])];
const rows = points.map((p) => [esc(p.tag), ...SERIES.flatMap((s) => {
  const boot = p.timing.boots?.[s.key];
  return [fmt(value(p, s.key)), ...SERVICES.map((n) => fmt(secs(boot?.ready_ms?.[n])))];
})]);
document.getElementById('table').innerHTML =
  '<thead><tr>' + head.map((h) => \`<th>\${h}</th>\`).join('') + '</tr></thead><tbody>' +
  rows.reverse().map((r) => '<tr>' + r.map((c) => \`<td>\${c}</td>\`).join('') + '</tr>').join('') + '</tbody>';
</script>
</body>
</html>
`;
}

const opts = args(process.argv.slice(2));
const points = opts.from ? fromDir(opts.from) : fromReleases(opts.repo);
if (!points.length) {
  console.error(`no ${ASSET} found; nothing to graph`);
  process.exit(1);
}
fs.writeFileSync(opts.out, page(points));
console.log(`${points.length} release(s) → ${opts.out}`);
