const SERVER = 'http://localhost:3052';

let courses = [];

function $(id) { return document.getElementById(id); }

function getKind() {
  return document.querySelector('input[name="kind"]:checked').value;
}

function buildCurl(req) {
  let curl = `curl "${req.url}"`;
  for (const h of req.headers ?? []) {
    const val = h.value.replace(/"/g, '\\"');
    curl += ` -H "${h.name}: ${val}"`;
  }
  return curl;
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

async function loadIntercepted() {
  const { lastVideoRequest } = await chrome.storage.local.get(['lastVideoRequest']);
  if (!lastVideoRequest) return;
  setStatus('Video intercepted successfully!', '#00ff66');
  chrome.action.setBadgeText({ text: '' });
  $('curlCommand').value = buildCurl(lastVideoRequest);
}

async function sendToServer() {
  const command = $('curlCommand').value.trim();
  const course = $('course').value.trim();
  const lecture = $('lecture').value.trim();
  const kind = getKind();
  const btn = $('nodeBtn');

  if (!command) return alert('No video intercepted yet.');
  if (!course || !lecture) return alert('Pick a course and lecture first.');

  btn.disabled = true;
  btn.innerText = 'Sending...';
  try {
    const res = await fetch(`${SERVER}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, course, lecture, kind }),
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
