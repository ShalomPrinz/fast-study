// MV3 service worker: an observational (non-blocking) webRequest listener, registered synchronously
// at top level so Chrome re-wakes the worker for it; every capture lives in chrome.storage.local.
/* global importScripts, askBridge, reloadIfOutdated */
importScripts('bridge.js');
const MAX_ENTRIES = 50;

// The app's --accent, so the badge reads as FastStudy's.
const BADGE_COLOR = '#4f5bd5';

function isVideoUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith('.mp4') || path.endsWith('.m3u8');
  } catch {
    return false;
  }
}

function isHlsUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.m3u8');
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

  // The worker can't tell an fMP4 stream's segment .mp4s from real videos, so a page with any .m3u8
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
