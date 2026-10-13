const MAX_HISTORY = 5;

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

chrome.webRequest.onSendHeaders.addListener(
  async (details) => {
    if (!isVideoUrl(details.url)) return;

    const pageUrl = await getTabUrl(details.tabId);
    if (!pageUrl) return;

    const entry = {
      url: details.url,
      headers: details.requestHeaders,
      capturedAt: Date.now(),
      pageUrl,
    };

    const { videoRequests = [] } = await chrome.storage.local.get(['videoRequests']);
    const deduped = videoRequests.filter((e) => e.url !== entry.url);
    const next = [entry, ...deduped].slice(0, MAX_HISTORY * 10);

    await chrome.storage.local.set({
      videoRequests: next,
      lastVideoRequest: entry,
    });

    const onPage = next.filter((e) => e.pageUrl === pageUrl).length;
    chrome.action.setBadgeText({ tabId: details.tabId, text: String(onPage) });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders', 'extraHeaders'],
);
