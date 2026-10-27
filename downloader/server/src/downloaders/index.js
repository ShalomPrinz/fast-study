import { curl } from './curl.js';
import { ytdlp } from './ytdlp.js';
import { fetchFile } from './fetch.js';
import { hls } from './hls.js';

// Registry of download sources. Add a source by importing its module and
// registering it here — the runner and routes stay untouched.
export const downloaders = { curl, ytdlp, fetch: fetchFile, hls };

export { runDownloadJob } from './runner.js';
