const SERVER = 'http://localhost:3052';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

let courses = [];
let interceptedRequest = null;
let pdfPageUrl = null;
let youtubeUrl = null;

function isYouTubeUrl(url) {
  try { return YOUTUBE_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

function $(id) { return document.getElementById(id); }

function getKind() {
  return document.querySelector('input[name="kind"]:checked').value;
}

function setStatus(text, color) {
  const el = $('status');
  el.innerText = text;
  if (color) el.style.color = color;
}

// Mirrors Sidebar.tsx::suggestName so popup choices stay consistent with the app.
function suggestLectureName(course) {
  const names = course?.lectures ?? [];
  const matches = names
    .map((n) => { const m = n.match(/^Lecture\s+(\d+)(?:\.(\d+))?$/i); return m ? { n: +m[1], sub: m[2] ? +m[2] : 0 } : null; })
    .filter(Boolean);
  if (!matches.length) return 'Lecture 1';
  const latest = matches.reduce((a, b) => (a.n > b.n || (a.n === b.n && a.sub > b.sub) ? a : b));
  if (latest.sub === 0) return `Lecture ${latest.n + 1}`;
  if (latest.sub === 1) return `Lecture ${latest.n}.2`;
  return `Lecture ${latest.n + 1}.1`;
}

function suggestRecitationName(course) {
  const nums = (course?.recitations ?? [])
    .map((n) => { const m = n.match(/^Recitation\s+(\d+)$/i); return m ? +m[1] : null; })
    .filter((x) => x !== null);
  if (!nums.length) return 'Recitation 1';
  return `Recitation ${Math.max(...nums) + 1}`;
}

function suggestName(courseName, kind) {
  const course = courses.find((c) => c.name === courseName);
  return kind === 'recitation' ? suggestRecitationName(course) : suggestLectureName(course);
}

function refreshLectureSuggestions() {
  const courseName = $('course').value;
  const course = courses.find((c) => c.name === courseName);
  const kind = getKind();
  const items = kind === 'recitation' ? (course?.recitations ?? []) : (course?.lectures ?? []);
  $('lectures-list').innerHTML = items.map((n) => `<option value="${n}"></option>`).join('');
  $('lecture').value = suggestName(courseName, kind);
}

async function loadCourses() {
  try {
    const res = await fetch(`${SERVER}/courses`);
    if (!res.ok) throw new Error();
    courses = await res.json();
    $('courses-list').innerHTML = courses.map((c) => `<option value="${c.name}"></option>`).join('');
  } catch {
    setStatus('Server offline - start `npm start` in downloader/', '#ff6666');
  }
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    const file = u.pathname.split('/').pop();
    return `${u.hostname} … ${file}`;
  } catch {
    return url.slice(0, 80);
  }
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '?';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

// HEAD often works on signed video URLs (token is in the query string).
// Fall back to a single-byte ranged GET to read Content-Range when HEAD is
// blocked or returns no Content-Length.
async function probeSize(url) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const len = head.headers.get('content-length');
    if (head.ok && len) return +len;
  } catch {}
  try {
    const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
    const range = res.headers.get('content-range');
    const m = range && range.match(/\/(\d+)\s*$/);
    if (m) return +m[1];
  } catch {}
  return null;
}

function selectVideo(req) {
  interceptedRequest = req;
}

async function loadIntercepted() {
  const { videoRequests: allRequests = [] } = await chrome.storage.local.get(['videoRequests']);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = tab?.url ?? null;

  if (pageUrl && isYouTubeUrl(pageUrl)) {
    youtubeUrl = pageUrl;
    $('videoSelectLabel').style.display = 'none';
    $('videoSelect').style.display = 'none';
    $('youtubeUrlLabel').style.display = '';
    $('youtubeUrl').style.display = '';
    $('youtubeUrl').value = pageUrl;
    setStatus('YouTube page detected - yt-dlp will be used.', '#00ff66');
    if (tab?.id != null) chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    return;
  }

  const videoRequests = allRequests.filter((r) => r.pageUrl === pageUrl);
  const select = $('videoSelect');
  select.innerHTML = '';

  if (!videoRequests.length) {
    setStatus('Waiting for video stream - hit Play in the player.', '#aaaaaa');
    select.innerHTML = '<option>(none captured)</option>';
    return;
  }

  setStatus(`${videoRequests.length} video request(s) intercepted.`, '#00ff66');
  if (tab?.id != null) chrome.action.setBadgeText({ tabId: tab.id, text: '' });

  const opts = [];
  for (const [i, req] of videoRequests.entries()) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `[…] ${shortenUrl(req.url)}`;
    select.appendChild(opt);
    opts.push(opt);
  }
  select.addEventListener('change', () => selectVideo(videoRequests[+select.value]));
  selectVideo(videoRequests[0]);

  videoRequests.forEach(async (req, i) => {
    const bytes = await probeSize(req.url);
    opts[i].textContent = `[${formatSize(bytes)}] ${shortenUrl(req.url)}`;
  });
}

