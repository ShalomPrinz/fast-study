// Assemble the tree electron-builder ships as `resources/`, from artifacts the release workflow has
// already built. The shape is `electron/docs/BOOT.md`'s packaged tree, and this script is the one
// place that has to match it.
//
//   node delivery/stage.mjs <stage-dir>
//
// `bin/` and `latex/` are not here: the workflow downloads the binaries and primes the tectonic
// cache straight into the stage dir, so nothing has to be copied twice.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Dev-only weight that would otherwise ride along in the two Node service trees.
const SKIP = new Set(['test', 'docs', 'CLAUDE.md', 'README.md', '.gitignore', 'package-lock.json']);

const COPIES = [
  ['backend/dist/services', 'services'],
  ['downloader/auto', 'auto'],
  ['downloader/server', 'server'],
  ['frontend/dist', 'frontend'],
];

function copy(from, to, prune) {
  fs.cpSync(from, to, {
    recursive: true,
    // node_modules is exempt: a dependency of its own named `docs` or `test` is not ours to drop.
    filter: (src) => {
      if (!prune || src.includes(`${path.sep}node_modules${path.sep}`)) return true;
      return !SKIP.has(path.relative(from, src));
    },
  });
}

const stage = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('usage: node delivery/stage.mjs <stage-dir>');

for (const [from, to] of COPIES) {
  const source = path.join(REPO, from);
  if (!fs.existsSync(source)) throw new Error(`missing build output: ${from}`);
  copy(source, path.join(stage, to), from.startsWith('downloader/'));
  console.log(`staged ${from} -> ${to}`);
}

// A symlinked `@faststudy/*` would be a dangling link the moment the tree is copied into the
// installer, so the workflow installs with `--install-links` and this is the check that it did.
for (const service of ['auto', 'server']) {
  for (const name of ['runtime', 'tools']) {
    const dep = path.join(stage, service, 'node_modules', '@faststudy', name);
    if (fs.lstatSync(dep).isSymbolicLink()) {
      throw new Error(`${service}: @faststudy/${name} is a symlink — install with --install-links`);
    }
  }
}
