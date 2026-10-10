import { MATERIAL_TEMP_FILENAME } from '../config.js';
import { probeContentLength } from '../services/probe.js';
import { uploadMaterial } from '../services/database.js';
import { curlTransferArgs, autodlHeaderList, readAutodlRefusal } from '../services/autodl.js';

// No captured-header replay: the URL authenticates by its own query-string token, or is a file on
// auto. curlTransferArgs picks the failure and retry flags per host.
function buildFetchArgs(url, tempDir) {
  return [
    ...curlTransferArgs(url, tempDir),
    '-L',
    '--compressed',
    '--silent',
    '--show-error',
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
  refusal: (tempDir) => readAutodlRefusal(tempDir, MATERIAL_TEMP_FILENAME),
  buildCommand: ({ url }, tempDir) => ({ command: 'curl', args: buildFetchArgs(url, tempDir) }),
};
