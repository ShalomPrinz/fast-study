// MV3 service worker: an observational (non-blocking) webRequest listener, registered synchronously
// at top level so Chrome re-wakes the worker for it; every capture lives in chrome.storage.local.
const MAX_ENTRIES = 50;

// The app's --accent, so the badge reads as FastStudy's.
const BADGE_COLOR = '#4f5bd5';

function isVideoUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.mp4');
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

  const onPage = next.filter((e) => e.pageUrl === pageUrl).length;
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
