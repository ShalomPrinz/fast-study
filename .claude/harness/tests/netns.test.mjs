import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { DISABLE_ENV, fallbackReason, probe, wrapperScript } from '../lib/netns.mjs';
import { tcpToUnix, unixToTcp } from '../lib/relay.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hbns-test-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

describe('fallbackReason', () => {
  test('namespace ok: no reason', () => {
    assert.equal(fallbackReason({}), null);
  });
  test('unshare fails', () => {
    assert.match(
      fallbackReason({ unshare: 'Operation not permitted' }),
      /unshare -rn failed: Operation not permitted/,
    );
  });
  test('lo cannot come up', () => {
    assert.match(
      fallbackReason({ lo: 'RTNETLINK answers: denied' }),
      /cannot bring lo up: RTNETLINK/,
    );
  });
  test('the env switch wins', async () => {
    assert.match(fallbackReason({ disabled: true, unshare: 'x' }), new RegExp(DISABLE_ENV));
    assert.match(await probe({ [DISABLE_ENV]: '0' }), /disabled/);
  });
});

test('the wrapper enters the namespace and quotes its paths', () => {
  const script = wrapperScript("/odd path/it's/node");
  assert.match(
    script,
    /^#!\/bin\/sh\nexec unshare -rn '\/odd path\/it'\\''s\/node' '.*netns-inner\.mjs' "\$@"\n$/,
  );
});

describe('relays', () => {
  const listening = (server) =>
    new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

  async function chain(target) {
    const sock = path.join(scratch, `${Math.random().toString(36).slice(2, 8)}.sock`);
    const outer = await unixToTcp(sock, target);
    // The inner half on a free port stands in for the in-namespace listener.
    const probeServer = net.createServer();
    const port = await listening(probeServer);
    await new Promise((r) => probeServer.close(r));
    const inner = await tcpToUnix(port, sock);
    return { port, close: () => (outer.close(), inner.close()) };
  }

  test('a reply after the client half-closes still arrives', async () => {
    const server = net.createServer({ allowHalfOpen: true }, (s) => {
      s.on('end', () => setTimeout(() => s.end('reply'), 50));
      s.resume();
    });
    const relay = await chain(await listening(server));
    const got = await new Promise((resolve) => {
      const c = net.connect(relay.port, '127.0.0.1');
      let data = '';
      c.on('data', (d) => (data += d)).on('close', () => resolve(data));
      c.end('req');
    });
    assert.equal(got, 'reply');
    relay.close();
    server.close();
  });

  test('bytes pass unchanged both ways', async () => {
    const echo = net.createServer((s) => s.pipe(s));
    const relay = await chain(await listening(echo));
    const payload = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 256));
    const got = await new Promise((resolve) => {
      const chunks = [];
      const c = net.connect(relay.port, '127.0.0.1', () => c.write(payload));
      c.on('data', (d) => {
        chunks.push(d);
        if (Buffer.concat(chunks).length >= payload.length)
          (c.destroy(), resolve(Buffer.concat(chunks)));
      });
    });
    assert.ok(got.equals(payload));
    relay.close();
    echo.close();
  });

  test('a long-lived stream (SSE) keeps delivering', async () => {
    let tick;
    const sse = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let n = 0;
      tick = setInterval(() => res.write(`data: ${n++}\n\n`), 20);
      req.on('close', () => clearInterval(tick));
    });
    const relay = await chain(await listening(sse));
    const events = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${relay.port}/`, (res) => {
        let text = '';
        res.on('data', (d) => {
          text += d;
          if (text.includes('data: 4')) (res.destroy(), resolve(text));
        });
      });
    });
    assert.match(events, /data: 0\n\ndata: 1/);
    relay.close();
    sse.closeAllConnections();
    sse.close();
  });

  test('a WebSocket upgrade completes and frames flow', async () => {
    const server = http.createServer();
    server.on('upgrade', (req, socket) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
      );
      socket.on('data', (d) => socket.write(Buffer.concat([Buffer.from('echo:'), d])));
      socket.on('end', () => socket.end());
    });
    const relay = await chain(await listening(server));
    const answer = await new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port: relay.port,
        headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
      });
      req.on('upgrade', (res, socket) => {
        assert.equal(res.statusCode, 101);
        socket.write('ping');
        socket.on('data', (d) => (socket.destroy(), resolve(d.toString())));
      });
      req.end();
    });
    assert.equal(answer, 'echo:ping');
    relay.close();
    server.close();
  });

  test('a dead target closes the client instead of hanging', async () => {
    const dead = net.createServer();
    const port = await listening(dead);
    await new Promise((r) => dead.close(r));
    const relay = await chain(port);
    await new Promise((resolve) => {
      const c = net.connect(relay.port, '127.0.0.1');
      c.on('close', resolve).on('error', () => {});
    });
    relay.close();
  });
});
