import fs from 'node:fs';
import path from 'node:path';
import { binDir, workDir } from './paths.js';
import { runToExit } from './windows.js';

const ffmpeg = () => path.join(binDir(), 'ffmpeg.exe');

// One video-only and one audio-only representation and no progressive format, so yt-dlp's default
// `bv*+ba/b` can only satisfy it by merging the two with ffmpeg.
const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT30S" minBufferTime="PT2S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="video" codecs="mp4v.20.9" width="320" height="240" bandwidth="20000">
        <BaseURL>video-only.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <Representation id="audio" codecs="mp4a.40.2" audioSamplingRate="44100" bandwidth="80000">
        <BaseURL>audio-only.m4a</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
`;

/** A 30-second tone video made by the shipped ffmpeg. Native encoders only, so it depends on no
 *  optional library the build may or may not carry. Answers the bytes. */
export async function toneVideo() {
  const out = path.join(workDir(), 'tone.mp4');
  fs.mkdirSync(workDir(), { recursive: true });
  const { code, output } = await runToExit(
    ffmpeg(),
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100:duration=30',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x240:r=10:d=30',
      '-shortest',
      '-c:v',
      'mpeg4',
      '-c:a',
      'aac',
      out,
    ],
    { timeoutMs: 120_000 },
  );
  if (code !== 0) throw new Error(`the shipped ffmpeg could not make the tone video:\n${output}`);
  return fs.readFileSync(out);
}

/** The stream kinds a media file carries, read off the shipped ffmpeg's input dump, e.g. `['video', 'audio']`. */
export async function streamKinds(file) {
  // No output file, so ffmpeg exits 1 after printing the input's streams; the dump is the answer.
  const { output } = await runToExit(ffmpeg(), ['-hide_banner', '-i', file], { timeoutMs: 60_000 });
  return [...output.matchAll(/^\s*Stream #\d+:\d+.*?: (Video|Audio):/gm)].map((m) =>
    m[1].toLowerCase(),
  );
}

/** The tone video split by the shipped ffmpeg into a DASH manifest (`MANIFEST`) beside its two
 *  single-stream files. Answers the directory, ready to serve. */
export async function dashFixture() {
  const dir = path.join(workDir(), 'dash');
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(workDir(), 'tone.mp4');
  if (!fs.existsSync(source)) await toneVideo();
  for (const [name, map, kind] of [
    ['video-only.mp4', '0:v', 'video'],
    ['audio-only.m4a', '0:a', 'audio'],
  ]) {
    const out = path.join(dir, name);
    const args = ['-y', '-i', source, '-map', map, '-c', 'copy', '-movflags', '+faststart', out];
    const { code, output } = await runToExit(ffmpeg(), args, { timeoutMs: 60_000 });
    if (code !== 0) throw new Error(`the shipped ffmpeg could not write ${name}:\n${output}`);
    const kinds = await streamKinds(out);
    if (kinds.join() !== kind) throw new Error(`${name} carries [${kinds}], not ${kind} alone`);
  }
  fs.writeFileSync(path.join(dir, 'manifest.mpd'), MANIFEST);
  return dir;
}
