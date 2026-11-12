import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
export const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name));

export const COURSE = 'Smoke Course';
export const LECTURE = 'Tone Lecture';

// A line of fixtures/summary.md: Hebrew only, so a missing Hebrew font cannot drop it unnoticed.
export const PDF_PHRASE = 'רדיוס ההתכנסות נתון על ידי נוסחת קושי הדמר';

// Every binary resources/bin/ ships, which is every tool the services probe but curl — Windows
// ships curl.exe, so lib/tools resolves it off PATH instead.
export const TOOLS = ['ffmpeg', 'pandoc', 'tectonic', 'yt-dlp'];

export const INSTALL_TIMEOUT_MS = 5 * 60_000;

// What only a Windows run can prove, named in the failure wherever one of them breaks.
export const ASSUMPTION = {
  nsis: 'NSIS /S performs the per-user install with no prompt',
  rename:
    "renaming a browser's install dir is equivalent to uninstalling it for Playwright's channel resolve",
  updater:
    'electron-updater installs an unsigned build over an unsigned build from a generic provider',
  wholesale: 'an electron-updater install preserves nothing in the install directory',
  launcherJob:
    "libuv's kill-on-close job takes main's spawned services with it when main is terminated",
  backendJob: "the frozen backend's own kill-on-close job takes its tools with it when it dies",
};
export const failed = (assumption) => `assumption failed: ${assumption}`;
