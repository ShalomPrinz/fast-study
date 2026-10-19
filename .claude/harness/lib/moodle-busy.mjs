// `hb moodle-busy`: auto/'s one Moodle lock held for real, by a Moodle call the fake site never
// answers, so every gated route sees the lock taken exactly as it does behind a slow request.
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { AUTO, SITE, call, json } from './api.mjs';

/** Resolve once /auth/events pushes `moodleBusy === want`; throw after `timeoutMs`. */
export async function busyIs(want, timeoutMs = 15_000) {
  const response = await fetch(`${AUTO}/auth/events`, { signal: AbortSignal.timeout(timeoutMs) });
  let text = '';
  try {
    for await (const chunk of response.body) {
      text += Buffer.from(chunk).toString('utf8');
      const frames = text.split('\n\n');
      text = frames.pop();
      for (const frame of frames) {
        const data = frame.replace(/^data: /, '');
        if (JSON.parse(data).moodleBusy === want) return;
      }
    }
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
  }
  throw new Error(`moodleBusy never read ${want} on ${AUTO}/auth/events within ${timeoutMs} ms`);
}

/** Park the site's Moodle answers and send auto/ one gated call, which then holds the lock. */
export async function holdMoodle() {
  // A lock still held reads busy, and a call sent into it is refused without ever being parked.
  await busyIs(false);
  await json(`${SITE}/control`, 'POST', { hold: true });
  // No wait header, so it takes the lock or is refused as a frontend call is. Never answered while
  // the hold lasts, so its socket is unref'd for hb to exit; auto/ keeps the call in flight.
  let refused = null;
  const request = http.get(`${AUTO}/courses`, (response) => {
    if (response.statusCode !== 200) refused = response.statusCode;
    response.resume();
  });
  request.on('socket', (socket) => socket.unref());
  request.on('error', () => {});
  try {
    await busyIs(true);
    // The lock reads busy before the call is sent, so wait for the site to have it parked.
    const deadline = Date.now() + 5_000;
    while (!refused && !(await call(`${SITE}/health`)).body.parked) {
      if (Date.now() > deadline) break;
      await sleep(100);
    }
    if (refused || Date.now() > deadline) {
      throw new Error(`GET ${AUTO}/courses never reached the site (HTTP ${refused ?? 'pending'})`);
    }
  } catch (error) {
    // Left on, the hold would park every later Moodle call with no lock behind it.
    await json(`${SITE}/control`, 'POST', { hold: false });
    throw error;
  }
}

/** Answer every parked call, which frees auto/'s lock. */
export async function releaseMoodle() {
  await json(`${SITE}/control`, 'POST', { hold: false });
  await busyIs(false);
}
