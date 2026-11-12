import fs from 'node:fs';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { ASSUMPTION, failed } from './suite.js';
import { renameAside, stopProcesses } from './windows.js';

const asides = [];

/** Each existing install dir Playwright's channel resolve looks in, per its fixed Windows paths. */
function channelDirs(channel) {
  const vendor = channel === 'chrome' ? ['Google', 'Chrome'] : ['Microsoft', 'Edge'];
  return [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]
    .filter(Boolean)
    .map((base) => path.join(base, ...vendor, 'Application'))
    .filter((dir) => fs.existsSync(dir));
}

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
  await stopProcesses([channel]);
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
