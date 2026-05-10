const SERVER_URL = 'http://localhost:3052/download';

function buildCurl(req) {
  let curl = `curl "${req.url}"`;
  for (const h of req.headers ?? []) {
    const val = h.value.replace(/"/g, '\\"');
    curl += ` -H "${h.name}: ${val}"`;
  }
  curl += ` --output "recording_${Date.now()}.mp4"`;
  return curl;
}

function setStatus(text, color) {
  const el = document.getElementById('status');
  el.innerText = text;
  if (color) el.style.color = color;
}

async function loadIntercepted() {
  const { lastVideoRequest } = await chrome.storage.local.get(['lastVideoRequest']);
  if (!lastVideoRequest) return;

  setStatus('Video intercepted successfully!', '#00ff66');
  chrome.action.setBadgeText({ text: '' });
  document.getElementById('curlCommand').value = buildCurl(lastVideoRequest);
}

async function sendToServer() {
  const text = document.getElementById('curlCommand').value;
  if (!text) return;

  const btn = document.getElementById('nodeBtn');
  btn.innerText = 'Sending...';

  try {
    const res = await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: text }),
    });
    if (!res.ok) throw new Error('Server rejected');
    btn.innerText = 'Downloading in background!';
    btn.style.background = '#00cc52';
  } catch {
    alert('Could not connect! Is your server.js running?');
    btn.innerText = 'Download';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadIntercepted();
  document.getElementById('nodeBtn').addEventListener('click', sendToServer);
});
