// The offline shim every Node service is started with, attached through NODE_OPTIONS --import.
// It works one level below the HTTP clients, on the socket: every connection off loopback is
// either redirected to the fake lecture site or destroyed with a named error. Patching fetch or
// `http.request` would not be enough — the services import `spawn`, `request` and friends as ESM
// named bindings, which a module-object patch cannot reach.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const HARNESS = process.env.HUNT_BUGS_HARNESS;

if (HARNESS) {
  const SITE = new URL(process.env.HUNT_BUGS_SITE ?? 'http://127.0.0.1:4599');
  const SITE_TLS = new URL(process.env.HUNT_BUGS_SITE_TLS ?? 'https://127.0.0.1:4699');
  const LOG = path.join(HARNESS, 'logs', 'network.log');

  // Hosts the fake site answers for. Everything else off loopback is an escape: a real request
  // the harness did not model, and a finding made after one would be about the internet.
  const SERVED = [
    /(^|\.)biu\.ac\.il$/i,
    /(^|\.)youtube\.com$/i,
    /^youtu\.be$/i,
    /(^|\.)zoom\.us$/i,
    /^(drive|docs)\.google\.com$/i,
  ];

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
        `${new Date().toISOString()} ${process.env.HUNT_BUGS_SERVICE ?? 'node'} ${line}\n`,
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

    if (!SERVED.some((re) => re.test(String(host)))) {
      const message =
        `hunt-bugs harness is offline — refused a connection to ${host}:${port}. ` +
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

  process.stderr.write(
    `hunt-bugs shim: live (site ${SITE.host}, tls ${SITE_TLS.host}, bin ${path.join(HARNESS, 'bin')})\n`,
  );
}
