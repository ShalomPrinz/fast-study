// A stand-in for the challenge window's persistent Chrome: the page "lands" on the site or on a
// captcha host, runs page.evaluate in Node against a stand-in document whose iframes' fetch is the
// stubbed globalThis.fetch, and records every window move. Installed through configureChallenge.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { configureChallenge, closeChallenge } from '../src/moodle/challenge.js';
import { configureWindowStyle } from '../src/browser/windowStyle.js';

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

// `log` is the ordered record of every window move ('bounds:<json>') and style change ('style:on'/'style:off').
// `styleFails` makes the styling spawn reject.
export function fakeProfile(t, { lands = 'site', idleMs, captchaMs, styleFails = false } = {}) {
  const launches = [];
  const log = [];
  const state = { lands };
  const restoreStyle = configureWindowStyle({
    platform: 'win32',
    run: async (script) => {
      const kind = /\$tool = \$true/.test(script) ? 'style:on' : 'style:off';
      log.push(kind);
      // A test's hook into the style spawn, e.g. the captcha clearing while the window is un-hidden.
      await state.onStyle?.(kind);
      if (styleFails) throw new Error('powershell missing');
    },
  });
  const launch = async (dir, opts) => {
    const prefsFile = path.join(dir, 'Default', 'Preferences');
    const prefsAtLaunch = fs.existsSync(prefsFile) ? fs.readFileSync(prefsFile, 'utf8') : null;
    fs.mkdirSync(dir, { recursive: true });
    const context = new EventEmitter();
    let url = 'about:blank';
    const page = Object.assign(new EventEmitter(), {
      url: () => url,
      goto: async (u) => {
        context.visited.push(u);
        url = state.lands === 'site' ? u : CAPTCHA_URL;
        context.document = fakeDocument();
        // A test's hook into the navigation, e.g. the user closing the window mid-load.
        await state.onGoto?.(context);
      },
      evaluate: async (fn, arg) => {
        globalThis.document = context.document;
        return fn(arg);
      },
      bringToFront: async () => {
        context.fronted++;
        log.push('front');
      },
    });
    Object.assign(context, {
      dir,
      prefsAtLaunch,
      opts,
      page,
      document: fakeDocument(),
      visited: [],
      bounds: [],
      // Every setWindowBounds, window states included.
      steps: [],
      fronted: 0,
      closed: false,
      pages: () => [page],
      newCDPSession: async () => ({
        send: async (method, params) => {
          if (method === 'Browser.getWindowForTarget') return { windowId: 1 };
          context.steps.push(params.bounds);
          log.push(`bounds:${JSON.stringify(params.bounds)}`);
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
    restoreStyle();
    delete globalThis.document;
  });
  return { launches, state, log };
}
