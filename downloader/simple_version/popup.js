// Self-contained: no server, no DB. Captured .mp4 → chrome.downloads with
// the original request headers; tab-URL PDF → fetched in the popup (carries
// session cookies) and saved via a blob URL. Everything lands in
// Downloads/fast_study/<user-typed name>.<ext>.

const SAVE_ROOT = 'fast_study';

let interceptedRequest = null;
let pdfPageUrl = null;

function $(id) { return document.getElementById(id); }

function setStatus(text, color) {
  const el = $('status');
  el.innerText = text;
  if (color) el.style.color = color;
}

function safeName(s) {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim();
}

function targetFilename(name, ext) {
  return `${SAVE_ROOT}/${safeName(name) || 'download'}.${ext}`;
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

function chromeDownload(opts) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(opts, (id) => {
      const err = chrome.runtime.lastError;
      if (err || id == null) reject(new Error(err?.message ?? 'download failed'));
      else resolve(id);
    });
  });
}

async function loadIntercepted() {
  const { videoRequests: allRequests = [] } = await chrome.storage.local.get(['videoRequests']);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = tab?.url ?? null;

  const videoRequests = allRequests.filter((r) => r.pageUrl === pageUrl);
  const select = $('videoSelect');
  select.innerHTML = '';

  if (!videoRequests.length) return;

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
  select.addEventListener('change', () => { interceptedRequest = videoRequests[+select.value]; });
  interceptedRequest = videoRequests[0];

  videoRequests.forEach(async (req, i) => {
    const bytes = await probeSize(req.url);
    opts[i].textContent = `[${formatSize(bytes)}] ${shortenUrl(req.url)}`;
  });
}

// PDFs aren't gated like .mp4 streams — Chrome just renders them at the tab URL.
function isPdfUrl(url) {
  try { return new URL(url).pathname.toLowerCase().endsWith('.pdf'); } catch { return false; }
}

async function loadActivePagePdf() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = tab?.url ?? null;
  if (!pageUrl || !isPdfUrl(pageUrl)) return;
  pdfPageUrl = pageUrl;
  $('pdfUrl').value = pageUrl;
}

// Video wins if both video and PDF exist — captured .mp4 is rarer/harder.
function applyVisibility() {
  const hasVideo = !!interceptedRequest;
  const hasPdf = !!pdfPageUrl;
  $('videoSection').style.display = hasVideo ? '' : 'none';
  $('pdfSection').style.display = !hasVideo && hasPdf ? '' : 'none';
  $('targetSection').style.display = hasVideo || hasPdf ? '' : 'none';
  $('emptyMsg').style.display = !hasVideo && !hasPdf ? '' : 'none';
  if (!hasVideo && hasPdf) setStatus('PDF detected on this page.', '#00ff66');
  if (!hasVideo && !hasPdf) setStatus('Nothing to download here.', '#aaaaaa');
}

async function downloadVideo() {
  const btn = $('videoBtn');
  if (!interceptedRequest) return alert('No video intercepted yet.');
  const filename = $('filename').value.trim();
  if (!filename) return alert('Type a file name first.');

  btn.disabled = true;
  btn.innerText = 'Downloading...';
  try {
    await chromeDownload({
      url: interceptedRequest.url,
      filename: targetFilename(filename, 'mp4'),
      saveAs: false,
    });
    btn.innerText = 'Saved to Downloads!';
    btn.style.background = '#00cc52';
  } catch (e) {
    alert(`Download failed: ${e.message ?? e}`);
    btn.innerText = 'Download';
  }
  setTimeout(() => { btn.innerText = 'Download'; btn.style.background = ''; btn.disabled = false; }, 2000);
}

async function downloadPdf() {
  const btn = $('pdfBtn');
  if (!pdfPageUrl) return alert('Open a PDF page first.');
  const filename = $('filename').value.trim();
  if (!filename) return alert('Type a file name first.');

  btn.disabled = true;
  btn.innerText = 'Downloading...';
  try {
    // Fetch in the popup so Chrome includes the user's session cookies.
    const pdfRes = await fetch(pdfPageUrl, { credentials: 'include' });
    if (!pdfRes.ok) throw new Error(`Fetch PDF failed: HTTP ${pdfRes.status}`);
    const blob = await pdfRes.blob();
    const objUrl = URL.createObjectURL(blob);
    try {
      await chromeDownload({
        url: objUrl,
        filename: targetFilename(filename, 'pdf'),
        saveAs: false,
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
    }
    btn.innerText = 'Saved to Downloads!';
    btn.style.background = '#00cc52';
  } catch (e) {
    alert(`Download failed: ${e.message ?? e}`);
    btn.innerText = 'Download PDF';
  }
  setTimeout(() => { btn.innerText = 'Download PDF'; btn.style.background = ''; btn.disabled = false; }, 2000);
}

document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadIntercepted(), loadActivePagePdf()]);
  applyVisibility();
  $('videoBtn').addEventListener('click', downloadVideo);
  $('pdfBtn').addEventListener('click', downloadPdf);
});
