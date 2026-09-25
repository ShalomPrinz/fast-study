// The fake lecture site: a Moodle Web-Services endpoint, its pluginfile PDFs and its media files.
// The node shim redirects every request for a university host here, so `auto/`'s token check, WS
// parsing, discovery, extractors and probes all run for real against Moodle-shaped answers.
// Listens twice — plain for :80, TLS for :443 — because the URLs in the fixtures are https.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { DEFAULT_DOWNLOAD_MS, FAILURE_ROWS } from '../lib/env.mjs';

const HARNESS = process.env.HUNT_BUGS_HARNESS;
const PORT = Number(process.env.HUNT_BUGS_SITE_PORT ?? 4599);
const TLS_PORT = Number(process.env.HUNT_BUGS_SITE_TLS_PORT ?? 4699);
const TOKEN = process.env.HUNT_BUGS_WSTOKEN;

const VIDEO = path.join(HARNESS, 'fixtures', 'video.mp4');
const PDF = path.join(HARNESS, 'fixtures', 'handout.pdf');

// 'ok' | 'blocked' (bot-protection challenge) | 'invalidtoken' — the two upstream refusals the
// downloader has typed errors for, on tap.
let mode = 'ok';
// The fake tool's live settings live here, beside the URLs they fake, so `/control` changes a
// download's speed without restarting the downloader; `died` makes each /die/ URL fail only once.
let downloadMs = DEFAULT_DOWNLOAD_MS;
const died = new Set();

const SITE = 'https://lemida.biu.ac.il';

// One course, shaped exactly like core_course_get_contents: sections of modules, names as HTML.
// It carries a row per path the downloader can take — direct mp4, YouTube, PDF resource, a plain
// web page (unsupported), a dead link, a 403 and a mid-download drop — plus Hebrew names and one
// multi-file resource.
function courseContents() {
  return [
    {
      id: 1,
      name: 'הרצאות',
      summary: '',
      modules: [
        mod('url', 'הקלטה 1 — מבוא', `${SITE}/media/lecture-01.mp4`),
        mod('url', 'הקלטה 2 — סיבוכיות', `${SITE}/media/lecture-02.mp4`),
        mod('url', 'הקלטה 3 — עצים', `${SITE}/media/הרצאה-03.mp4`),
        mod('url', 'הקלטות הקורס ביוטיוב', 'https://www.youtube.com/playlist?list=huntbugs'),
        mod('url', 'קישור לסילבוס', `${SITE}/page/syllabus.html`),
        mod('url', FAILURE_ROWS.gone, `${SITE}/gone/lecture-09.mp4`),
        mod('url', FAILURE_ROWS.deny, `${SITE}/deny/lecture-07.mp4`),
        mod('url', FAILURE_ROWS.die, `${SITE}/die/lecture-08.mp4`),
      ],
    },
    {
      id: 2,
      name: 'תרגולים',
      summary: '',
      modules: [mod('url', 'תרגול 1 — חזרה', `${SITE}/media/recitation-01.mp4`)],
    },
    {
      id: 3,
      name: 'חומרי עזר',
      summary: '',
      modules: [
        resource('סיכום שיעור 1', [['handout-01.pdf', 1]]),
        resource('דפי תרגול', [
          ['tirgul-01.pdf', 2],
          ['tirgul-02.pdf', 3],
        ]),
      ],
    },
  ];
}

function mod(modname, name, fileurl) {
  return {
    id: Math.abs(hash(name)),
    modname,
    name,
    url: `${SITE}/mod/${modname}/view.php?id=${Math.abs(hash(name))}`,
    contents: [{ type: 'url', fileurl }],
  };
}

function resource(name, files) {
  return {
    id: Math.abs(hash(name)),
    modname: 'resource',
    name,
    url: `${SITE}/mod/resource/view.php?id=${Math.abs(hash(name))}`,
    contents: files.map(([filename, id]) => ({
      type: 'file',
      filename,
      mimetype: 'application/pdf',
      fileurl: `${SITE}/pluginfile.php/${id}/mod_resource/content/1/${filename}`,
    })),
  };
}

function hash(value) {
  let out = 0;
  for (const char of value) out = (out * 31 + char.codePointAt(0)) | 0;
  return out;
}

function json(res, body, status = 200) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
  });
  res.end(payload);
}

