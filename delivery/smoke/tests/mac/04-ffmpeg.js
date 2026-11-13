import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { evidence, shown } from '../../lib/mac.js';
import * as paths from '../../lib/paths.js';

// backend/services/ffmpeg.py's prefix, then backend/pipeline/strip_audio.py's arguments, verbatim.
const stripAudio = (video, audio) => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-y',
  '-i',
  video,
  '-vn',
  '-ar',
  '16000',
  '-ac',
  '1',
  '-b:a',
  '32k',
  audio,
];

export default async function ffmpegAudio() {
  const ffmpeg = path.join(paths.binDir(), 'ffmpeg');
  const video = path.join(paths.workDir(), 'tone.mp4');
  const audio = path.join(paths.workDir(), 'audio.mp3');
  fs.mkdirSync(paths.workDir(), { recursive: true });
  fs.rmSync(audio, { force: true });

  // Native encoders only, as lib/media.js's tone: the fixture depends on no optional library.
  const made = await shown(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100:duration=10',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=320x240:r=10:d=10',
    '-shortest',
    '-c:v',
    'mpeg4',
    '-c:a',
    'aac',
    video,
  ]);
  expect(made.code, made.text).toBe(0);

  const stripped = await shown(ffmpeg, stripAudio(video, audio));
  const size = fs.existsSync(audio) ? fs.statSync(audio).size : 0;
  // No output file, so ffmpeg exits 1 after printing what the input is.
  const probed = await shown(ffmpeg, ['-hide_banner', '-i', audio]);
  evidence(
    '4. ffmpeg strip_audio',
    [made.text, stripped.text, `audio.mp3: ${size} bytes`, probed.text].join('\n'),
  );
  expect(stripped.code, stripped.text).toBe(0);
  expect(size, 'audio.mp3 is empty or missing').toBeGreaterThan(0);
  expect(probed.text).toMatch(/Audio: mp3.*16000 Hz, mono/);
}
