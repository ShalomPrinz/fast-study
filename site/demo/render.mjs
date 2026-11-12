// Renders the demo in both languages into site/video/: an H.264 + AAC MP4 with the moov atom
// first, and the Poster still. `--posters` renders the posters alone and leaves the MP4s as they are.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'video');
const LANGS = ['he', 'en'];
const POSTERS_ONLY = process.argv.includes('--posters');

fs.mkdirSync(OUT, { recursive: true });
await ensureBrowser();
const serveUrl = await bundle({ entryPoint: path.join(HERE, 'src', 'index.jsx') });

for (const lang of LANGS) {
  const inputProps = { lang };
  if (!POSTERS_ONLY) {
    const composition = await selectComposition({ serveUrl, id: 'Demo', inputProps });
    const raw = path.join(OUT, `demo-${lang}.raw.mp4`);
    const video = path.join(OUT, `demo-${lang}.mp4`);
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: 'h264',
      crf: 23,
      pixelFormat: 'yuv420p',
      imageFormat: 'jpeg',
      jpegQuality: 95,
      audioCodec: 'aac',
      audioBitrate: '128k',
      outputLocation: raw,
    });
    // A remux, no re-encode: the moov atom moves to the front so the page plays it while it loads.
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-i', raw, '-c', 'copy', '-movflags', '+faststart', video],
    ]);
    fs.rmSync(raw);
  }
  await renderStill({
    composition: await selectComposition({ serveUrl, id: 'Poster', inputProps }),
    serveUrl,
    inputProps,
    imageFormat: 'jpeg',
    jpegQuality: 82,
    output: path.join(OUT, `poster-${lang}.jpg`),
  });
  console.log(`rendered ${POSTERS_ONLY ? '' : `demo-${lang}.mp4 and `}poster-${lang}.jpg`);
}
