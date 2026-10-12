// A stand-in for the challenge window's persistent Chrome: the page "lands" on the site or on a
// captcha host, runs page.evaluate in Node against a stand-in document whose iframes' fetch is the
// stubbed globalThis.fetch, and records every window move. Installed through configureChallenge.
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { configureChallenge, closeChallenge } from '../src/moodle/challenge.js';

export const CAPTCHA_URL = 'https://validate.perfdrive.com/abc/?ssa=1';
export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

// Just the DOM pageFetch touches; each navigation gets a fresh one, dropping its iframes.
function fakeDocument() {
  const byId = new Map();
  const doc = {
    frames: 0,
    getElementById: (id) => byId.get(id) ?? null,
    createElement: () => ({ style: {}, contentWindow: null }),
    documentElement: {
      appendChild: (el) => {
        el.contentWindow = { fetch: (...args) => globalThis.fetch(...args) };
        byId.set(el.id, el);
        doc.frames++;
      },
    },
  };
  return doc;
}

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
        context.document = fakeDocument();
      },
      evaluate: async (fn, arg) => {
        globalThis.document = context.document;
        return fn(arg);
      },
      bringToFront: async () => {
        context.fronted++;
      },
    });
    Object.assign(context, {
      dir,
      opts,
      page,
      document: fakeDocument(),
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
    userAgent: async () => CHROME_UA,
    ...(idleMs ? { idleMs } : {}),
    ...(captchaMs ? { captchaMs } : {}),
  });
  t.after(async () => {
    await closeChallenge();
    restore();
    delete globalThis.document;
  });
  return { launches, state };
}
