// Finds the running app's downloader server through the com.faststudy.bridge native messaging host.
// Shared by the popup (a <script>) and the service worker (importScripts).
/* exported discoverServer, askBridge, reloadIfOutdated */
const BRIDGE_HOST = 'com.faststudy.bridge';
// No host registered means a dev run: the server is on its default port with no launch secret.
const DEV_SERVER = { base: 'http://localhost:3052', secret: null };

function askBridge() {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(BRIDGE_HOST, {}, (reply) => {
      // Reading lastError is what keeps Chrome from logging an unchecked-error warning.
      resolve(chrome.runtime.lastError ? null : (reply ?? null));
    });
  });
}

// Reloads once per app-shipped version that differs from ours; the guard stops a loaded folder
// the app never refreshes (a dev's repo checkout) from reloading on every popup open.
async function reloadIfOutdated(reply) {
  const shipped = reply?.extensionVersion;
  if (!shipped || shipped === chrome.runtime.getManifest().version) return false;
  const { reloadedFor } = await chrome.storage.local.get('reloadedFor');
  if (reloadedFor === shipped) return false;
  await chrome.storage.local.set({ reloadedFor: shipped });
  chrome.runtime.reload();
  return true;
}

// Resolves {base, secret} for the server, or {running: false} when the app is installed but closed.
async function discoverServer() {
  const reply = await askBridge();
  if (!reply) return DEV_SERVER;
  await reloadIfOutdated(reply);
  if (reply.running === false) return { running: false };
  if (!Number.isInteger(reply.port)) return DEV_SERVER;
  return { base: `http://127.0.0.1:${reply.port}`, secret: reply.secret ?? null };
}
