// The packaged extension's version: the previous release's, bumped once when a shipped extension
// file changed since its tag. Usage and rule: docs/RELEASE.md#the-extension-version.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruned } from './prune.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = 'downloader/extension';
const MANIFEST = `${EXTENSION}/manifest.json`;

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const manifestAt = (rev) => JSON.parse(git('show', `${rev}:${MANIFEST}`));

function parse(version, what) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!parts) throw new Error(`${what} ${version} is not major.minor.patch`);
  return parts.slice(1).map(Number);
}

// Shipped means stage.mjs copies it: no part of the path is one its prune drops.
const shipped = (rel) =>
  !rel.split('/').some((_, i, parts) => pruned(parts.slice(0, i + 1).join('/')));

// The manifest's own version field is not a change: only the stamp is meaningful.
const withoutVersion = ({ version: _version, ...rest }) => JSON.stringify(rest);

function changedSince(tag) {
  return git('diff', '--name-only', '--no-renames', tag, 'HEAD', '--', EXTENSION)
    .split('\n')
    .filter(Boolean)
    .map((file) => path.posix.relative(EXTENSION, file))
    .filter(shipped)
    .filter(
      (rel) =>
        rel !== 'manifest.json' ||
        withoutVersion(manifestAt(tag)) !== withoutVersion(manifestAt('HEAD')),
    );
}

function extensionVersion(tag, recorded) {
  const committed = manifestAt('HEAD').version;
  const [major, minor] = parse(committed, 'the committed manifest version');
  if (!tag) return { version: committed, reason: 'no previous release' };

  // The bootstrap fallback for a release without the asset: docs/MIGRATIONS.md.
  const previous = recorded || manifestAt(tag).version;
  const [prevMajor, prevMinor, prevPatch] = parse(previous, `${tag}'s extension version`);
  const source = recorded ? 'its extension-version.txt' : `its tag's manifest`;

  if (major > prevMajor || (major === prevMajor && minor > prevMinor)) {
    return {
      version: `${major}.${minor}.0`,
      reason: `committed ${committed} is a major.minor above ${tag}'s ${previous} (${source})`,
    };
  }
  const changed = changedSince(tag);
  if (!changed.length) {
    return { version: previous, reason: `unchanged since ${tag}'s ${previous} (${source})` };
  }
  return {
    version: `${prevMajor}.${prevMinor}.${prevPatch + 1}`,
    reason: `${changed.join(', ')} changed since ${tag}'s ${previous} (${source})`,
  };
}

const { version, reason } = extensionVersion(process.argv[2] || '', process.argv[3] || '');
console.error(`extension ${version}: ${reason}`);
console.log(version);
