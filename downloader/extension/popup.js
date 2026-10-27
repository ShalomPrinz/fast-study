/* global discoverServer */
// Set on open by bridge.js's discoverServer(): {base, secret}, or {running: false} when the app is closed.
let server = null;

// Every call to our server carries the launch secret when the bridge gave one; the PDF fetch does not.
function api(path, init = {}) {
  const headers = { ...init.headers };
  if (server.secret) headers['X-FastStudy-Secret'] = server.secret;
  return fetch(`${server.base}${path}`, { ...init, headers });
}

// The server accepts at most 30 captures per classification.
const MAX_HLS_CAPTURES = 30;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

const msg = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));

// Direction and language follow Chrome's UI language, as the _locales folder Chrome picked does.
document.documentElement.dir = msg('@@bidi_dir');
document.documentElement.lang = msg('@@ui_locale').replace('_', '-');

let courses = [];
let capture = null;
let youtubeUrl = null;
let pdfUrl = null;
let tabTitle = '';
// 'app' saves into a course in FastStudy; 'general' into the computer folder the server keeps.
let mode = 'app';
let generalFolder = '';
// The live course-structure mode, for a typed-in course not in `courses` yet; null when unknown.
let courseStructure = null;
// Whether the course in the field takes only lectures: its kind choice is hidden and new items are lectures.
let lecturesOnly = false;

function $(id) {
  return document.getElementById(id);
}

function translateStatic() {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = msg(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = msg(el.dataset.i18nPlaceholder);
  }
  for (const el of document.querySelectorAll('[data-i18n-aria-label]')) {
    el.setAttribute('aria-label', msg(el.dataset.i18nAriaLabel));
  }
}

// Shows the fields of one mode; each mode-specific field carries `data-mode`.
function applyMode(next) {
  mode = next;
  for (const el of document.querySelectorAll('[data-mode]')) el.hidden = el.dataset.mode !== mode;
  $('kinds').hidden ||= lecturesOnly;
  document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
}

// The tab title as a Windows-legal file stem, the server adding the extension. The server enforces
// the same rule (validate.js::storedName); this only keeps the prefill from changing under the user.
function suggestFileName(title) {
  const stem = title
    .replace(/ - YouTube$/, '')
    .replace(/\.pdf$/i, '')
    // eslint-disable-next-line no-control-regex -- control characters are illegal in a Windows name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .trim();
  return [...stem]
    .slice(0, 80)
    .join('')
    .replace(/[. ]+$/, '');
}

// A lectures-only course sends `lecture`, except for a name that is already one of its recitations,
// which keeps its real kind so a PDF attaches to it instead of creating a lecture beside it.
function getKind() {
  if (lecturesOnly) {
    const course = findCourse($('course').value);
    const name = $('lecture').value.trim();
    const isRecitation = course?.recitations?.includes(name) && !course.lectures.includes(name);
    return isRecitation ? 'recitation' : 'lecture';
  }
  return document.querySelector('input[name="kind"]:checked').value;
}

function findCourse(name) {
  return courses.find((c) => c.name === name);
}

// A listed course carries its own flag; a typed-in one follows the live mode, visible when unknown.
function isLecturesOnly(courseName) {
  const course = findCourse(courseName);
  return course ? !!course.lectures_only : courseStructure === 'lectures_all';
}

function setStatus(text, danger = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('status--danger', danger);
}

// The one line under the button: a translated headline, plus the server's own prose verbatim.
function showResult(headline, { detail = '', ok = false } = {}) {
  $('resultHeadline').textContent = headline;
  $('resultDetail').textContent = detail;
  $('resultDetail').hidden = !detail;
  $('result').className = `result ${ok ? 'result--ok' : 'result--danger'}`;
  $('result').hidden = false;
}

function clearResult() {
  $('result').hidden = true;
}

// A user-typed name kept as one directional run inside a translated sentence.
const isolate = (text) => `⁨${text}⁩`;

