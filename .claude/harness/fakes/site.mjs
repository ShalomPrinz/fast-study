// The fake lecture site: a Moodle Web-Services endpoint, its pluginfile PDFs and its media files.
// The node shim redirects every request for a university host here, so `auto/`'s token check, WS
// parsing, discovery, extractors and probes all run for real against Moodle-shaped answers.
// It also stands in for the object store BIU's videostream .mp4s live on, a host no wall covers.
// Listens twice — plain for :80, TLS for :443 — because the URLs in the fixtures are https.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {
  FAILURE_ROWS,
  FAKE_COURSE_URL,
  FAKE_MOODLE_SITE,
  ZOOM_PASSCODE,
  ZOOM_ROW,
} from '../lib/env.mjs';
import { createSiteControl } from './site-control.mjs';

const HARNESS = process.env.HARNESS_DIR;
const TOKEN = process.env.HARNESS_WSTOKEN;

const VIDEO = path.join(HARNESS, 'fixtures', 'video.mp4');
const PDF = path.join(HARNESS, 'fixtures', 'handout.pdf');

const site = createSiteControl();

const SITE = FAKE_MOODLE_SITE;
const SITE_HOST = new URL(SITE).hostname;
const COURSE_ID = Number(new URL(FAKE_COURSE_URL).searchParams.get('id'));

