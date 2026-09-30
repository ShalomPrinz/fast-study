// The offline shim every Node service is started with, attached through NODE_OPTIONS --import.
// It works one level below the HTTP clients, on the socket: every connection off loopback is
// either redirected to the fake lecture site or destroyed with a named error. Patching fetch or
// `http.request` would not be enough — the services import `spawn`, `request` and friends as ESM
// named bindings, which a module-object patch cannot reach.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const HARNESS = process.env.HARNESS_DIR;

if (HARNESS) {
  const SITE = new URL(process.env.HARNESS_SITE);
  const SITE_TLS = new URL(process.env.HARNESS_SITE_TLS);
  const LOG = path.join(HARNESS, 'logs', 'network.log');

  // Hosts the fake site answers for, as Chromium host globs. Everything else off loopback is an
  // escape: a real request the harness did not model, and a finding made after one would be about the internet.
  const SERVED = [
    'biu.ac.il',
    '*.biu.ac.il',
    'youtube.com',
    '*.youtube.com',
    'youtu.be',
    'zoom.us',
    '*.zoom.us',
    'drive.google.com',
    'docs.google.com',
  ];
  const isServed = (host) => {
    const name = String(host).toLowerCase();
    return SERVED.some((glob) =>
      glob.startsWith('*.') ? name.endsWith(glob.slice(1)) : name === glob,
    );
  };

  const isLocal = (host) =>
    host === undefined ||
    host === null ||
    host === '' ||
    host === 'localhost' ||
    host === '::1' ||
    String(host).startsWith('127.');

  function note(line) {
    try {
      fs.mkdirSync(path.dirname(LOG), { recursive: true });
      fs.appendFileSync(
        LOG,
        `${new Date().toISOString()} ${process.env.HARNESS_SERVICE ?? 'node'} ${line}\n`,
      );
    } catch {}
  }

  const originalConnect = net.Socket.prototype.connect;

  net.Socket.prototype.connect = function connect(...args) {
    const [first] = args;
    let host;
    let port;
    if (typeof first === 'object' && first !== null) {
      if (first.path) return originalConnect.apply(this, args); // a unix socket goes nowhere
      host = first.host;
      port = first.port;
    } else if (typeof first === 'number' || typeof first === 'string') {
      port = Number(first);
      host = typeof args[1] === 'string' ? args[1] : undefined;
    } else {
      return originalConnect.apply(this, args);
    }

    if (isLocal(host)) return originalConnect.apply(this, args);

    if (!isServed(host)) {
      const message =
        `harness is offline — refused a connection to ${host}:${port}. ` +
        'Nothing outside the fakes may be reached; a finding recorded after this is suspect.';
      note(`REFUSED ${host}:${port}`);
      process.nextTick(() => this.destroy(new Error(message)));
      return this;
    }

    // 443 lands on the fake site's TLS listener, anything else on its plain one. The original
    // Host header rides along untouched, so the fake can still route by the host that was asked for.
    const target = Number(port) === 443 ? SITE_TLS : SITE;
    note(`REDIRECT ${host}:${port} -> ${target.hostname}:${target.port}`);
    if (typeof first === 'object') {
      return originalConnect.apply(this, [
        { ...first, host: target.hostname, hostname: target.hostname, port: Number(target.port) },
        ...args.slice(1),
      ]);
    }
    return originalConnect.apply(this, [
      Number(target.port),
      target.hostname,
      ...args.slice(typeof args[1] === 'string' ? 2 : 1),
    ]);
  };

  // auto/'s browsers are processes of their own, out of the socket patch's reach, so every launch is
  // rewritten: headless, the harness's chromium, served hosts mapped to the fake site's TLS port
  // and every other name unresolvable. One prototype patch covers the plain, probe and zoom launches.
  if (process.env.HARNESS_SERVICE === 'downloader-auto') {
    const { createRequire } = await import('node:module');
    const { installedChromium } = await import('../lib/browser.mjs');
    const { REPO_ROOT } = await import('../lib/env.mjs');
    const { chromium } = createRequire(path.join(REPO_ROOT, 'downloader', 'auto', 'package.json'))(
      'playwright-core',
    );
    const rules = [
      ...SERVED.map((glob) => `MAP ${glob} ${SITE_TLS.host}`),
      'MAP * ~NOTFOUND',
      'EXCLUDE localhost',
      'EXCLUDE 127.0.0.1',
    ].join(', ');
    const browserType = Object.getPrototypeOf(chromium);
    const originalLaunch = browserType.launch;
    browserType.launch = async function launch({ channel: _channel, ...options } = {}) {
      const browser = await originalLaunch.call(this, {
        ...options,
        headless: true,
        executablePath: installedChromium(),
        args: [
          ...(options.args ?? []),
          `--host-resolver-rules=${rules}`,
          '--ignore-certificate-errors',
        ],
      });
      // The browser cannot write network.log, so a name it failed to resolve is logged from here.
      // moodlemobile:// fails by design — it is how the login token arrives.
      const originalNewContext = browser.newContext;
      browser.newContext = async function newContext(...args) {
        const context = await originalNewContext.apply(this, args);
        context.on('requestfailed', (request) => {
          const url = new URL(request.url());
          if (!/^https?:$/.test(url.protocol)) return;
          if (request.failure()?.errorText !== 'net::ERR_NAME_NOT_RESOLVED') return;
          const port = url.port || (url.protocol === 'https:' ? 443 : 80);
          note(`REFUSED ${url.hostname}:${port} (browser)`);
        });
        return context;
      };
      return browser;
    };
  }

  process.stderr.write(
    `harness shim: live (site ${SITE.host}, tls ${SITE_TLS.host}, bin ${path.join(HARNESS, 'bin')})\n`,
  );
}