// ── Name suggestions: a port of frontend/src/features/lectures/utils/nextName.ts ──

const PATTERN = /^(.+?)\s+(\d+)(?:\.(\d+))?$/;

function parseName(name, kind) {
  const m = name.match(PATTERN);
  if (!m) return null;
  if (kind === 'recitation' && m[3]) return null;
  const sub = m[3] ? parseInt(m[3], 10) : 0;
  return { name, kind, prefix: m[1], n: parseInt(m[2], 10), sub };
}

// The newest parsed name: highest number, then a recitation after a lecture on the same number (the
// merged order of a lectures-only course), then highest sub. Null when none parse.
function newest(parsed) {
  const items = parsed.filter(Boolean);
  if (!items.length) return null;
  const rank = (p) => (p.kind === 'recitation' ? 1 : 0);
  const later = (a, b) => a.n - b.n || rank(a) - rank(b) || a.sub - b.sub;
  return items.reduce((a, b) => (later(a, b) > 0 ? a : b));
}

function latestName(names, kind) {
  return newest(names.map((name) => parseName(name, kind)));
}

// A lectures-only course's newest item over its lectures and recitations together.
function latestMerged(course) {
  return newest([
    ...course.lectures.map((name) => parseName(name, 'lecture')),
    ...(course.recitations ?? []).map((name) => parseName(name, 'recitation')),
  ]);
}

function fallbackPrefix(kind) {
  return msg(kind === 'recitation' ? 'dirRecitation' : 'dirLecture');
}

// The number comes from both lists, the prefix from the lectures, since the new item is a lecture.
function nextMergedName(course) {
  const latest = latestMerged(course);
  const prefix = latestName(course.lectures, 'lecture')?.prefix ?? fallbackPrefix('lecture');
  if (!latest) return `${prefix} 1`;
  if (latest.kind === 'lecture' && latest.sub === 1) return `${prefix} ${latest.n}.2`;
  return `${prefix} ${latest.n + 1}`;
}

function nextLectureName(course) {
  if (!course) return '';
  if (course.lectures_only) return nextMergedName(course);
  const latest = latestName(course.lectures, 'lecture');
  if (!latest) return `${fallbackPrefix('lecture')} 1`;
  if (latest.sub === 1) return `${latest.prefix} ${latest.n}.2`;
  return `${latest.prefix} ${latest.n + 1}`;
}

function nextRecitationName(course) {
  const latest = course ? latestName(course.recitations ?? [], 'recitation') : null;
  return latest ? `${latest.prefix} ${latest.n + 1}` : `${fallbackPrefix('recitation')} 1`;
}

// mode 'next' names a fresh session (a video); 'latest' the newest existing one (a PDF attaches to
// the lecture just watched), empty when there is none.
function suggestName(courseName, kind, mode) {
  const course = findCourse(courseName);
  if (mode === 'latest') {
    if (course?.lectures_only) return latestMerged(course)?.name ?? '';
    const items = kind === 'recitation' ? (course?.recitations ?? []) : (course?.lectures ?? []);
    return latestName(items, kind)?.name ?? '';
  }
  return kind === 'recitation' ? nextRecitationName(course) : nextLectureName(course);
}

function fillDatalist(list, names) {
  list.replaceChildren(
    ...names.map((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      return opt;
    }),
  );
}

function refreshLectureSuggestions() {
  const courseName = $('course').value;
  const course = findCourse(courseName);
  lecturesOnly = isLecturesOnly(courseName);
  $('kinds').hidden = mode !== 'app' || lecturesOnly;
  // In a lectures-only course the name picks the kind, so suggestions go by the lecture side.
  const kind = lecturesOnly ? 'lecture' : getKind();
  const names = lecturesOnly
    ? [...(course?.lectures ?? []), ...(course?.recitations ?? [])]
    : kind === 'recitation'
      ? (course?.recitations ?? [])
      : (course?.lectures ?? []);
  fillDatalist($('lectures-list'), names);
  $('lecture').placeholder = msg(
    kind === 'recitation' ? 'placeholderRecitation' : 'placeholderLecture',
  );
  const isPdfMode = !youtubeUrl && !capture && !!pdfUrl;
  $('lecture').value = suggestName(courseName, kind, isPdfMode ? 'latest' : 'next');
}

