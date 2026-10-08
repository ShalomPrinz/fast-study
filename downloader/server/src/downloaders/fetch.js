import { MATERIAL_TEMP_FILENAME } from '../config.js';
import { probeContentLength } from '../services/probe.js';
import { uploadMaterial } from '../services/database.js';
import { autodlCurlArgs, autodlHeaderList } from '../services/autodl.js';

// No captured-header replay: the URL authenticates by its own query-string token, or is a file on
// auto. --retry-all-errors covers CDNs that drop TLS mid-stream.
function buildFetchArgs(url, tempDir) {
  return [
    ...autodlCurlArgs(url, tempDir),
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
// measure 'dir' (not 'file', which stats VIDEO_FILENAME): beside this output the temp dir holds at
// most the header file for auto, which the sum leaves out.
export const fetchFile = {
  tool: 'fetch',
  measure: 'dir',
  upload: uploadMaterial, // not uploadVideo: the material upload must not wipe derived artifacts
  probeSize: ({ url }) => probeContentLength(url, autodlHeaderList(url)),
  buildCommand: ({ url }, tempDir) => ({ command: 'curl', args: buildFetchArgs(url, tempDir) }),
};
