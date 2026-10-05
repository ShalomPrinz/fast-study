import fs from 'node:fs';

/** Point an installed `app-update.yml` at `url` as a generic provider, keeping the updater cache
 *  directory electron-builder named so the download lands where it always would. */
export function pointUpdaterAt(appUpdateYml, url) {
  const original = fs.readFileSync(appUpdateYml, 'utf8');
  const cacheDir = /^updaterCacheDirName:.*$/m.exec(original)?.[0];
  const lines = ['provider: generic', `url: ${url}`];
  if (cacheDir) lines.push(cacheDir);
  fs.writeFileSync(appUpdateYml, lines.join('\n') + '\n');
}
