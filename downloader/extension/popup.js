/* global discoverServer */
// Set on open by bridge.js's discoverServer(): {base, secret}, or {running: false} when the app is closed.
let server = null;

// Every call to our server carries the launch secret when the bridge gave one; the PDF fetch does not.
function api(path, init = {}) {
  const headers = { ...init.headers };
  if (server.secret) headers['X-FastStudy-Secret'] = server.secret;
  return fetch(`${server.base}${path}`, { ...init, headers });
}

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

function getKind() {
  return document.querySelector('input[name="kind"]:checked').value;
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

function latestName(names, kind) {
  const parsed = names
    .map((name) => {
      const m = name.match(PATTERN);
      if (!m) return null;
      if (kind === 'recitation' && m[3]) return null;
      return { name, prefix: m[1], n: parseInt(m[2], 10), sub: m[3] ? parseInt(m[3], 10) : 0 };
    })
    .filter(Boolean);
  if (!parsed.length) return null;
  return parsed.reduce((a, b) => (a.n > b.n || (a.n === b.n && a.sub > b.sub) ? a : b));
}

function fallbackPrefix(kind) {
  return msg(kind === 'recitation' ? 'dirRecitation' : 'dirLecture');
}

function nextLectureName(course) {
  if (!course) return '';
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
  const course = courses.find((c) => c.name === courseName);
  if (mode === 'latest') {
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
  const course = courses.find((c) => c.name === courseName);
  const kind = getKind();
  fillDatalist(
    $('lectures-list'),
    kind === 'recitation' ? (course?.recitations ?? []) : (course?.lectures ?? []),
  );
  $('lecture').placeholder = msg(
    kind === 'recitation' ? 'placeholderRecitation' : 'placeholderLecture',
  );
  const isPdfMode = !youtubeUrl && !capture && !!pdfUrl;
  $('lecture').value = suggestName(courseName, kind, isPdfMode ? 'latest' : 'next');
}

// False when the server is unreachable, which the status line then says.
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
  if (onPage.length) {
    const select = $('videoSelect');
    const opts = onPage.map((req, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `[…] ${shortenUrl(req.url)}`;
      return opt;
    });
    select.replaceChildren(...opts);
    select.addEventListener('change', () => (capture = onPage[+select.value]));
    capture = onPage[0];
    $('videoField').hidden = false;
    onPage.forEach(async (req, i) => {
      const bytes = await probeSize(req.url, req.headers);
      opts[i].textContent = `[${formatSize(bytes)}] ${shortenUrl(req.url)}`;
    });
    return onPage.length === 1 ? msg('statusOneVideo') : msg('statusManyVideos', onPage.length);
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
  const [online, status] = await Promise.all([loadCourses(), loadSource(), loadFolder()]);
  const hasSource = !!(youtubeUrl || capture || pdfUrl);
  if (!online) setStatus(msg('statusOffline'), true);
  else setStatus(status);
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