// One course, shaped exactly like core_course_get_contents: sections of modules, names as HTML.
// It carries a row per path the downloader can take — direct mp4, a videostream, YouTube, a
// PDF resource, a plain web page (unsupported), a dead link, a 403 and a mid-download drop — plus
// Hebrew names, one multi-file resource and a passcode-gated zoom share in a section summary.
function courseContents() {
  return [
    {
      id: 1,
      name: 'הרצאות',
      summary: `<p>${ZOOM_ROW}</p><p><a href="${ZOOM_SHARE}">${ZOOM_SHARE}</a></p>`,
      modules: [
        mod('url', 'הקלטה 1 — מבוא', `${SITE}/media/lecture-01.mp4`),
        mod('url', 'הקלטה 2 — סיבוכיות', `${SITE}/media/lecture-02.mp4`),
        mod('url', 'הקלטה 3 — עצים', `${SITE}/media/הרצאה-03.mp4`),
        videostream(VIDEOSTREAM_NAME),
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

// A videostream activity lists no contents: its .mp4 is named only by tool_mobile_get_content.
const VIDEOSTREAM_NAME = 'הקלטה 4 — גרפים';
const VIDEOSTREAM_CMID = Math.abs(hash(VIDEOSTREAM_NAME));

function videostream(name) {
  const id = Math.abs(hash(name));
  return { id, modname: 'videostream', name, url: `${SITE}/mod/videostream/view.php?id=${id}` };
}

// BIU's videostream .mp4s live on Oracle object storage, off the Moodle host: no token, no cookie,
// never behind the site's bot wall. The fake serves this one path on that host.
const OBJECT_STORE_HOST = 'harness.compat.objectstorage.il-jerusalem-1.oraclecloud.com';
const VIDEOSTREAM_MP4 = `https://${OBJECT_STORE_HOST}/video_bucket/3d/3dac113ed4a4b0299883cc4dca27d65008f266f4.mp4`;

// mod_videostream's Moodle-app page, shaped like the real reply: the template's <video> names the
// .mp4 in a <source>, on the object store as on BIU.
function videostreamContent() {
  const html = `<div class="mod-videostream-mobile">
    <video id="my-player" controls preload="auto" poster="${SITE}/local/video_directory/thumb.php?id=4">
    <source src="${VIDEOSTREAM_MP4}" type="video/mp4" />
    <track kind="subtitles" srclang="he" src="${SITE}/local/video_directory/subs.php?video_id=4&amp;language=he" default />
    </video>
</div>`;
  return {
    templates: [{ id: 'main', html }],
    javascript: '',
    otherdata: [],
    files: [],
    restrict: [],
    disabled: false,
  };
}

// The POSTed form of a WS call: its params arrive in the body, not the query.
function formBody(req) {
  return new Promise((resolve) => {
    const parts = [];
    req.on('data', (part) => parts.push(part));
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(parts).toString('utf8'))));
  });
}

// The `args[i][name]`/`args[i][value]` pairs of tool_mobile_get_content, as one object.
function contentArgs(form) {
  const args = {};
  for (let i = 0; form.has(`args[${i}][name]`); i++) {
    args[form.get(`args[${i}][name]`)] = form.get(`args[${i}][value]`);
  }
  return args;
}

// The zoom share the summary lists, served by this fake on the zoom.us host the shim maps here.
const ZOOM_SHARE = 'https://zoom.us/rec/share/harness-05';

// zoom's share page as ZoomExtractor reads it: a passcode gate (`input#passcode` + `#passcode_btn`)
// that detaches on the right code and leaves a player whose .mp4 request it sniffs; a wrong one stays.
function zoomShare(res, token) {
  const body = `<!doctype html><meta charset="utf-8"><title>harness zoom</title>
<div id="gate"><input id="passcode" type="password"><button id="passcode_btn">Watch Recording</button>
<p id="error"></p></div>
<script>
document.getElementById('passcode_btn').onclick = async () => {
  const passcode = document.getElementById('passcode').value;
  const { ok } = await (await fetch('/rec/validate', { method: 'POST', body: passcode })).json();
  if (!ok) { document.getElementById('error').textContent = 'Wrong passcode'; return; }
  document.getElementById('gate').remove();
  const video = Object.assign(document.createElement('video'), {
    autoplay: true, muted: true, controls: true, src: '/rec/play/${token}.mp4?fid=harness',
  });
  document.body.append(video);
};
</script>`;
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveZoom(req, res, route) {
  const share = /^\/rec\/share\/([\w-]+)$/.exec(route);
  if (share) return zoomShare(res, share[1]);
  if (route === '/rec/validate' && req.method === 'POST') {
    const parts = [];
    req.on('data', (part) => parts.push(part));
    return req.on('end', () =>
      json(res, { ok: Buffer.concat(parts).toString('utf8') === ZOOM_PASSCODE }),
    );
  }
  if (route.startsWith('/rec/play/')) return serveFile(req, res, VIDEO, 'video/mp4');
  return json(res, { error: `harness fake zoom has no route for ${route}` }, 404);
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

// The account's enrolments, shaped like core_enrol_get_users_courses: the fake course, a bilingual one with a
// numeric code, one ended and one hidden. `lang` is the multilang filter's pick; null leaves the raw markup.
function enrolledCourses(lang = null) {
  const yearAgo = Math.floor(Date.now() / 1000) - 365 * 24 * 3600;
  const course = (id, fullname, extra = {}) => ({
    id,
    shortname: `C${id}`,
    fullname,
    displayname: fullname,
    visible: 1,
    hidden: false,
    enddate: 0,
    ...extra,
  });
  return [
    course(COURSE_ID, 'מבני נתונים &amp; אלגוריתמים'),
    course(COURSE_ID + 1, 'חדו״א 1', { enddate: yearAgo }),
    course(COURSE_ID + 2, 'Old Seminar', { hidden: true }),
    course(COURSE_ID + 3, multilang({ he: 'אלגוריתמים 1', en: 'Algorithms 1' }, lang), {
      shortname: '868922001',
    }),
  ];
}

// A name as Moodle's multilang filter leaves it: one language when filtered, else every span, as sent unfiltered.
function multilang(names, lang) {
  if (lang && names[lang]) return names[lang];
  return Object.entries(names)
    .map(([l, n]) => `<span lang="${l}" class="multilang">${n}</span>`)
    .join('');
}

// Moodle's answer to a record that does not exist, under HTTP 200 like every WS fault.
function invalidRecord(table) {
  return {
    exception: 'dml_missing_record_exception',
    errorcode: 'invalidrecord',
    message: `Can't find data record in database table ${table}.`,
  };
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
    '<!doctype html><title>Bot check</title><p>harness: pretending to be a challenge page.';
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

// Radware's real shape in 'radware' mode: a request without the clearance cookie is sent to the
// captcha host, and only a browser that solved it there ever holds the cookie — Node never does.
// Long-lived like `__uzma`, so it outlives a relaunch of the persistent profile; `/control
// {"revoke":true}` (or a reset) makes every cookie already handed out stale.
const CAPTCHA_HOST = 'validate.perfdrive.com';
const clearanceCookie = () => `harness_clearance=${site.clearance()}`;

function hasClearance(req) {
  return (req.headers.cookie ?? '').split(/;\s*/).includes(clearanceCookie());
}

function toCaptcha(res) {
  res.writeHead(302, { location: `https://${CAPTCHA_HOST}/harness/?ssa=1` });
  res.end();
}

// The captcha page polls for a solve armed through `/control {"solve":true}` (or takes a click on
// its button), then visits the site's clearance route, which sets the cookie and lands on the root.
function captchaPage(res) {
  const body = `<!doctype html><meta charset="utf-8"><title>harness captcha</title>
<p>harness: pretending to be Radware's captcha.</p><button id="solve">I am human</button>
<script>
const go = () => { location.href = '${SITE}/__harness/clear'; };
document.getElementById('solve').onclick = go;
setInterval(async () => {
  try { if ((await (await fetch('/harness/solved')).json()).solved) go(); } catch {}
}, 300);
</script>`;
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

// Promise the whole file, send half, then cut the socket: the mid-body drop curl reports as exit 18.
function dropHalfway(res, file, type) {
  const bytes = fs.readFileSync(file);
  res.writeHead(200, { 'content-type': type, 'content-length': bytes.length });
  res.write(bytes.subarray(0, bytes.length >> 1), () => res.destroy());
}

function handle(req, res) {
  const url = new URL(req.url, 'http://lecture-site.invalid');
  const route = decodeURIComponent(url.pathname);

  if (route === '/control' && req.method === 'POST') {
    const parts = [];
    req.on('data', (part) => parts.push(part));
    return req.on('end', () => {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
      try {
        json(res, site.control(body));
      } catch (error) {
        json(res, { error: error.message }, 400);
      }
    });
  }
  const { state } = site;
  if (route === '/health') {
    return json(res, { status: 'ok', ...state, parked: site.parked() });
  }
  if (route === '/tool') return json(res, site.tool(url.searchParams.get('url') ?? ''));

  const host = (req.headers.host ?? '').split(':')[0];
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) return serveZoom(req, res, route);
  if (host === OBJECT_STORE_HOST) {
    if (route === new URL(VIDEOSTREAM_MP4).pathname) return serveFile(req, res, VIDEO, 'video/mp4');
    return json(
      res,
      { code: 'ObjectNotFound', message: `harness object store has no ${route}` },
      404,
    );
  }
  // Only the Moodle host is held: the zoom share, the object store and the captcha page are other sites.
  if (host === SITE_HOST) return site.admit(() => serveSite(req, res, url, route, host));
  return serveSite(req, res, url, route, host);
}

function serveSite(req, res, url, route, host) {
  const { state } = site;
  if (host === CAPTCHA_HOST) {
    if (route === '/harness/solved') return json(res, { solved: site.takeSolve() });
    return captchaPage(res);
  }
  if (route === '/__harness/clear') {
    res.writeHead(302, {
      'set-cookie': `${clearanceCookie()}; Path=/; Secure; Max-Age=315360000`,
      location: `${SITE}/`,
    });
    return res.end();
  }
  if (state.mode === 'radware' && !hasClearance(req)) return toCaptcha(res);

  if (state.mode === 'blocked') return challenge(res);
  if (state.mode === 'blocked_ws' && route.startsWith('/webservice/')) return challenge(res);

  // The no-login AJAX endpoint the pre-login probe asks; `not_moodle` is a web server with no such
  // script, answering the 404 page any non-Moodle site would.
  if (route === '/lib/ajax/service-nologin.php') {
    if (state.mode === 'not_moodle') {
      const body = '<!doctype html><title>404</title><p>harness: not a Moodle site.';
      res.writeHead(404, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      });
      return res.end(body);
    }
    const parts = [];
    req.on('data', (part) => parts.push(part));
    return req.on('end', () => {
      let calls;
      try {
        calls = JSON.parse(Buffer.concat(parts).toString('utf8'));
      } catch {
        calls = [];
      }
      json(
        res,
        (Array.isArray(calls) ? calls : []).map((call) =>
          call?.methodname === 'tool_mobile_get_public_config'
            ? {
                error: false,
                data: {
                  wwwroot: SITE,
                  sitename: 'harness Moodle',
                  enablemobilewebservice: state.mode === 'mobile_service_off' ? 0 : 1,
                  maintenanceenabled: 0,
                  launchurl: `${SITE}/admin/tool/mobile/launch.php`,
                  warnings: [],
                },
              }
            : {
                error: true,
                exception: {
                  errorcode: 'servicerequireslogin',
                  message: `harness fake site has no public ${call?.methodname}`,
                },
              },
        ),
      );
    });
  }

  // The mobile-app login, already past SSO and MFA: straight to the moodlemobile:// redirect auto/
  // captures, carrying the seeded token as Moodle's `md5(wwwroot + passport):::wstoken:::privatetoken`.
  if (route === '/admin/tool/mobile/launch.php') {
    const passport = url.searchParams.get('passport') ?? '';
    const hash = crypto.createHash('md5').update(`${SITE}${passport}`).digest('hex');
    const apptoken = Buffer.from(`${hash}:::${TOKEN}:::harness-private`).toString('base64');
    res.writeHead(302, { location: `moodlemobile://token=${apptoken}` });
    return res.end();
  }

  if (route === '/webservice/rest/server.php') {
    const fn = url.searchParams.get('wsfunction');
    const token = url.searchParams.get('wstoken');
    if (state.mode === 'invalidtoken' || (TOKEN && token !== TOKEN)) {
      return json(res, {
        exception: 'moodle_exception',
        errorcode: 'invalidtoken',
        message: 'Invalid token - token not found',
      });
    }
    if (fn === 'core_webservice_get_site_info') {
      const functions = [
        'core_webservice_get_site_info',
        'core_course_get_contents',
        'core_course_get_course_module',
        'tool_mobile_get_content',
        'core_enrol_get_users_courses',
      ]
        .filter((name) => state.mode !== 'missing_function' || name !== 'core_course_get_contents')
        .filter(
          (name) => state.mode !== 'no_enrol_function' || name !== 'core_enrol_get_users_courses',
        );
      return json(res, {
        sitename: 'harness Moodle',
        siteurl: SITE,
        username: 'student',
        userid: 7,
        downloadfiles: state.mode === 'downloads_disabled' ? 0 : 1,
        release: '4.4 (Build: harness)',
        functions: functions.map((name) => ({ name, version: '2024042200' })),
      });
    }
    if (fn === 'core_enrol_get_users_courses') {
      // A function outside the token's service: Moodle's answer, which auto reads as a dead token.
      if (state.mode === 'no_enrol_function') {
        return json(res, {
          exception: 'webservice_access_exception',
          errorcode: 'accessexception',
          message: 'Access control exception',
        });
      }
      const filtered = url.searchParams.get('moodlewssettingfilter') === 'true';
      return json(
        res,
        enrolledCourses(filtered ? url.searchParams.get('moodlewssettinglang') : null),
      );
    }
    if (fn === 'core_course_get_contents') {
      const enrolled = enrolledCourses().some(
        (c) => c.id === Number(url.searchParams.get('courseid')),
      );
      return json(res, enrolled ? courseContents() : invalidRecord('course'));
    }
    if (fn === 'core_course_get_course_module') {
      const cmid = Number(url.searchParams.get('cmid'));
      if (cmid !== VIDEOSTREAM_CMID) return json(res, invalidRecord('course_modules'));
      return json(res, {
        cm: { id: cmid, course: COURSE_ID, modname: 'videostream', name: VIDEOSTREAM_NAME },
        warnings: [],
      });
    }
    // The real handler answers only the app's exact call: POST, this component and method, and the
    // module's own course and cmid among the args.
    if (fn === 'tool_mobile_get_content') {
      if (req.method !== 'POST') return json(res, invalidRecord('course_modules'));
      return formBody(req).then((form) => {
        const args = contentArgs(form);
        const ours =
          form.get('component') === 'mod_videostream' &&
          form.get('method') === 'view_videostream' &&
          Number(args.cmid) === VIDEOSTREAM_CMID &&
          Number(args.courseid) === COURSE_ID;
        json(res, ours ? videostreamContent() : invalidRecord('course_modules'));
      });
    }
    return json(res, {
      exception: 'moodle_exception',
      errorcode: 'invalidfunction',
      message: `harness fake site has no ${fn}`,
    });
  }

  if (route.startsWith('/pluginfile.php/')) return serveFile(req, res, PDF, 'application/pdf');
  // /deny/ and /die/ probe as a video like /media/; they fail only on the download auto streams.
  if (/^\/(media|deny|die)\//.test(route)) {
    const fault = site.fault(route, { method: req.method, range: req.headers.range });
    if (fault === 'deny') return json(res, { error: 'forbidden' }, 403);
    if (fault === 'die') return dropHalfway(res, VIDEO, 'video/mp4');
    return serveFile(req, res, VIDEO, 'video/mp4');
  }
  if (route.startsWith('/page/')) {
    const body =
      '<!doctype html><meta charset="utf-8"><h1>harness: an ordinary web page, not a recording.';
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    return res.end(body);
  }
  if (route === '/') {
    const body = '<!doctype html><meta charset="utf-8"><h1>harness Moodle';
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body),
    });
    return res.end(body);
  }
  if (route.startsWith('/gone/')) return json(res, { error: 'gone' }, 404);

  return json(res, { error: `harness fake site has no route for ${route}` }, 404);
}

// Each listener reports the port it bound on a line of its own, which setup reads back.
const plain = http
  .createServer(handle)
  .listen(Number(process.env.FASTSTUDY_PORT ?? 0), '127.0.0.1', () =>
    console.log(`FASTSTUDY_PORT=${plain.address().port}`),
  );
const tls = https
  .createServer(
    {
      key: fs.readFileSync(path.join(HARNESS, 'tls', 'key.pem')),
      cert: fs.readFileSync(path.join(HARNESS, 'tls', 'cert.pem')),
    },
    handle,
  )
  .listen(Number(process.env.HARNESS_SITE_TLS_PORT ?? 0), '127.0.0.1', () =>
    console.log(`HARNESS_SITE_TLS_PORT=${tls.address().port}`),
  );
