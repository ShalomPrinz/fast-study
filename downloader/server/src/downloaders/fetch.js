import { MATERIAL_TEMP_FILENAME } from '../config.js';
import { probeContentLength } from '../services/probe.js';
import { uploadMaterial } from '../services/database.js';

// No -H replay: the URL authenticates by its own query-string token, so there are no
// captured headers to forward. --retry-all-errors covers CDNs that drop TLS mid-stream.
function buildFetchArgs(url) {
  return [
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
    MATERIAL_TEMP_FILENAME,
    url,
  ];
}

// Plain-URL file capture saved as the lecture's material. input: { url }.
// measure 'dir' (not 'file', which stats VIDEO_FILENAME): the temp dir holds only this output.
export const fetchFile = {
  tool: 'fetch',
  measure: 'dir',
  upload: uploadMaterial, // not uploadVideo: the material upload must not wipe derived artifacts
  probeSize: ({ url }) => probeContentLength(url, []),
  buildCommand: ({ url }) => ({ command: 'curl', args: buildFetchArgs(url) }),
};
