const SERVER = 'http://localhost:3052';

let courses = [];
let interceptedRequest = null;

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
  return `Lecture ${latest.n + 1}`;
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
  const { videoRequests = [] } = await chrome.storage.local.get(['videoRequests']);
  const select = $('videoSelect');
  select.innerHTML = '';

  if (!videoRequests.length) {
    setStatus('Waiting for video stream — hit Play in the player.', '#aaaaaa');
    select.innerHTML = '<option>(none captured)</option>';
    return;
  }

  setStatus(`${videoRequests.length} video request(s) intercepted.`, '#00ff66');
  chrome.action.setBadgeText({ text: '' });

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

async function sendToServer() {
  const course = $('course').value.trim();
  const lecture = $('lecture').value.trim();
  const kind = getKind();
  const btn = $('nodeBtn');

  if (!interceptedRequest) return alert('No video intercepted yet.');
  if (!course || !lecture) return alert('Pick a course and lecture first.');

  btn.disabled = true;
  btn.innerText = 'Sending...';
  try {
    const res = await fetch(`${SERVER}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: interceptedRequest.url,
        headers: interceptedRequest.headers,
        course, lecture, kind,
      }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? 'Server rejected');
    btn.innerText = 'Downloading in background!';
    btn.style.background = '#00cc52';
  } catch (e) {
    alert(`Could not start download: ${e.message ?? e}`);
    btn.innerText = 'Download';
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadCourses(), loadIntercepted()]);
  $('course').addEventListener('input', refreshLectureSuggestions);
  document.querySelectorAll('input[name="kind"]').forEach((el) =>
    el.addEventListener('change', refreshLectureSuggestions)
  );
  $('nodeBtn').addEventListener('click', sendToServer);
});
