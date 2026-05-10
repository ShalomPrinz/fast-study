chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    // Look for media requests or URLs specifically containing .mp4
    if (details.type === 'media' || details.url.includes('.mp4')) {
      
      // Save the intercepted data to local storage
      chrome.storage.local.set({
        lastVideoRequest: {
          url: details.url,
          headers: details.requestHeaders
        }
      });

      // Add a red "1" badge to the extension icon so you know it caught the video
      chrome.action.setBadgeText({ text: "1" });
      chrome.action.setBadgeBackgroundColor({ color: "#FF0000" });
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);