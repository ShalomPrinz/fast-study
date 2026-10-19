// `hb shot --before`: the frontend as a git ref had it, on a second vite, so a "before" shot needs
// no swap of files in the live tree that other agents share.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { appServices } from './browser.mjs';
import { REPO_ROOT } from './env.mjs';

const FRONTEND = path.join(REPO_ROOT, 'frontend');
const git = (...args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

// What the ref changed that this copy does not carry: the live services and installs serve both sides.
function warnUncovered(ref) {
  const changed = git('diff', '--name-only', ref).split('\n').filter(Boolean);
  const uncovered = changed.filter(
    (file) =>
      !file.startsWith('.claude/') &&
      (!file.startsWith('frontend/') || /^frontend\/package(-lock)?\.json$/.test(file)),
  );
  if (uncovered.length) {
    console.error(
      `hb: --before ${ref} serves only frontend/ source; these run as the working tree has them:\n  ${uncovered.join('\n  ')}`,
    );
  }
}

/** Serve `frontend/` at `ref` on its own vite; returns `{ url, close }`. */
export async function serveBefore(paths, ref) {
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    throw new Error(`--before: no commit "${ref}"`);
  }
  warnUncovered(ref);
  const root = path.join(paths.root, 'before');
  // A copy an interrupted run left behind goes first.
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  execFileSync('sh', ['-c', `git archive "$1" frontend | tar -x -C "$2"`, 'sh', ref, root], {
    cwd: REPO_ROOT,
  });
  const copy = path.join(root, 'frontend');
  fs.symlinkSync(path.join(FRONTEND, 'node_modules'), path.join(copy, 'node_modules'));

  const app = appServices();
  Object.assign(process.env, {
    VITE_DATABASE_URL: app.database,
    VITE_BACKEND_URL: app.backend,
    VITE_DOWNLOAD_SERVER_URL: app['downloader-server'],
    VITE_AUTO_DOWNLOADER_URL: app['downloader-auto'],
  });
  const { createServer } = await import(
    pathToFileURL(path.join(FRONTEND, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href
  );
  const port = await freePort();
  // The lingui plugin finds its config from the working directory, not vite's root.
  const cwd = process.cwd();
  process.chdir(copy);
  let server;
  try {
    // Its own cacheDir: the shared node_modules/.vite belongs to the live dev server.
    server = await createServer({
      root: copy,
      configFile: path.join(copy, 'vite.config.ts'),
      cacheDir: path.join(root, '.vite'),
      logLevel: 'error',
      server: {
        port,
        strictPort: true,
        host: 'localhost',
        hmr: false,
        // The symlinked installs resolve to the live frontend/, outside this root.
        fs: { allow: [copy, FRONTEND, path.join(REPO_ROOT, 'lib')] },
      },
    });
    await server.listen();
  } catch (error) {
    await server?.close();
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return {
    url: `http://localhost:${port}`,
    async close() {
      await server.close();
      process.chdir(cwd);
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