// PDFs aren't gated like .mp4 streams — Chrome just renders them at the tab
// URL, so we can grab the URL straight off the active tab instead of sniffing
// network requests + replaying headers.
function isPdfUrl(url) {
  try { return new URL(url).pathname.toLowerCase().endsWith('.pdf'); } catch { return false; }
}

async function loadActivePagePdf() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = tab?.url ?? null;
  if (!pageUrl || !isPdfUrl(pageUrl)) return;
  pdfPageUrl = pageUrl;
  $('pdfSection').style.display = '';
  $('pdfUrl').value = pageUrl;
}

async function sendToServer() {
  const course = $('course').value.trim();
  const lecture = $('lecture').value.trim();
  const kind = getKind();
  const btn = $('nodeBtn');

  if (!youtubeUrl && !interceptedRequest) return alert('No video intercepted yet.');
  if (!course || !lecture) return alert('Pick a course and lecture first.');

  const endpoint = youtubeUrl ? '/download-youtube' : '/download';
  const payload = youtubeUrl
    ? { url: youtubeUrl, course, lecture, kind }
    : { url: interceptedRequest.url, headers: interceptedRequest.headers, course, lecture, kind };

  btn.disabled = true;
  btn.innerText = 'Sending...';
  try {
    const res = await fetch(`${SERVER}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? 'Server rejected');
    btn.innerText = 'Downloading in background!';
    btn.style.background = '#00cc52';
    setTimeout(() => {
      btn.innerText = 'Download';
      btn.style.background = '';
      btn.disabled = false;
    }, 2000);
  } catch (e) {
    alert(`Could not start download: ${e.message ?? e}`);
    btn.innerText = 'Download';
    btn.disabled = false;
  }
}

async function sendPdfToServer() {
  const course = $('course').value.trim();
  const lecture = $('lecture').value.trim();
  const kind = getKind();
  const btn = $('pdfBtn');

  if (!pdfPageUrl) return alert('Open a PDF page first.');
  if (!course || !lecture) return alert('Pick a course and lecture first.');

  btn.disabled = true;
  btn.innerText = 'Sending...';
  try {
    // Fetch the PDF here in the popup so Chrome includes the user's session
    // cookies automatically — works for any site the user is logged into,
    // and avoids re-implementing auth/header-replay on the server.
    const pdfRes = await fetch(pdfPageUrl, { credentials: 'include' });
    if (!pdfRes.ok) throw new Error(`Fetch PDF failed: HTTP ${pdfRes.status}`);
    const blob = await pdfRes.blob();
    console.log('[downloader] PDF blob', { size: blob.size, type: blob.type });
    const qs = new URLSearchParams({ course, lecture, kind }).toString();
    const res = await fetch(`${SERVER}/upload-pdf?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: blob,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${txt || 'no body'}`);
    }
    btn.innerText = 'Downloading in background!';
    btn.style.background = '#00cc52';
    setTimeout(() => {
      btn.innerText = 'Download PDF';
      btn.style.background = '';
      btn.disabled = false;
    }, 2000);
  } catch (e) {
    alert(`Could not start PDF download: ${e.message ?? e}`);
    btn.innerText = 'Download PDF';
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadCourses(), loadIntercepted(), loadActivePagePdf()]);
  $('course').addEventListener('input', refreshLectureSuggestions);
  document.querySelectorAll('input[name="kind"]').forEach((el) =>
    el.addEventListener('change', refreshLectureSuggestions)
  );
  $('nodeBtn').addEventListener('click', sendToServer);
  $('pdfBtn').addEventListener('click', sendPdfToServer);
});
