// MV3 service worker: a top-level (so re-woken) non-blocking webRequest capture listener, state in storage.local;
// also runs the PDF downloads, state in storage.session.
/* global importScripts, askBridge, reloadIfOutdated, discoverServer */
importScripts('bridge.js');
const MAX_ENTRIES = 50;

// The app's --accent, so the badge reads as FastStudy's.
const BADGE_COLOR = '#4f5bd5';

// Panopto serves plain HLS playlists as .panobf2 (its fMP4 segments are .panobf1, never captured).
const HLS_SUFFIXES = ['.m3u8', '.panobf2'];

function isVideoUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith('.mp4') || HLS_SUFFIXES.some((s) => path.endsWith(s));
  } catch {
    return false;
  }
}

function isHlsUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return HLS_SUFFIXES.some((s) => path.endsWith(s));
  } catch {
    return false;
  }
}

async function getTabUrl(tabId) {
  if (tabId == null || tabId < 0) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab?.url ?? null;
  } catch {
    return null;
  }
}

// Captures arrive in bursts (a player opens several ranges at once); chaining the storage
// read-modify-write keeps one capture from overwriting another's.
let writes = Promise.resolve();

async function record(details) {
  const pageUrl = await getTabUrl(details.tabId);
  if (!pageUrl) return;

  const entry = {
    url: details.url,
    headers: details.requestHeaders,
    capturedAt: Date.now(),
    pageUrl,
  };

  const { videoRequests = [] } = await chrome.storage.local.get('videoRequests');
  const next = [entry, ...videoRequests.filter((e) => e.url !== entry.url)].slice(0, MAX_ENTRIES);
  await chrome.storage.local.set({ videoRequests: next });

  // The worker can't tell an fMP4 stream's segment .mp4s from real videos, so a page with any playlist
  // shows 1 (one playlist per variant is still one video); the popup counts exactly.
  const mine = next.filter((e) => e.pageUrl === pageUrl);
  const onPage = mine.some((e) => isHlsUrl(e.url)) ? 1 : mine.length;
  // The tab may have closed meanwhile; a per-tab badge on a gone tab rejects.
  await chrome.action
    .setBadgeBackgroundColor({ tabId: details.tabId, color: BADGE_COLOR })
    .catch(() => {});
  await chrome.action.setBadgeText({ tabId: details.tabId, text: String(onPage) }).catch(() => {});
}

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    if (!isVideoUrl(details.url)) return;
    writes = writes.then(() => record(details)).catch(() => {});
  },
  { urls: ['<all_urls>'] },
  // extraHeaders exposes Cookie/Referer/Origin, which the server's header replay needs.
  ['requestHeaders', 'extraHeaders'],
);

// A browser start is when an app update has most likely refreshed this folder underneath us.
chrome.runtime.onStartup.addListener(() => {
  askBridge()
    .then(reloadIfOutdated)
    .catch(() => {});
});

// ── PDF downloads: run here, not in the popup, which Chrome kills when it loses focus ──

const PDF_PREFIX = 'pdf:';
const RESULT_BADGES = { done: ['✓', '#2e9d5b'], failed: ['!', '#d23b3b'] };
// url -> AbortController of the job running for it; a new download of the same URL replaces the old.
const pdfJobs = new Map();

const putPdf = (entry) => chrome.storage.session.set({ [PDF_PREFIX + entry.url]: entry });

// The popup clears its tab's badge on open, so a result badge only matters while it is closed.
async function popupIsOpen(tabId) {
  try {
    const { windowId, active } = await chrome.tabs.get(tabId);
    if (!active) return false;
    const contexts = await chrome.runtime.getContexts({});
    return contexts.some((c) => c.documentUrl?.endsWith('/popup.html') && c.windowId === windowId);
  } catch {
    return false;
  }
}

async function settlePdf(entry, state, headline, { detail = '', params = [] } = {}) {
  // Mutate the shared entry so the progress timer can never write a stale state over the result.
  Object.assign(entry, { state, headline, detail, params });
  await putPdf(entry);
  if (entry.tabId == null || (await popupIsOpen(entry.tabId))) return;
  const [text, color] = RESULT_BADGES[state];
  await chrome.action.setBadgeBackgroundColor({ tabId: entry.tabId, color }).catch(() => {});
  await chrome.action.setBadgeText({ tabId: entry.tabId, text }).catch(() => {});
}

