import { SERVER_URL } from '../lib/config.js';

/**
 * POST a JSON body and return parsed JSON (or {}). Throws on non-2xx with the
 * response text. No CORS problem: server.js only *sets* CORS response headers
 * (browser-enforced); it doesn't reject by origin, so a Node client posts directly.
 * @param {string} path
 * @param {unknown} body
 * @returns {Promise<unknown>}
 */
async function postJson(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} failed: ${res.status} ${text}`.trim());
  }
  return res.json().catch(() => ({}));
}

/**
 * In-site .mp4 (videostream): server.js replays the captured headers via curl.
 * @param {{ url: string, headers: Record<string,string>, course: string, lecture: string, kind?: string, ref?: string|null }} payload
 * @returns {Promise<string|undefined>} server/'s job id
 */
export async function postDownload({ url, headers, course, lecture, kind, ref }) {
  const body = await postJson('/download', { url, headers, course, lecture, kind, ref });
  return body?.jobId;
}

/**
 * YouTube entry: server.js runs yt-dlp (no captured headers — it manages its own session).
 * @param {{ url: string, course: string, lecture: string, kind?: string, ref?: string|null }} payload
 * @returns {Promise<string|undefined>} server/'s job id
 */
export async function postDownloadYoutube({ url, course, lecture, kind, ref }) {
  const body = await postJson('/download-youtube', { url, course, lecture, kind, ref });
  return body?.jobId;
}
