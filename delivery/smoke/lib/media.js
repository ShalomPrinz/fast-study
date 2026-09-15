import fs from 'node:fs';
import path from 'node:path';
import { binDir, workDir } from './paths.js';
import { runToExit } from './windows.js';

/** A 30-second tone video made by the shipped ffmpeg. Native encoders only, so it depends on no
 *  optional library the build may or may not carry. Answers the bytes. */
export async function toneVideo() {
  const out = path.join(workDir(), 'tone.mp4');
  fs.mkdirSync(workDir(), { recursive: true });
  const { code, output } = await runToExit(
    path.join(binDir(), 'ffmpeg.exe'),
    [
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=30',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=10:d=30',
      '-shortest', '-c:v', 'mpeg4', '-c:a', 'aac',
      out,
    ],
    { timeoutMs: 120_000 },
  );
  if (code !== 0) throw new Error(`the shipped ffmpeg could not make the tone video:\n${output}`);
  return fs.readFileSync(out);
}