async function serverError(res) {
  try {
    return (await res.json()).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// Reads the body in chunks; `entry.bytes` is what the 1 s write below publishes.
async function fetchPdf(entry, signal) {
  const res = await fetch(entry.url, { credentials: 'include', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  entry.total = Number(res.headers.get('content-length')) || null;
  const chunks = [];
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    entry.bytes += value.length;
    // A compressed body decodes past its content-length; a total below bytes would mislead.
    if (entry.total && entry.bytes > entry.total) entry.total = null;
  }
  return new Blob(chunks, { type: 'application/pdf' });
}

// The upload request is the one the popup used to make: App mode names course/lecture/kind, General a file name.
async function uploadPdf(entry, blob, server, signal) {
  const { mode, course, lecture, kind, fileName } = entry.target;
  const qs = new URLSearchParams(
    mode === 'general' ? { dest: 'folder', fileName } : { course, lecture, kind },
  );
  const headers = { 'Content-Type': 'application/pdf' };
  if (server.secret) headers['X-FastStudy-Secret'] = server.secret;
  return fetch(`${server.base}/upload-pdf?${qs}`, { method: 'POST', headers, body: blob, signal });
}

async function runPdfJob(entry, ctl) {
  const current = () => pdfJobs.get(entry.url) === ctl;
  // Each storage write resets Chrome's 30 s idle timer; it is also the progress the popup shows.
  const tick = setInterval(
    () =>
      current() &&
      (entry.state === 'downloading' || entry.state === 'uploading') &&
      putPdf(entry).catch(() => {}),
    1000,
  );
  try {
    let blob;
    try {
      blob = await fetchPdf(entry, ctl.signal);
    } catch (e) {
      if (!current()) return;
      return await settlePdf(entry, 'failed', 'errPdfFetch', { detail: e.message });
    }
    entry.state = 'uploading';
    entry.bytes = entry.total = blob.size;
    const server = await discoverServer();
    if (!current()) return;
    if (server.running === false) return await settlePdf(entry, 'failed', 'statusAppClosed');
    let res;
    try {
      res = await uploadPdf(entry, blob, server, ctl.signal);
    } catch {
      if (!current()) return;
      return await settlePdf(entry, 'failed', 'statusOffline');
    }
    if (!current()) return;
    if (!res.ok) {
      const detail = await serverError(res);
      if (!current()) return;
      return await settlePdf(entry, 'failed', 'errPdfStore', { detail });
    }
    const body = await res.json();
    if (!current()) return;
    if (entry.target.mode === 'general') {
      await settlePdf(entry, 'done', 'doneGeneralPdf', { params: [body.fileName, body.folder] });
    } else {
      await settlePdf(entry, 'done', 'donePdf', { params: [body.target] });
    }
  } catch (e) {
    // discoverServer or a non-JSON 2xx reply threw: settle anyway so the entry never sticks on uploading.
    if (current()) await settlePdf(entry, 'failed', 'errPdfStore', { detail: e.message });
  } finally {
    clearInterval(tick);
    if (current()) pdfJobs.delete(entry.url);
  }
}

// A fresh worker with a job still marked running means the old one was killed: mark it failed.
const interruptedSwept = (async () => {
  const all = await chrome.storage.session.get(null);
  for (const [key, entry] of Object.entries(all)) {
    if (!key.startsWith(PDF_PREFIX)) continue;
    if (entry.state === 'downloading' || entry.state === 'uploading') {
      await settlePdf(entry, 'failed', 'errPdfInterrupted');
    }
  }
})().catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'downloadPdf') return false;
  (async () => {
    await interruptedSwept;
    const { type: _type, url, tabId, ...target } = msg;
    pdfJobs.get(url)?.abort();
    const ctl = new AbortController();
    pdfJobs.set(url, ctl);
    const entry = {
      url,
      target,
      tabId,
      state: 'downloading',
      bytes: 0,
      total: null,
      headline: '',
      detail: '',
      params: [],
    };
    await putPdf(entry);
    sendResponse({ ok: true });
    runPdfJob(entry, ctl).catch(() => {});
  })();
  return true;
});
