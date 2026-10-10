import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { AUTODL_URL } from '../config.js';
import { peerHeaders } from '@faststudy/runtime';

// Marks a call this server makes on its own — a section walk, a re-resolve, a Moodle file fetch —
// so auto queues it for the Moodle lock instead of refusing it 429 moodle_busy (auto docs/GATE.md).
export const MOODLE_WAIT_HEADER = 'X-FastStudy-Moodle-Wait';

/** True when `url` is on auto itself — a Moodle file auto streams, which takes the peer headers. */
export function onAutodl(url) {
  try {
    return new URL(url).origin === new URL(AUTODL_URL).origin;
  } catch {
    return false;
  }
}

// What a fetch of a file on auto sends: the launch secret, and the wait marker — nobody pressed
// anything for a download already running. Nothing at all for any other host.
function autodlHeaders(url) {
  return onAutodl(url) ? peerHeaders({ [MOODLE_WAIT_HEADER]: '1' }) : {};
}

/** autodlHeaders as the `[{name, value}]` list the size probe takes. */
export function autodlHeaderList(url) {
  return Object.entries(autodlHeaders(url)).map(([name, value]) => ({ name, value }));
}

// Kept in a file curl reads (`-H @file`), not on argv, where any local process could read the secret.
export const HEADER_FILE = 'request-headers.txt';
// auto's response headers, dumped by curl so the runner can read the status of a refusal.
export const RESPONSE_FILE = 'response-headers.txt';
// The temp-dir files that are not the download, which a byte count leaves out.
export const AUTODL_FILES = new Set([HEADER_FILE, RESPONSE_FILE]);

// curl's failure and retry flags for `url`; auto's take none, so its refusal stays typed
// (docs/DOWNLOAD.md). Writes autodlHeaders to a file in `tempDir` for auto.
export function curlTransferArgs(url, tempDir) {
  const headers = Object.entries(autodlHeaders(url));
  if (!headers.length)
    return ['--fail', '--retry', '3', '--retry-delay', '2', '--retry-all-errors'];
  const lines = headers.map(([name, value]) => `${name}: ${value}\n`).join('');
  fs.writeFileSync(path.join(tempDir, HEADER_FILE), lines, { mode: 0o600 });
  return ['-H', `@${HEADER_FILE}`, '--dump-header', RESPONSE_FILE];
}

/** The final HTTP status in a curl header dump (the last of a -L chain); null with none. */
export function finalStatus(headerText) {
  const statuses = [...headerText.matchAll(/^HTTP\/\S+\s+(\d{3})/gm)];
  return statuses.length ? Number(statuses.at(-1)[1]) : null;
}

/**
 * auto's non-2xx answer as `{ status, error, code, params }` from its JSON body; code and params
 * are null when the body is not auto's `{code, params}` envelope.
 */
export function autodlRefusal(status, bodyText) {
  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {}
  if (body && typeof body.code === 'string')
    return {
      status,
      error: body.message ?? body.error ?? `auto answered HTTP ${status}`,
      code: body.code,
      params: body.params ?? {},
    };
  return { status, error: `auto answered HTTP ${status}`, code: null, params: null };
}

/**
 * A finished curl's refusal from auto, read off `tempDir` (`output` holds the body); null for a
 * 2xx, any other host, or no answer at all (a transport failure keeps curl's own exit).
 */
export function readAutodlRefusal(tempDir, output) {
  let status;
  try {
    status = finalStatus(fs.readFileSync(path.join(tempDir, RESPONSE_FILE), 'utf8'));
  } catch {
    return null;
  }
  if (status === null || resolved(status)) return null;
  let body = '';
  try {
    body = fs.readFileSync(path.join(tempDir, output), 'utf8');
  } catch {}
  return autodlRefusal(status, body);
}

/** A target's url as a fetchable one: auto hands its own files out as paths relative to itself. */
export function targetUrl(url) {
  return new URL(url, AUTODL_URL).toString();
}

// auto/ answered with targets. Anything else — its 4xx contract, a 5xx, or status 0
// (unreachable) — is a failure to forward or report.
export function resolved(status) {
  return status >= 200 && status < 300;
}

/**
 * Resolver edge to auto/: a discovery `ref`, or a pasted `url` in its place, → `{ media, targets }`.
 * A non-2xx is RETURNED, never thrown, so the routes can forward auto's status and body verbatim.
 * `wait` marks this server's own calls, which queue for the Moodle lock; a user's button press
 * leaves it off and gets auto's 429 `moodle_busy` back to forward.
 * @param {{ ref?: string, url?: string, course: string, name: string, kind: string,
 *           only?: boolean, forceCapture?: boolean, wait?: boolean, signal?: AbortSignal }} args
 * @returns {Promise<{ status: number, body: object|null }>} status 0 = unreachable
 */
export async function resolve({
  ref,
  url,
  course,
  name,
  kind,
  only = false,
  forceCapture = false,
  wait = false,
  signal,
}) {
  const headers = { 'Content-Type': 'application/json' };
  if (wait) headers[MOODLE_WAIT_HEADER] = '1';
  try {
    const res = await postJson(
      `${AUTODL_URL}/resolve`,
      peerHeaders(headers),
      JSON.stringify({ ref, url, course, name, kind, only, forceCapture }),
      signal,
    );
    let body = null;
    try {
      body = JSON.parse(res.text);
    } catch {}
    return { status: res.status, body };
  } catch (err) {
    return {
      status: 0,
      body: { error: err.message, code: 'autodl_unreachable', params: { detail: err.message } },
    };
  }
}

/**
 * POST over node:http → `{ status, text }`. Not fetch: undici gives up on a response whose headers
 * take over 300s, and a waiting call can sit behind a 10-minute login or an open challenge window.
 * node:http's client has no timeout of its own, so a queued call waits as long as auto holds it.
 */
export function postJson(url, headers, body, signal) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        signal,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
