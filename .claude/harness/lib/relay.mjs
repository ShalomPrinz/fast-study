// Byte-for-byte TCP <-> Unix-socket relays, the two halves of the browser's network-namespace bridge.
// A socket file is reachable across network namespaces; a loopback port is not.
import fs from 'node:fs';
import net from 'node:net';

// A FIN passes through as a half-close so a late reply survives; close or error destroys both.
function pipe(a, b) {
  a.pipe(b);
  b.pipe(a);
  const end = () => {
    a.destroy();
    b.destroy();
  };
  a.on('error', end).on('close', end);
  b.on('error', end).on('close', end);
}

function listen(server, where) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(where, () => resolve(server));
  });
}

/** Accept on a Unix socket and connect each client to `127.0.0.1:port` (the launching side). */
export async function unixToTcp(socketPath, port) {
  fs.rmSync(socketPath, { force: true });
  const server = net.createServer({ allowHalfOpen: true }, (client) => {
    pipe(client, net.connect({ host: '127.0.0.1', port, allowHalfOpen: true }));
  });
  return listen(server, socketPath);
}

/** Accept on `127.0.0.1:port` and connect each client to a Unix socket (the browser's side). */
export async function tcpToUnix(port, socketPath) {
  const server = net.createServer({ allowHalfOpen: true }, (client) => {
    pipe(client, net.connect({ path: socketPath, allowHalfOpen: true }));
  });
  return listen(server, { host: '127.0.0.1', port });
}
