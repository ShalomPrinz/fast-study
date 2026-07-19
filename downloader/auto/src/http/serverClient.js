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
 * @param {{ url: string, headers: Record<string,string>, course: string, lecture: string, kind?: string }} payload
 * @returns {Promise<string|undefined>} the server's job id, pollable via getJobs
 */
export async function postDownload({ url, headers, course, lecture, kind }) {
  const body = await postJson('/download', { url, headers, course, lecture, kind });
  return body?.jobId;
}

/**
 * YouTube entry: server.js runs yt-dlp (no captured headers — it manages its own session).
 * @param {{ url: string, course: string, lecture: string, kind?: string }} payload
 * @returns {Promise<string|undefined>} the server's job id, pollable via getJobs
 */
export async function postDownloadYoutube({ url, course, lecture, kind }) {
  const body = await postJson('/download-youtube', { url, course, lecture, kind });
  return body?.jobId;
}

/**
 * Read back download jobs by id. The frontend can't hit server/ directly (its CORS is
 * locked to the extension origin), so /progress proxies through here.
 * @param {string[]} ids
 * @returns {Promise<object[]>}
 */
export async function getJobs(ids) {
  const qs = ids.length ? `?ids=${encodeURIComponent(ids.join(','))}` : '';
  const res = await fetch(`${SERVER_URL}/jobs${qs}`);
  if (!res.ok) throw new Error(`GET /jobs failed: ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return body?.jobs ?? [];
}
