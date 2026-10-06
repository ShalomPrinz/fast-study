// The token file, encrypted at rest when the launcher sets FASTSTUDY_TOKEN_KEY (standard base64 of
// 32 bytes); unset means plaintext, which is dev. Envelope: { v:1, iv, tag, data } (AES-256-GCM).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 1;

// The key, null when unset; a set-but-malformed key throws rather than silently writing plaintext.
function tokenKey() {
  const raw = process.env.FASTSTUDY_TOKEN_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('FASTSTUDY_TOKEN_KEY must be the base64 of 32 bytes');
  return key;
}

function seal(record, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
}

function open(envelope, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString('utf8'));
}

/** Write the record, encrypted when a key is set. */
export function writeTokenFile(file, record) {
  const key = tokenKey();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, key ? seal(record, key) : JSON.stringify(record), { mode: 0o600 });
}

/**
 * The record, or null when the file is absent or unreadable (wrong key, corrupt, tampered, or
 * encrypted with no key set). A legacy plaintext file is read and, when a key is set, rewritten encrypted.
 */
export function readTokenFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed?.v === VERSION && parsed.data) {
      const key = tokenKey();
      return key ? open(parsed, key) : null;
    }
    if (tokenKey()) writeTokenFile(file, parsed);
    return parsed;
  } catch {
    return null;
  }
}
