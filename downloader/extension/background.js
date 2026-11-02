// MV3 service worker: a top-level (so re-woken) non-blocking webRequest capture listener, state in storage.local;
// also runs the PDF and received-file downloads, state in storage.session.
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

// ── Downloads: run here, not in the popup, which Chrome kills when it loses focus ──
// One runner for a `.pdf` tab (key `pdf:<url>`, to /upload-pdf) and the right-click file
// (key `received`, to /upload-file under its original name).

const PDF_PREFIX = 'pdf:';
const RECEIVED_KEY = 'received';
const RESULT_BADGES = {
  done: ['✓', '#2e9d5b'],
  failed: ['!', '#d23b3b'],
  // A right-click file waiting while the popup could not open.
  waiting: ['↓', BADGE_COLOR],
  rejected: ['!', '#d23b3b'],
};
// entry key -> AbortController of the job running for it; a new download of the same key replaces the old.
const jobs = new Map();
const isActive = (entry) =>
  entry?.state === 'resolving' || entry?.state === 'downloading' || entry?.state === 'uploading';

const putEntry = (entry) => chrome.storage.session.set({ [entry.key]: entry });

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

async function settle(entry, state, headline, { detail = '', params = [] } = {}) {
  // Mutate the shared entry so the progress timer can never write a stale state over the result.
  Object.assign(entry, { state, headline, detail, params, seen: false });
  await putEntry(entry);
  if (entry.tabId == null || (await popupIsOpen(entry.tabId))) return;
  await setBadge(entry.tabId, ...RESULT_BADGES[state]);
}

async function setBadge(tabId, text, color) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

