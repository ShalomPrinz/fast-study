import fs from 'node:fs';
import { expect } from '@playwright/test';
import { readLaunchLog } from '../lib/app.js';
import { serveFiles } from '../lib/fileServer.js';
import { dashFixture, streamKinds } from '../lib/media.js';
import * as paths from '../lib/paths.js';
import { services } from '../lib/session.js';
import { COURSE } from '../lib/suite.js';
import { waitFor } from '../lib/wait.js';

const DOWNLOADED_LECTURE = 'Downloaded Lecture';

export default async function ytdlpDownload() {
  const { db, api, dl } = services;
  const noMerge =
    'yt-dlp most likely skipped merging the video-only and audio-only streams because it could not ' +
    'find ffmpeg: packaged, ffmpeg is off PATH, so the downloader must pass --ffmpeg-location';
  // toolPath prefers the state root's seeded copy whenever it exists, so that is what the job spawns.
  expect(fs.existsSync(paths.ytdlpCopy()), `the server never seeded ${paths.ytdlpCopy()}`).toBe(
    true,
  );

  // Off for this process only (the relaunch in 11 is back to `full`), so the arrival queues no
  // pipeline and leaves a launch.log line proving the downloader reported it.
  const { applied } = await api.config({ auto_run: 'off' });
  expect(applied, 'the backend did not apply auto_run').toContain('auto_run');

  const served = await serveFiles(await dashFixture());
  try {
    const id = await dl.downloadUrl(COURSE, DOWNLOADED_LECTURE, `${served.url}manifest.mpd`);
    const job = await dl.waitForJob(id, { timeoutMs: 5 * 60_000 });
    expect(
      job.status,
      `the download failed with ${job.code}: ${job.message}\n${noMerge}\n` +
        `the loopback fixture saw: ${served.requests.join(', ') || 'nothing'}`,
    ).toBe('done');
  } finally {
    await served.close();
  }
  expect(await db.exists(COURSE, DOWNLOADED_LECTURE, 'video.mp4'), `no video.mp4: ${noMerge}`).toBe(
    true,
  );
  const kinds = await streamKinds(await db.path(COURSE, DOWNLOADED_LECTURE, 'video.mp4'));
  expect(kinds.sort(), `video.mp4 is not both streams merged: ${noMerge}`).toEqual([
    'audio',
    'video',
  ]);

  const arrived = `video arrived for ${COURSE}/${DOWNLOADED_LECTURE} (lecture): AUTO_RUN=off, queuing nothing`;
  // The downloader reports the arrival fire-and-forget after its upload, so the line can lag the job.
  await waitFor(() => readLaunchLog().includes(arrived), {
    timeoutMs: 30_000,
    message: `no "${arrived}" in launch.log: the downloader never reported the video to the backend (/video-arrived)`,
  });
}
