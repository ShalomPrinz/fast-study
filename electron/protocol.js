const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, net, protocol } = require('electron');

// Frozen literal, never computed: all four services allowlist exactly this origin, and a page here
// sends it host-only, with no trailing slash, on every CORS request including the preflight.
const APP_ORIGIN = 'app://bundle';
const HOST = 'bundle';

// `standard` is what gives the scheme a real origin at all — with `secure` alone every request from
// the page carries `Origin: null` and no service allowlist can match it.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true } },
  ]);
}

// The built frontend: `frontend/dist` in dev, shipped alongside the app when packaged.
function bundleDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'frontend')
    : path.join(__dirname, '..', 'frontend', 'dist');
}

// Joins a URL path under the bundle, or null if it escapes — `%2e%2e` survives the URL parser's
// own normalization, so the containment check is on the resolved path, not the request.
function resolveWithin(root, pathname) {
  let file;
  try {
    file = path.resolve(root, '.' + decodeURIComponent(pathname));
  } catch {
    return null;
  }
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

function isFile(file) {
  return Boolean(file) && fs.existsSync(file) && fs.statSync(file).isFile();
}

function serveBundle() {
  const root = path.resolve(bundleDir());
  protocol.handle('app', (request) => {
    const { host, pathname } = new URL(request.url);
    if (host !== HOST) return new Response('not found', { status: 404 });
    const file = resolveWithin(root, pathname);
    // Anything that is not a built file is a react-router deep link, which index.html resolves.
    const target = isFile(file) ? file : path.join(root, 'index.html');
    return net.fetch(pathToFileURL(target).toString());
  });
}

module.exports = { APP_ORIGIN, bundleDir, registerScheme, serveBundle };