// What Radware serves a client it reads as automated: HTTP 200, text/html, no WS body. The one
// answer `WsBlockedError` exists for.
function challenge(res) {
  const body =
    '<!doctype html><title>Bot check</title><p>hunt-bugs: pretending to be a challenge page.';
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

// A file, with the Range support the size probe needs: HEAD for content-length, then a one-byte
// GET whose content-range carries the total.
function serveFile(req, res, file, type) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return json(res, { error: 'missing fixture' }, 404);
  }
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  if (req.method === 'HEAD') {
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
    return res.end();
  }
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, {
      'content-type': type,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${size}`,
    });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
  return fs.createReadStream(file).pipe(res);
}

function handle(req, res) {
  const url = new URL(req.url, 'http://lecture-site.invalid');
  const route = decodeURIComponent(url.pathname);

  if (route === '/control' && req.method === 'POST') {
    const parts = [];
    req.on('data', (part) => parts.push(part));
    return req.on('end', () => {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
      // `reset` is what a reseed sends; any other field sets only itself.
      if (body.reset) {
        mode = 'ok';
        downloadMs = DEFAULT_DOWNLOAD_MS;
        died.clear();
      }
      if (body.mode) mode = body.mode;
      if (body.downloadMs !== undefined) {
        const ms = Number(body.downloadMs);
        if (!Number.isFinite(ms) || ms < 0) return json(res, { error: 'downloadMs: ms ≥ 0' }, 400);
        downloadMs = ms;
      }
      json(res, { mode, downloadMs });
    });
  }
  if (route === '/health') return json(res, { status: 'ok', mode, downloadMs });
  // Asked by the fake tool once per download: how long to take, and whether to drop halfway.
  if (route === '/tool') {
    const target = url.searchParams.get('url') ?? '';
    const die = target.includes('/die/') && !died.has(target);
    if (die) died.add(target);
    return json(res, { downloadMs, die });
  }

  if (mode === 'blocked') return challenge(res);

  if (route === '/webservice/rest/server.php') {
    const fn = url.searchParams.get('wsfunction');
    const token = url.searchParams.get('wstoken');
    if (mode === 'invalidtoken' || (TOKEN && token !== TOKEN)) {
      return json(res, {
        exception: 'moodle_exception',
        errorcode: 'invalidtoken',
        message: 'Invalid token - token not found',
      });
    }
    if (fn === 'core_webservice_get_site_info') {
      return json(res, {
        sitename: 'hunt-bugs Moodle',
        username: 'student',
        userid: 7,
        downloadfiles: 1,
        release: '4.4 (Build: hunt-bugs)',
        functions: [],
      });
    }
    if (fn === 'core_course_get_contents') return json(res, courseContents());
    if (fn === 'tool_mobile_get_autologin_key') {
      return json(res, {
        key: 'hunt-autologin',
        autologinurl: `${SITE}/admin/tool/mobile/autologin.php`,
        warnings: [],
      });
    }
    return json(res, {
      exception: 'moodle_exception',
      errorcode: 'invalidfunction',
      message: `hunt-bugs fake site has no ${fn}`,
    });
  }

  if (route.startsWith('/pluginfile.php/')) return serveFile(req, res, PDF, 'application/pdf');
  // /deny/ and /die/ probe as a video like /media/; they fail only in the fake tool's download.
  if (/^\/(media|deny|die)\//.test(route)) return serveFile(req, res, VIDEO, 'video/mp4');
  if (route.startsWith('/page/')) {
    const body =
      '<!doctype html><meta charset="utf-8"><h1>hunt-bugs: an ordinary web page, not a recording.';
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    return res.end(body);
  }
  if (route.startsWith('/gone/')) return json(res, { error: 'gone' }, 404);

  return json(res, { error: `hunt-bugs fake site has no route for ${route}` }, 404);
}

http.createServer(handle).listen(PORT, '127.0.0.1', () => console.log(`fake site on ${PORT}`));
https
  .createServer(
    {
      key: fs.readFileSync(path.join(HARNESS, 'tls', 'key.pem')),
      cert: fs.readFileSync(path.join(HARNESS, 'tls', 'cert.pem')),
    },
    handle,
  )
  .listen(TLS_PORT, '127.0.0.1', () => console.log(`fake site (tls) on ${TLS_PORT}`));