async function serverError(res) {
  try {
    return (await res.json()).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// Each storage write resets Chrome's 30 s idle timer; it is also the progress the popup shows.
function keepalive(entry, ctl) {
  const tick = setInterval(
    () => jobs.get(entry.key) === ctl && isActive(entry) && putEntry(entry).catch(() => {}),
    1000,
  );
  return () => clearInterval(tick);
}

// Reads the body in chunks; `entry.bytes` is what the 1 s write publishes.
async function fetchBody(entry, signal) {
  const res = await fetch(entry.fetchUrl ?? entry.url, { credentials: 'include', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  // A received file that now comes back as a page means the session ended since it was resolved.
  if (entry.received && /^text\/html/i.test(type))
    throw Object.assign(new Error('HTML'), { html: true });
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
  return new Blob(chunks, {
    type: entry.received ? type || 'application/octet-stream' : 'application/pdf',
  });
}

// App mode names course/lecture/kind, General a file name (a received file keeps its original name instead).
async function uploadBody(entry, blob, server, signal) {
  const { mode, course, lecture, kind, fileName } = entry.target;
  const qs = new URLSearchParams(
    mode === 'general'
      ? { dest: 'folder', ...(fileName && { fileName }) }
      : { course, lecture, kind },
  );
  if (entry.received) qs.set('filename', entry.name);
  const headers = { 'Content-Type': blob.type || 'application/octet-stream' };
  if (server.secret) headers['X-FastStudy-Secret'] = server.secret;
  const route = entry.received ? '/upload-file' : '/upload-pdf';
  return fetch(`${server.base}${route}?${qs}`, { method: 'POST', headers, body: blob, signal });
}

async function runJob(entry, ctl) {
  const current = () => jobs.get(entry.key) === ctl;
  const stop = keepalive(entry, ctl);
  const err = (pdf, file) => (entry.received ? file : pdf);
  try {
    let blob;
    try {
      blob = await fetchBody(entry, ctl.signal);
    } catch (e) {
      if (!current()) return;
      if (e.html) return await settle(entry, 'failed', 'errFileHtml');
      return await settle(entry, 'failed', err('errPdfFetch', 'errFileFetch'), {
        detail: e.message,
      });
    }
    entry.state = 'uploading';
    entry.bytes = entry.total = blob.size;
    const server = await discoverServer();
    if (!current()) return;
    if (server.running === false) return await settle(entry, 'failed', 'statusAppClosed');
    let res;
    try {
      res = await uploadBody(entry, blob, server, ctl.signal);
    } catch {
      if (!current()) return;
      return await settle(entry, 'failed', 'statusOffline');
    }
    if (!current()) return;
    if (!res.ok) {
      const detail = await serverError(res);
      if (!current()) return;
      return await settle(entry, 'failed', err('errPdfStore', 'errFileStore'), { detail });
    }
    const body = await res.json();
    if (!current()) return;
    if (entry.target.mode === 'general') {
      await settle(entry, 'done', 'doneGeneralPdf', { params: [body.fileName, body.folder] });
    } else {
      await settle(entry, 'done', 'donePdf', { params: [body.target] });
    }
  } catch (e) {
    // discoverServer or a non-JSON 2xx reply threw: settle anyway so the entry never sticks on uploading.
    if (current()) {
      await settle(entry, 'failed', err('errPdfStore', 'errFileStore'), { detail: e.message });
    }
  } finally {
    stop();
    if (current()) jobs.delete(entry.key);
  }
}

// A fresh worker with a job still marked running means the old one was killed: mark it failed.
const interruptedSwept = (async () => {
  const all = await chrome.storage.session.get(null);
  for (const [key, entry] of Object.entries(all)) {
    if (!key.startsWith(PDF_PREFIX) && key !== RECEIVED_KEY) continue;
    // A received file still resolving is red and shown once; the green "Received" needs a name.
    if (isActive(entry)) {
      await settle(entry, entry.state === 'resolving' ? 'rejected' : 'failed', 'errPdfInterrupted');
    }
  }
})().catch(() => {});

// ── Right-click menu: send a linked file ──

const MENU_ID = 'send-file';
// A copy of backend/pipeline/material_types.py (also downloader/server/src/routes/pdf.js's FILE_TYPES);
// change all three together.
const FILE_TYPES = [
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'heic',
  'heif',
  'txt',
  'md',
  'csv',
  'docx',
  'pptx',
  'xlsx',
];
// Match patterns see the query too, hence the trailing `*`; Moodle's resource page serves whatever file it holds.
const LINK_PATTERNS = [
  ...FILE_TYPES.flatMap((t) => [`*://*/*.${t}*`, `*://*/*.${t.toUpperCase()}*`]),
  '*://*/*mod/resource/view.php*',
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: chrome.i18n.getMessage('menuSend'),
      contexts: ['link'],
      targetUrlPatterns: LINK_PATTERNS,
    });
  });
});

// The file name from Content-Disposition (RFC 5987 `filename*` first), else the final URL's last segment.
function dispositionName(header) {
  if (!header) return null;
  const star = /filename\*\s*=\s*utf-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {}
  }
  const plain =
    /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  if (!plain) return null;
  const raw = plain[1].trim();
  // fetch decodes header bytes as latin1, so a UTF-8 name arrives as mojibake.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(raw, (c) => c.charCodeAt(0)),
    );
  } catch {
    return raw;
  }
}

