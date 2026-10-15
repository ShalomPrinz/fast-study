// A stale node_modules otherwise surfaces only as a dev-server 500 deep in a self-check, so the
// installed tree is held against each package-lock.json before anything is launched.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './env.mjs';

const NPM_ROOTS = ['frontend', 'downloader'];

// Every lockfile entry not installed at the version it pins; a missing optional one is skipped,
// since npm leaves out the platform-specific binaries meant for other systems.
function staleEntries(root) {
  const dir = path.join(REPO_ROOT, root);
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
  const stale = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.includes('node_modules/')) continue;
    const at = path.join(dir, key);
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (!fs.existsSync(path.join(at, 'package.json'))) {
      if (!entry.optional) stale.push(`${name} missing`);
      continue;
    }
    if (entry.link || !entry.version) continue;
    const installed = JSON.parse(fs.readFileSync(path.join(at, 'package.json'), 'utf8')).version;
    if (installed !== entry.version)
      stale.push(`${name} ${installed} (lock wants ${entry.version})`);
  }
  return stale;
}

export function checkNpmDeps() {
  const problems = NPM_ROOTS.flatMap((root) => {
    const stale = staleEntries(root);
    if (!stale.length) return [];
    const shown =
      stale.slice(0, 10).join(', ') + (stale.length > 10 ? `, +${stale.length - 10} more` : '');
    return [`${root}/: ${shown} — run \`npm ci\` in ${root}/`];
  });
  if (problems.length)
    throw new Error(`node_modules out of step with package-lock.json:\n  ${problems.join('\n  ')}`);
  return `npm deps: ${NPM_ROOTS.map((root) => `${root}/`).join(', ')} match their package-lock.json`;
}
