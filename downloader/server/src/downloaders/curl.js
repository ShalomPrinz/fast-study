import { VIDEO_FILENAME } from '../config.js';
import { SKIP_HEADERS, probeContentLength } from '../services/probe.js';
import { toolPath } from '@faststudy/tools';
import { uploadVideo } from '../services/database.js';

// Replay the browser's captured headers so short-lived tokens + Referer/Origin
// checks pass. Range/conditional headers stripped (SKIP_HEADERS) so the body isn't
// a partial, offset-0-less MP4. --retry-all-errors covers CDNs that close TLS
// without close_notify mid-stream. See docs/DOWNLOAD.md.
function buildCurlArgs(url, headers) {
  const args = [
    '-L',
    '--fail',
    '--compressed',
    '--silent',
    '--show-error',
    '--retry',
    '3',
    '--retry-delay',
    '2',
    '--retry-all-errors',
    '--output',
    VIDEO_FILENAME,
  ];
  for (const h of headers ?? []) {
    if (SKIP_HEADERS.has(h.name.toLowerCase())) continue;
    args.push('-H', `${h.name}: ${h.value}`);
  }
  args.push(url);
  return args;
}

// Generic .mp4 capture. input: { url, headers }.
export const curl = {
  tool: 'curl',
  measure: 'file', // stat the lone video.mp4
  upload: uploadVideo,
  probeSize: ({ url, headers }) => probeContentLength(url, headers),
  buildCommand: ({ url, headers }) => ({
    command: toolPath('curl'),
    args: buildCurlArgs(url, headers),
  }),
};
