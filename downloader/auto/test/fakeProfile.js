// A stand-in for the challenge window's persistent Chrome: the page "lands" on the site or on a
// captcha host, runs page.evaluate in Node (so the in-page fetch code runs against the stubbed
// globalThis.fetch), and records every window move. Installed through configureChallenge.
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { configureChallenge, closeChallenge } from '../src/moodle/challenge.js';

export const CAPTCHA_URL = 'https://validate.perfdrive.com/abc/?ssa=1';

export function fakeProfile(t, { lands = 'site', idleMs, captchaMs } = {}) {
  const launches = [];
  const state = { lands };
  const launch = async (dir, opts) => {
    fs.mkdirSync(dir, { recursive: true });
    const context = new EventEmitter();
    let url = 'about:blank';
    const page = Object.assign(new EventEmitter(), {
      url: () => url,
      goto: async (u) => {
        context.visited.push(u);
        url = state.lands === 'site' ? u : CAPTCHA_URL;
      },
      evaluate: async (fn, arg) => fn(arg),
      bringToFront: async () => {
        context.fronted++;
      },
    });
    Object.assign(context, {
      dir,
      opts,
      page,
      visited: [],
      bounds: [],
      fronted: 0,
      closed: false,
      pages: () => [page],
      newCDPSession: async () => ({
        send: async (method, params) => {
          if (method === 'Browser.getWindowForTarget') return { windowId: 1 };
          if (params.bounds.left !== undefined) context.bounds.push(params.bounds);
          return {};
        },
        detach: async () => {},
      }),
      // The user solving the captcha: the page lands back on the site.
      solve: (site) => {
        url = `${site}/`;
        page.emit('framenavigated', page);
      },
      close: async () => {
        if (context.closed) return;
        context.closed = true;
        context.emit('close');
      },
    });
    launches.push(context);
    return context;
  };
  const restore = configureChallenge({
    launch,
    ...(idleMs ? { idleMs } : {}),
    ...(captchaMs ? { captchaMs } : {}),
  });
  t.after(async () => {
    await closeChallenge();
    restore();
  });
  return { launches, state };
}
