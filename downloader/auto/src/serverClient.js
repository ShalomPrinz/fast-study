import { SERVER_URL } from './config.js';

/**
 * UNUSED IN THE MVP. The download phase is future work (see plan §7): the
 * user-selected captures will be POSTed here so server.js replays the headers
 * via curl and streams video.mp4 to the database service. Thin stub for now.
 *
 * No CORS problem: server.js only *sets* CORS response headers (browser-
 * enforced); it doesn't reject by origin, so a Node client posts directly.
 *
 * @param {{ url: string, headers: Record<string,string>, course: string, lecture: string, kind?: string }} payload
 * @returns {Promise<unknown>}
 */
export async function postDownload({ url, headers, course, lecture, kind }) {
  const res = await fetch(`${SERVER_URL}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, headers, course, lecture, kind }),
  });
  if (!res.ok) throw new Error(`POST /download failed: ${res.status}`);
  return res.json().catch(() => ({}));
}
