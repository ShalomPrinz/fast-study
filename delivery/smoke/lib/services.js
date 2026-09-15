import { expect } from '@playwright/test';
import { waitFor } from './wait.js';

const q = encodeURIComponent;

// A provider call that failed on the network: the Groq SDK's `Connection error.`, httpx's connect
// errors, and the WinError a Windows Firewall block raises on connect.
export const NETWORK_FAILURE =
  /connection error|connecterror|connection (refused|reset|aborted)|failed to establish|getaddrinfo|name resolution|forbidden by its access permissions|winerror 100\d\d|socket|timed out|unreachable/i;
// What a packaging failure reads like instead: a module the bundle lost, a key the env never got,
// or a prerequisite file the step could not find.
export const NOT_A_NETWORK_FAILURE =
  /traceback|no module named|modulenotfounderror|importerror|cannot import|attributeerror|dll load failed|is not set in the environment|is required/i;

/** HTTP to one service as the app's renderer reaches it: the bridge's URL and launch secret. */
async function call(base, secret, method, route, { json, bytes, accept = [200, 204] } = {}) {
  const headers = { 'X-FastStudy-Secret': secret };
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (bytes !== undefined) {
    body = bytes;
  }
  const response = await fetch(`${base}${route}`, { method, headers, body });
  if (!accept.includes(response.status)) {
    throw new Error(`${method} ${route} answered ${response.status}: ${await response.text()}`);
  }
  return response;
}

/** `database/`'s routes — the only way the suite touches DATA_ROOT. */
export function database({ urls, secret }) {
  const at = (method, route, options) => call(urls.database, secret, method, route, options);
  const lecture = (course, name) => `/courses/${q(course)}/lectures/${q(name)}`;
  return {
    /** Resolves once the data root the wall saved has reached the running service. */
    async configured() {
      await expect
        .poll(async () => (await fetch(`${urls.database}/tree`, { headers: { 'X-FastStudy-Secret': secret } })).status, {
          timeout: 30_000,
        })
        .toBe(200);
    },
    createCourse: (course) => at('POST', '/courses', { json: { name: course } }),
    createLecture: (course, name) => at('POST', `/courses/${q(course)}/lectures`, { json: { name } }),
    putVideo: (course, name, bytes) => at('PUT', `${lecture(course, name)}/video`, { bytes }),
    putFile: (course, name, file, bytes) =>
      at('PUT', `${lecture(course, name)}/files/${q(file)}`, { bytes }),
    putSummary: (course, name, text) =>
      at('PUT', `${lecture(course, name)}/summary`, { bytes: Buffer.from(text, 'utf8') }),
    async exists(course, name, file) {
      const response = await at('HEAD', `${lecture(course, name)}/files/${q(file)}`, {
        accept: [200, 404],
      });
      return response.status === 200;
    },
    async bytes(course, name, file) {
      return Buffer.from(await (await at('GET', `${lecture(course, name)}/files/${q(file)}`)).arrayBuffer());
    },
    /** The absolute path, resolved by the same route the open-file IPC path uses. */
    async path(course, name, file) {
      return (await (await at('GET', `${lecture(course, name)}/files/${q(file)}/path`)).json()).path;
    },
    /** One lecture's entry in the tree, `files` and all. */
    async entry(course, name) {
      const tree = await (await at('GET', '/tree')).json();
      const node = tree.find((c) => c.name === course);
      return node?.lectures.find((l) => l.name === name) ?? null;
    },
  };
}

/** `backend/`'s pipeline routes. */
export function backend({ urls, secret }) {
  const at = (method, route, options) => call(urls.backend, secret, method, route, options);
  const lecture = (course, name) => `/courses/${q(course)}/lectures/${q(name)}`;
  const status = async () => (await at('GET', '/status')).json();
  return {
    status,
    async health() {
      return (await fetch(`${urls.backend}/health`)).json();
    },
    /** Start one step and wait for that run to end; answers the error it left, or null. */
    async runStep(course, name, step, { timeoutMs = 300_000 } = {}) {
      const started = await (await at('POST', `${lecture(course, name)}/run/${step}`)).json();
      expect(started, `run/${step} did not start`).toEqual({ status: 'started' });
      return this.waitForRunEnd(course, name, step, timeoutMs);
    },
    /** A started step marks itself in flight before its first await, so it is already visible to
     *  the next request; the run is over once it is gone. */
    async waitForRunEnd(course, name, label, timeoutMs) {
      const snapshot = await waitFor(
        async () => {
          const current = await status();
          const entry = current.in_flight.find((e) => e.course === course && e.lecture === name);
          if (entry?.sleeping_until) {
            throw new Error(`${label} is rate-limited and sleeping, so a provider answered`);
          }
          return entry ? null : current;
        },
        { timeoutMs, intervalMs: 500, message: `${label} on ${course}/${name} never finished` },
      );
      // The backend's own error key, as /status spells it.
      return snapshot.errors[`${course}||${name}||lecture`] ?? null;
    },
    runPipeline: async (course, name) =>
      (await at('POST', `${lecture(course, name)}/pipeline`)).json(),
  };
}

/** Every service's `/health`, which is the one route that needs no secret. */
export async function healthOf(urls) {
  const answers = {};
  for (const [key, url] of Object.entries(urls)) {
    answers[key] = await (await fetch(`${url}/health`)).json();
  }
  return answers;
}
