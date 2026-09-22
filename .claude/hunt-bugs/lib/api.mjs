// The two service APIs the harness itself talks to. Disk is only ever reached through `database/`,
// the same rule the release smoke suite follows: the layout belongs to that service, and a harness
// that hand-built paths would hide exactly the bugs it is here to find.
import { setTimeout as sleep } from 'node:timers/promises';
import { PORTS } from './env.mjs';

export const DATABASE = `http://127.0.0.1:${PORTS.database}`;
export const BACKEND = `http://127.0.0.1:${PORTS.backend}`;

/** One request; a non-2xx is an error naming the method, the route and the body it answered. */
export async function call(url, { method = 'GET', body, headers = {}, expect = true } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  if (expect && !response.ok) {
    throw new Error(`${method} ${url} → HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: response.status, body: text };
  }
}

export const json = (url, method, payload) =>
  call(url, {
    method,
    body: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' },
  });

export const bytes = (url, method, buffer, type) =>
  call(url, { method, body: buffer, headers: { 'content-type': type } });

const encode = (part) => encodeURIComponent(part);

export const lectureFile = (course, lecture, name, kind = 'lecture') =>
  `${DATABASE}/courses/${encode(course)}/lectures/${encode(lecture)}/files/${encode(name)}?kind=${kind}`;

/** Poll until one of a lecture's files exists, or fail saying what never landed. */
export async function waitForFile(
  course,
  lecture,
  name,
  { kind = 'lecture', timeoutMs = 180_000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { status } = await call(lectureFile(course, lecture, name, kind), {
      method: 'HEAD',
      expect: false,
    });
    if (status === 200) return;
    await sleep(500);
  }
  throw new Error(`${course}/${lecture}: ${name} never appeared`);
}