// False when the server is unreachable, which the status line then says.
// The live mode decides the kind choice for a course the request will create; a failure leaves the
// choice visible.
async function loadCourseStructure() {
  try {
    const res = await api('/course-structure');
    if (res.ok) courseStructure = (await res.json()).course_structure;
  } catch {}
}

async function loadCourses() {
  try {
    const res = await api('/courses');
    if (!res.ok) throw new Error();
    courses = await res.json();
    fillDatalist(
      $('courses-list'),
      courses.map((c) => c.name),
    );
    return true;
  } catch {
    return false;
  }
}

function isYouTubeUrl(url) {
  try {
    return YOUTUBE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

// PDFs aren't gated like .mp4 streams — Chrome renders them at the tab URL, so the URL comes straight
// off the active tab instead of from sniffed requests.
function isPdfUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname} … ${u.pathname.split('/').pop()}`;
  } catch {
    return url.slice(0, 80);
  }
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '?';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return msg('sizeGb', (mb / 1024).toFixed(2));
  return msg('sizeMb', mb.toFixed(1));
}

// Cookie is a forbidden fetch() header, so an auth-gated CDN answers the popup no size; the server's
// Node http can replay it.
async function probeSize(url, headers) {
  try {
    const res = await api('/probe-size', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, headers: headers ?? [] }),
    });
    const { bytes } = await res.json();
    return bytes ?? null;
  } catch {
    return null;
  }
}

function isHlsUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.m3u8');
  } catch {
    return false;
  }
}

// The server fetches each captured playlist with its headers and answers the streams worth offering,
// best first, plus the captures it could not read.
async function classifyStreams(captures) {
  const res = await api('/hls-streams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ captures: captures.map(({ url, headers }) => ({ url, headers })) }),
  });
  if (!res.ok) throw new Error(await serverError(res));
  return res.json();
}

function formatDuration(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Two masters can share a file name, so the last two path segments tell them apart.
function streamLabel(stream) {
  const parts = [formatSize(stream.estimatedBytes)];
  if (stream.durationSeconds != null) parts.push(formatDuration(stream.durationSeconds));
  if (stream.hasAudio === false) parts.push(msg('labelNoAudio'));
  let name = stream.url.slice(0, 80);
  try {
    name = new URL(stream.url).pathname.split('/').filter(Boolean).slice(-2).join('/');
  } catch {}
  return `[${parts.join(' · ')}] ${name}`;
}

// A failure the status line carries: the translated headline, the server's prose beneath.
function statusError({ headline, detail }) {
  $('statusDetail').textContent = detail ?? '';
  $('statusDetail').hidden = !detail;
  return headline;
}

// Reads the active tab and this page's captures; shows exactly one source. A video wins over a PDF —
// a captured .mp4 is the rarer, harder thing to get.
async function loadSource() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = tab?.url ?? null;
  tabTitle = tab?.title ?? '';
  if (tab?.id != null) chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {});
  if (!pageUrl) return msg('statusNothing');

  if (isYouTubeUrl(pageUrl)) {
    youtubeUrl = pageUrl;
    $('youtubeUrl').value = pageUrl;
    $('youtubeField').hidden = false;
    return msg('statusYoutube');
  }

  const { videoRequests = [] } = await chrome.storage.local.get('videoRequests');
  // Exact-URL match, so captures from another page or tab never leak in.
  const onPage = videoRequests.filter((r) => r.pageUrl === pageUrl);
  const mp4s = onPage.filter((r) => !isHlsUrl(r.url));
  const playlists = onPage.filter((r) => isHlsUrl(r.url)).slice(0, MAX_HLS_CAPTURES);
  let hls = { streams: [], failed: [] };
  let hlsError = null;
  if (playlists.length) {
    try {
      hls = await classifyStreams(playlists);
    } catch (e) {
      hlsError = { headline: msg('errHlsStreams'), detail: e.message };
    }
  }

  // Each option is {capture, label}; an .mp4's label gains its size when the probe answers.
  const options = [
    ...hls.streams.map((s) => ({
      capture: playlists.find((r) => r.url === s.url),
      label: streamLabel(s),
    })),
    ...mp4s.map((capture) => ({ capture, label: `[…] ${shortenUrl(capture.url)}`, probe: true })),
  ].filter((o) => o.capture);

  if (options.length) {
    const select = $('videoSelect');
    const opts = options.map((o, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = o.label;
      return opt;
    });
    select.replaceChildren(...opts);
    select.addEventListener('change', () => (capture = options[+select.value].capture));
    capture = options[0].capture;
    $('videoField').hidden = false;
    options.forEach(async (o, i) => {
      if (!o.probe) return;
      const bytes = await probeSize(o.capture.url, o.capture.headers);
      opts[i].textContent = `[${formatSize(bytes)}] ${shortenUrl(o.capture.url)}`;
    });
    return options.length === 1 ? msg('statusOneVideo') : msg('statusManyVideos', options.length);
  }

  if (hlsError) return statusError(hlsError);
  // Only a 401/403 on every playlist means the page's cookies are gone; any other failure is shown as-is.
  if (hls.failed.length) {
    const refused = hls.failed.every((f) => /^HTTP 40[13]$/.test(f.detail));
    const headline = msg(refused ? 'errHlsExpired' : 'errHlsStreams');
    return statusError({ headline, detail: hls.failed[0].detail });
  }

  if (isPdfUrl(pageUrl)) {
    pdfUrl = pageUrl;
    $('pdfUrl').value = pageUrl;
    $('pdfField').hidden = false;
    return msg('statusPdf');
  }
  return msg('statusNothing');
}

// The server's failure body is {error, code, params}; its English `error` rides verbatim.
async function serverError(res) {
  try {
    return (await res.json()).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// The general folder's path, read on open; the popup never edits it, the app window's picker does.
async function loadFolder() {
  try {
    const res = await api('/general-folder');
    if (res.ok) generalFolder = (await res.json()).folder;
  } catch {}
  $('folder').value = generalFolder;
  $('folder').title = generalFolder;
}

// The OS picker can't run in this popup (Chrome closes it on the dialog's focus), so the server asks
// the app window to open one; the new folder shows the next time the popup opens.
async function chooseFolder() {
  clearResult();
  try {
    const res = await api('/general-folder/pick', { method: 'POST' });
    if (res.ok) return showResult(msg('pickInApp'), { ok: true });
    const body = await res.json().catch(() => ({}));
    if (body.code === 'folder_picker_unavailable') return showResult(msg('errOpenAppWindow'));
    showResult(msg('errChooseFolder'), { detail: body.error ?? `HTTP ${res.status}` });
  } catch {
    showResult(msg('statusOffline'));
  }
}

async function startVideo(course, lecture, kind) {
  const endpoint = youtubeUrl ? '/download-youtube' : '/download';
  const payload = youtubeUrl
    ? { url: youtubeUrl, course, lecture, kind }
    : { url: capture.url, headers: capture.headers, course, lecture, kind };
  const res = await api(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return showResult(msg('errStart'), { detail: await serverError(res) });
  const { target } = await res.json();
  showResult(msg('doneVideo', isolate(target)), { ok: true });
}

async function startGeneralVideo(fileName) {
  const endpoint = youtubeUrl ? '/download-youtube' : '/download';
  const source = youtubeUrl ? { url: youtubeUrl } : { url: capture.url, headers: capture.headers };
  const res = await api(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...source, dest: 'folder', fileName }),
  });
  if (!res.ok) return showResult(msg('errStart'), { detail: await serverError(res) });
  const body = await res.json();
  showResult(msg('doneGeneralVideo', isolate(body.fileName), isolate(body.folder)), { ok: true });
}

// Fetched here so Chrome attaches the user's own session cookies for the site; null after showing
// the failure.
async function fetchPdf() {
  try {
    const pdfRes = await fetch(pdfUrl, { credentials: 'include' });
    if (!pdfRes.ok) throw new Error(`HTTP ${pdfRes.status}`);
    return await pdfRes.blob();
  } catch (e) {
    showResult(msg('errPdfFetch'), { detail: e.message });
    return null;
  }
}

async function saveGeneralPdf(fileName) {
  const blob = await fetchPdf();
  if (!blob) return;
  const qs = new URLSearchParams({ dest: 'folder', fileName }).toString();
  const res = await api(`/upload-pdf?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: blob,
  });
  if (!res.ok) return showResult(msg('errPdfStore'), { detail: await serverError(res) });
  const body = await res.json();
  showResult(msg('doneGeneralPdf', isolate(body.fileName), isolate(body.folder)), { ok: true });
}

