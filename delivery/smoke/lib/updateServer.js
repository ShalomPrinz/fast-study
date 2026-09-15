import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

/** A loopback generic-provider feed serving exactly the files in `dir` — the candidate's
 *  `latest.yml`, installer and blockmap. Query strings are ignored, as electron-updater appends a
 *  cache-buster; anything else is a 404, which sends a differential download back to a full one. */
export async function serveUpdateFeed(dir) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://feed').pathname.slice(1));
    requests.push(`${req.method} ${name}`);
    const file = path.join(dir, path.basename(name));
    if (!name || name !== path.basename(name) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Length': fs.statSync(file).size });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

/** Point an installed `app-update.yml` at `url` as a generic provider, keeping the updater cache
 *  directory electron-builder named so the download lands where it always would. */
export function pointUpdaterAt(appUpdateYml, url) {
  const original = fs.readFileSync(appUpdateYml, 'utf8');
  const cacheDir = /^updaterCacheDirName:.*$/m.exec(original)?.[0];
  const lines = ['provider: generic', `url: ${url}`];
  if (cacheDir) lines.push(cacheDir);
  fs.writeFileSync(appUpdateYml, lines.join('\n') + '\n');
}
