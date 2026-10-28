import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { uploadVideo } from '../services/database.js';
import { probeHlsBytes } from '../services/hls.js';
import { ytdlp, buildHlsArgs, buildCookieJar } from './ytdlp.js';
import { toolPath } from '@faststudy/tools';

// An HLS playlist capture: yt-dlp with the captured headers replayed on the playlists and every
// segment (docs/DOWNLOAD.md, "HLS"). input: { url, headers }. Same `yt-dlp` tool and timing bucket.
export const hls = {
  ...ytdlp,
  upload: uploadVideo,
  probeSize: ({ url, headers }) => probeHlsBytes(url, headers),
  buildCommand: ({ url, headers }, tempDir) => ({
    command: toolPath('yt-dlp'),
    args: buildHlsArgs(url, headers, writeCookieJar(url, headers, tempDir)),
    env: ytdlp.buildCommand({ url }).env,
  }),
};

// The cookie jar lives in the job's temp dir, which the runner removes on every exit path.
function writeCookieJar(url, headers, tempDir) {
  const jar = buildCookieJar(url, headers);
  if (!jar) return null;
  const file = join(tempDir, 'cookies.txt');
  writeFileSync(file, jar, { mode: 0o600 });
  return file;
}
