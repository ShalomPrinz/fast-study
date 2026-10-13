// Chrome's native messaging host `com.faststudy.bridge`: one framed request in, the bridge file (or
// `{ running: false }`) out, exit. Run on FastStudy.exe as node; argv[2] is the bridge file's path.
const fs = require('node:fs');

const bridgeFile = process.argv[2];
let received = Buffer.alloc(0);
let replied = false;

/** The bridge file as written, or `{ running: false }` when the app is not up (or never wrote one). */
function answer() {
  try {
    return JSON.parse(fs.readFileSync(bridgeFile, 'utf8'));
  } catch {
    return { running: false };
  }
}

/** Chrome's framing: a 4-byte little-endian length, then that many bytes of UTF-8 JSON. */
function reply() {
  if (replied) return;
  replied = true;
  const body = Buffer.from(JSON.stringify(answer()), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]), () => process.exit(0));
}

// The request's content is ignored; the host answers once a whole frame has arrived. Chrome keeps
// stdin open until the host exits, so waiting for 'end' alone would hang.
process.stdin.on('data', (chunk) => {
  received = Buffer.concat([received, chunk]);
  if (received.length >= 4 && received.length >= 4 + received.readUInt32LE(0)) reply();
});
process.stdin.on('end', reply);