async function uploadPdf(course, lecture, kind) {
  const blob = await fetchPdf();
  if (!blob) return;
  const qs = new URLSearchParams({ course, lecture, kind }).toString();
  const res = await api(`/upload-pdf?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: blob,
  });
  if (!res.ok) return showResult(msg('errPdfStore'), { detail: await serverError(res) });
  const { target } = await res.json();
  showResult(msg('donePdf', isolate(target)), { ok: true });
}

async function submit(event) {
  event.preventDefault();
  clearResult();
  const course = $('course').value.trim();
  const lecture = $('lecture').value.trim();
  const fileName = $('fileName').value.trim();
  if (mode === 'app' && (!course || !lecture)) return showResult(msg('errMissingTarget'));
  if (mode === 'general' && !fileName) return showResult(msg('errMissingFileName'));

  const btn = $('submit');
  btn.disabled = true;
  btn.textContent = msg('btnDownloading');
  try {
    const video = !!(youtubeUrl || capture);
    if (mode === 'general') await (video ? startGeneralVideo(fileName) : saveGeneralPdf(fileName));
    else if (video) await startVideo(course, lecture, getKind());
    else await uploadPdf(course, lecture, getKind());
  } catch {
    // fetch() itself threw: the local server is not answering.
    showResult(msg('statusOffline'));
  } finally {
    btn.disabled = false;
    btn.textContent = msg('btnDownload');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  translateStatic();
  const { popupMode } = await chrome.storage.local.get('popupMode');
  applyMode(popupMode === 'general' ? 'general' : 'app');
  server = await discoverServer();
  if (server.running === false) return setStatus(msg('statusAppClosed'), true);
  const [online, status] = await Promise.all([
    loadCourses(),
    loadSource(),
    loadFolder(),
    loadCourseStructure(),
  ]);
  const hasSource = !!(youtubeUrl || capture || pdfUrl);
  if (!online) setStatus(msg('statusOffline'), true);
  else setStatus(status, !$('statusDetail').hidden);
  $('form').hidden = !hasSource;
  $('fileName').value = suggestFileName(tabTitle);
  for (const el of document.querySelectorAll('input[name="mode"]')) {
    el.addEventListener('change', () => {
      applyMode(el.value);
      clearResult();
      chrome.storage.local.set({ popupMode: el.value });
    });
  }
  $('chooseFolder').addEventListener('click', chooseFolder);
  refreshLectureSuggestions();
  $('course').addEventListener('input', refreshLectureSuggestions);
  for (const el of document.querySelectorAll('input[name="kind"]')) {
    el.addEventListener('change', refreshLectureSuggestions);
  }
  $('form').addEventListener('submit', submit);
});
