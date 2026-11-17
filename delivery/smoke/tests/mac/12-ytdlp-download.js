import fs from 'node:fs';
import { expect } from '@playwright/test';
import { evidence, processTable, shown } from '../../lib/mac.js';
import * as paths from '../../lib/paths.js';
import { services } from '../../lib/session.js';
import { COURSE } from '../../lib/suite.js';
import { delay } from '../../lib/wait.js';
import ytdlpDownload from '../10-ytdlp-download.js';

const LECTURE = 'Downloaded Lecture';

// Homebrew's ffmpeg is on this runner's PATH, so the merge alone proves nothing: the process table, sampled
// while the shared body runs, must show yt-dlp handed the bundled ffmpeg and no other ffmpeg running.
async function sample(seen, stop) {
  while (!stop.done) {
    try {
      for (const p of await processTable()) {
        if (/yt-dlp/.test(p.exe) && p.commandLine.includes('--ffmpeg-location')) {
          seen.ytdlp.add(p.commandLine.replace(/^.*?(--ffmpeg-location \S+).*$/, '$1'));
        }
        if (p.name === 'ffmpeg') seen.ffmpeg.add(p.exe);
      }
    } catch {
      // A row can vanish mid-read; the next pass sees the table again.
    }
    await delay(100);
  }
}

// The shared body, then which ffmpeg yt-dlp was handed and ran, and what the merge wrote — also when it failed.
export default async function ytdlp() {
  const seen = { ytdlp: new Set(), ffmpeg: new Set() };
  const stop = { done: false };
  const sampler = sample(seen, stop);
  const bundled = paths.toolPath('ffmpeg');
  try {
    await ytdlpDownload();
  } finally {
    stop.done = true;
    await sampler;
    const lines = [
      `yt-dlp arguments seen: ${[...seen.ytdlp].join(' | ') || 'none'}`,
      `ffmpeg processes seen (sampled, may miss a short merge): ${[...seen.ffmpeg].join(', ') || 'none'}`,
    ];
    try {
      const file = await services.db.path(COURSE, LECTURE, 'video.mp4');
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      const probed = await shown(bundled, ['-hide_banner', '-i', file]);
      lines.push(`video.mp4: ${size} bytes\n${probed.text}`);
    } catch (error) {
      lines.push(`video.mp4 unreadable: ${error.message}`);
    }
    evidence('the yt-dlp download merges with the bundled ffmpeg', lines.join('\n'));
  }
  expect(
    [...seen.ytdlp],
    'yt-dlp was never seen running with --ffmpeg-location at the bundled ffmpeg',
  ).toContain(`--ffmpeg-location ${bundled}`);
  expect(
    [...seen.ffmpeg].filter((exe) => exe !== bundled),
    'an ffmpeg other than the bundled one ran during the download',
  ).toEqual([]);
}
