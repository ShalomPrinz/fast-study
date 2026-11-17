// Assemble the tree electron-builder ships as `resources/` — electron/docs/BOOT.md's packaged tree —
// from built outputs; `bin/` and `latex/` the workflow writes itself. See docs/RELEASE.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruned, SKIP_EXT } from './prune.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WORKSPACE = path.join(REPO, 'downloader');
// The workspace install links each workspace into node_modules by its package name; staged, those
// links would point back into the repo, and nothing resolves a workspace by name.
const WORKSPACE_LINKS = new Set(
  JSON.parse(fs.readFileSync(path.join(WORKSPACE, 'package.json'), 'utf8')).workspaces.map(
    (dir) => JSON.parse(fs.readFileSync(path.join(WORKSPACE, dir, 'package.json'), 'utf8')).name,
  ),
);

const COPIES = [
  ['backend/dist/services', 'services'],
  ['downloader/auto', 'downloader/auto'],
  ['downloader/server', 'downloader/server'],
  // One hoisted copy beside both services, so each resolves its dependencies by walking up.
  ['downloader/node_modules', 'downloader/node_modules'],
  ['frontend/dist', 'frontend'],
  // Loaded unpacked by Chrome once main copies it to the state root; its CLAUDE.md is dropped.
  ['downloader/extension', 'extension'],
  ['electron/bridge/host.js', 'bridge/host.js'],
];

function copy(from, to, prune) {
  const modules = path.basename(from) === 'node_modules';
  fs.cpSync(from, to, {
    recursive: true,
    // cpSync otherwise rewrites a relative link into an absolute path back into the build output,
    // which dangles on a user's machine and makes a .framework's root unsignable.
    verbatimSymlinks: true,
    // node_modules is exempt from the name prune: a dependency of its own named `docs` or `test` is not ours to drop.
    filter: (src) => {
      if (!prune) return true;
      if (SKIP_EXT.test(src)) return false;
      if (modules) return !WORKSPACE_LINKS.has(path.relative(from, src));
      return !pruned(path.relative(from, src));
    },
  });
}

// Every symlink under `dir`, as absolute paths.
function* links(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) yield full;
    else if (entry.isDirectory()) yield* links(full);
  }
}

// A link ships as written, so it must be relative and land on something inside the tree.
function checkLinks(stage) {
  const bad = [];
  for (const link of links(stage)) {
    const target = fs.readlinkSync(link);
    const inside = path.resolve(path.dirname(link), target).startsWith(stage + path.sep);
    if (path.isAbsolute(target) || !inside || !fs.existsSync(link)) {
      bad.push(`${path.relative(stage, link)} -> ${target}`);
    }
  }
  if (bad.length) {
    throw new Error(
      `staged symlinks that are absolute, dangling or leave the tree:\n${bad.join('\n')}`,
    );
  }
}

function main([dir, extensionVersion]) {
  if (!dir) throw new Error('usage: node delivery/stage.mjs <stage-dir> [<extension-version>]');
  const stage = path.resolve(dir);

  for (const [from, to] of COPIES) {
    const source = path.join(REPO, from);
    if (!fs.existsSync(source)) throw new Error(`missing build output: ${from}`);
    copy(source, path.join(stage, to), from.startsWith('downloader/'));
    console.log(`staged ${from} -> ${to}`);
  }

  // A symlinked `@faststudy/*` would be a dangling link the moment the tree is copied into the
  // installer, so downloader/.npmrc sets `install-links` and this is the check that it held.
  for (const name of ['runtime', 'tools', 'sentry']) {
    const dep = path.join(stage, 'downloader', 'node_modules', '@faststudy', name);
    if (fs.lstatSync(dep).isSymbolicLink()) {
      throw new Error(`@faststudy/${name} is a symlink — install with install-links`);
    }
  }

  checkLinks(stage);

  // The staged copy alone takes build.yml's computed version; the committed patch means nothing.
  if (extensionVersion !== undefined) {
    if (!/^\d+\.\d+\.\d+$/.test(extensionVersion)) {
      throw new Error(`extension version ${extensionVersion} is not major.minor.patch`);
    }
    const manifest = path.join(stage, 'extension', 'manifest.json');
    const json = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    json.version = extensionVersion;
    fs.writeFileSync(manifest, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`stamped extension/manifest.json ${extensionVersion}`);
  }
}

main(process.argv.slice(2));
