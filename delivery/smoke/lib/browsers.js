import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { ASSUMPTION, failed } from './suite.js';
import { renameAside, stopProcesses } from './platform.js';

const asides = [];

const mac = process.platform === 'darwin';

/** Each existing install Playwright's channel resolve looks in, per its fixed paths: the install dirs
 *  on Windows, the `.app` bundle in /Applications on macOS, where it resolves by path and not bundle id. */
function channelDirs(channel) {
  if (mac) {
    const app = channel === 'chrome' ? 'Google Chrome' : 'Microsoft Edge';
    return [`/Applications/${app}.app`].filter((dir) => fs.existsSync(dir));
  }
  const vendor = channel === 'chrome' ? ['Google', 'Chrome'] : ['Microsoft', 'Edge'];
  return [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]
    .filter(Boolean)
    .map((base) => path.join(base, ...vendor, 'Application'))
    .filter((dir) => fs.existsSync(dir));
}

/** The process image name the channel's browser runs as. */
const imageName = (channel) =>
  mac ? (channel === 'chrome' ? 'Google Chrome' : 'Microsoft Edge') : channel;

async function launchable(channel) {
  try {
    const browser = await chromium.launch({ channel, headless: true, timeout: 60_000 });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

/** Take a browser away by renaming its install dir, and measure that Playwright agrees it is gone. */
export async function removeBrowser(channel) {
  expect(await launchable(channel), `the runner image has no ${channel} to take away`).toBe(true);
  await stopProcesses([imageName(channel)]);
  const dirs = channelDirs(channel);
  for (const dir of dirs) asides.push([dir, await renameAside(dir)]);
  expect(
    await launchable(channel),
    `${failed(ASSUMPTION.rename)}: Playwright still launches ${channel} with ${dirs.join(', ')} renamed`,
  ).toBe(false);
}

export function restoreBrowsers() {
  for (const [original, aside] of asides.splice(0).reverse()) {
    try {
      fs.renameSync(aside, original);
    } catch (error) {
      console.error(`could not restore ${original}: ${error.message}`);
    }
  }
}
