import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { recordShippedFormats, shippedFormats } from '../lib/formats.js';
import { proveOfflineEnforcement } from '../lib/offline.js';
import * as paths from '../lib/paths.js';
import { ASSUMPTION, failed, INSTALL_TIMEOUT_MS, TOOLS } from '../lib/suite.js';
import { blockOutbound, enableFirewall, runToExit } from '../lib/windows.js';

/** Send the shipped native host one framed `{}` the way Chrome does, and return its framed reply. */
function askNativeHost(bridgeFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(paths.appExe(), [paths.nativeHost(), bridgeFile], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out = [];
    const err = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('the native host did not exit within 30s'));
    }, 30_000);
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      const reply = Buffer.concat(out);
      const length = reply.length >= 4 ? reply.readUInt32LE(0) : -1;
      if (code !== 0 || reply.length !== 4 + length) {
        reject(new Error(`host exited ${code} with ${reply.length} bytes: ${Buffer.concat(err)}`));
        return;
      }
      resolve(JSON.parse(reply.subarray(4).toString('utf8')));
    });
    // Chrome keeps stdin open until the host exits, so the host must answer without an 'end'.
    const body = Buffer.from('{}', 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    child.stdin.write(Buffer.concat([header, body]));
  });
}

export default async function freshInstall() {
  expect(process.platform, 'the smoke suite drives an installed Windows build').toBe('win32');
  const { installer } = paths.candidate();

  await test.step('the silent installer finishes a per-user install', async () => {
    const { code, output } = await runToExit(installer, ['/S'], {
      timeoutMs: INSTALL_TIMEOUT_MS,
      onTimeout: `${failed(ASSUMPTION.nsis)}: ${installer} /S was still running after 5 minutes`,
    });
    expect(code, `the installer exited ${code}: ${output}`).toBe(0);
    expect(fs.existsSync(paths.appExe()), `${failed(ASSUMPTION.nsis)}: no ${paths.appExe()}`).toBe(
      true,
    );
  });

  await test.step("resources/ matches electron/docs/BOOT.md's packaged tree", async () => {
    const shipped = [
      'services/faststudy-services.exe',
      // The one Google API discovery document services.spec keeps, under PyInstaller's one-dir
      // contents directory. Missing, Drive upload fails on a user's machine and nowhere earlier.
      'services/_internal/googleapiclient/discovery_cache/documents/drive.v3.json',
      // The Google OAuth client, the one uncommitted build input; missing, Drive connect fails.
      'services/_internal/credentials.json',
      'downloader/auto/app.js',
      'downloader/server/src/index.js',
      'downloader/node_modules/@faststudy/runtime/package.json',
      'frontend/index.html',
      'latex/bundles',
      'extension/manifest.json',
      'bridge/host.js',
      // Not in the tree, but what the update check rewrites: electron-builder's publish config.
      'app-update.yml',
    ];
    for (const entry of shipped) {
      expect(fs.existsSync(path.join(paths.resourcesDir(), entry)), `resources/${entry}`).toBe(
        true,
      );
    }
    // A node_modules at resources/ would be the one app.asar's own requires resolve into.
    for (const entry of ['auto', 'server', 'node_modules']) {
      expect(fs.existsSync(path.join(paths.resourcesDir(), entry)), `resources/${entry}`).toBe(
        false,
      );
    }
    // bin/ as a set, not as existence checks: a binary nothing spawns any more still installs
    // cleanly, and its only symptom is the installer's size.
    expect(
      fs.readdirSync(paths.binDir()).sort(),
      'resources/bin/ does not hold exactly the shipped tools',
    ).toEqual(TOOLS.map((tool) => `${tool}.exe`).sort());

    // The stamped version publish.yml records as extension-version.txt is the one that installed:
    // the next build bumps from the record, so a drift would skip or repeat Chrome's recopy.
    const recorded = fs
      .readFileSync(path.join(paths.candidate().dir, 'extension-version.txt'), 'utf8')
      .trim();
    const manifest = path.join(paths.resourcesDir(), 'extension', 'manifest.json');
    expect(
      JSON.parse(fs.readFileSync(manifest, 'utf8')).version,
      "resources/extension/manifest.json's version is not the artifact's extension-version.txt",
    ).toBe(recorded);

    const bundles = fs.readdirSync(path.join(paths.resourcesDir(), 'latex', 'bundles'));
    expect(bundles.length, 'resources/latex/bundles is empty').toBeGreaterThan(0);
    recordShippedFormats();
    expect(
      shippedFormats.map(({ name }) => path.extname(name)),
      'latex/formats/ does not ship exactly one .fmt',
    ).toEqual(['.fmt']);
  });

  await test.step('the native host answers a framed request with no bridge file', async () => {
    const missing = path.join(paths.workDir(), 'no-such-bridge.json');
    expect(await askNativeHost(missing)).toEqual({ running: false });
  });

  await test.step('every shipped program is blocked from the network', async () => {
    await enableFirewall();
    const bins = fs
      .readdirSync(paths.binDir())
      .filter((name) => name.endsWith('.exe'))
      .map((name) => path.join(paths.binDir(), name));
    await blockOutbound([paths.appExe(), paths.servicesExe(), ...bins, paths.ytdlpCopy()]);
  });

  await test.step('loopback still works under the block, and nothing else does', () =>
    proveOfflineEnforcement());
}