function urlName(url) {
  const last = new URL(url).pathname.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// Resolves the clicked link to its real name and type, reading the headers only: the worker holds no
// bytes while the user picks a destination (an idle worker is killed after ~30 s).
async function resolveReceived(entry, ctl) {
  const current = () => jobs.get(entry.key) === ctl;
  const stop = keepalive(entry, ctl);
  try {
    let res;
    try {
      res = await fetch(entry.fetchUrl, { credentials: 'include', signal: ctl.signal });
    } catch (e) {
      if (current()) await settle(entry, 'rejected', 'errFileUnreachable', { detail: e.message });
      return;
    }
    res.body?.cancel().catch(() => {});
    if (!current()) return;
    if (!res.ok)
      return await settle(entry, 'rejected', 'errFileHttp', { detail: `HTTP ${res.status}` });
    if (/^text\/html/i.test(res.headers.get('content-type') ?? '')) {
      return await settle(entry, 'rejected', 'errFileHtml');
    }
    const name = (dispositionName(res.headers.get('content-disposition')) ?? urlName(res.url))
      .split(/[\\/]/)
      .pop();
    const ext = /\.([^.]+)$/.exec(name)?.[1].toLowerCase() ?? '';
    entry.name = name;
    entry.type = ext.toUpperCase();
    if (!FILE_TYPES.includes(ext)) {
      return await settle(entry, 'rejected', 'errFileType', { params: [ext || '?'] });
    }
    entry.total = Number(res.headers.get('content-length')) || null;
    Object.assign(entry, { state: 'ready', seen: false });
    await putEntry(entry);
  } catch (e) {
    if (current()) await settle(entry, 'rejected', 'errFileUnreachable', { detail: e.message });
  } finally {
    stop();
    if (current()) jobs.delete(entry.key);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.linkUrl) return;
  // Opened first and unawaited: the popup follows storage, and the click's user gesture is short-lived.
  chrome.action
    .openPopup(tab?.windowId != null ? { windowId: tab.windowId } : undefined)
    .catch(async () => {
      // No popup (window unfocused, Chrome < 127): mark the icon until the popup is opened.
      if (tab?.id != null && !(await popupIsOpen(tab.id)))
        await setBadge(tab.id, ...RESULT_BADGES.waiting);
    });
  (async () => {
    await interruptedSwept;
    // A send in flight is never replaced; the popup it opens shows its progress.
    const sending = (await chrome.storage.session.get(RECEIVED_KEY))[RECEIVED_KEY]?.state;
    if ((sending === 'downloading' || sending === 'uploading') && jobs.has(RECEIVED_KEY)) return;
    jobs.get(RECEIVED_KEY)?.abort();
    const ctl = new AbortController();
    jobs.set(RECEIVED_KEY, ctl);
    let fetchUrl = info.linkUrl;
    try {
      const u = new URL(fetchUrl);
      // Moodle's force-redirect, so an "embed" or "open" resource returns the file and not a page.
      if (u.pathname.endsWith('/mod/resource/view.php')) u.searchParams.set('redirect', '1');
      fetchUrl = u.href;
    } catch {}
    const entry = {
      key: RECEIVED_KEY,
      received: true,
      url: info.linkUrl,
      fetchUrl,
      tabId: tab?.id ?? null,
      state: 'resolving',
      name: '',
      type: '',
      bytes: 0,
      total: null,
      headline: '',
      detail: '',
      params: [],
      seen: false,
    };
    await putEntry(entry);
    resolveReceived(entry, ctl).catch(() => {});
  })();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'downloadPdf') {
    (async () => {
      await interruptedSwept;
      const { type: _type, url, tabId, ...target } = msg;
      const key = PDF_PREFIX + url;
      jobs.get(key)?.abort();
      const ctl = new AbortController();
      jobs.set(key, ctl);
      const entry = {
        key,
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
      await putEntry(entry);
      sendResponse({ ok: true });
      runJob(entry, ctl).catch(() => {});
    })();
    return true;
  }
  if (msg?.type === 'downloadFile') {
    (async () => {
      await interruptedSwept;
      const entry = (await chrome.storage.session.get(RECEIVED_KEY))[RECEIVED_KEY];
      if (entry?.state !== 'ready' || jobs.has(RECEIVED_KEY)) return sendResponse({ ok: false });
      const { type: _type, ...target } = msg;
      const ctl = new AbortController();
      jobs.set(RECEIVED_KEY, ctl);
      Object.assign(entry, { target, state: 'downloading', bytes: 0, total: null, seen: false });
      await putEntry(entry);
      sendResponse({ ok: true });
      runJob(entry, ctl).catch(() => {});
    })();
    return true;
  }
  return false;
});
