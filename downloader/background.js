const MAX_HISTORY = 5;

function isVideoUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.mp4');
  } catch {
    return false;
  }
}

chrome.webRequest.onSendHeaders.addListener(
  async (details) => {
    if (!isVideoUrl(details.url)) return;

    const entry = {
      url: details.url,
      headers: details.requestHeaders,
      capturedAt: Date.now(),
    };

    const { videoRequests = [] } = await chrome.storage.local.get(['videoRequests']);
    const deduped = videoRequests.filter((e) => e.url !== entry.url);
    const next = [entry, ...deduped].slice(0, MAX_HISTORY);

    await chrome.storage.local.set({
      videoRequests: next,
      lastVideoRequest: entry,
    });

    chrome.action.setBadgeText({ text: String(next.length) });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders', 'extraHeaders']
);
