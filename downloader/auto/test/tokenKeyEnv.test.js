import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const holder = fileURLToPath(new URL('../src/auth/tokenKey.js', import.meta.url));
const store = fileURLToPath(new URL('../src/auth/tokenStore.js', import.meta.url));

test('the token key leaves the env for children but stays usable in memory', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const code = `await import(${JSON.stringify(holder)});
    const { writeTokenFile, readTokenFile } = await import(${JSON.stringify(store)});
    const { execFileSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tk-')), 't.json');
    writeTokenFile(file, { site: 's', wstoken: 'w', privatetoken: null, userid: 1 });
    const sealed = !fs.readFileSync(file, 'utf8').includes('"wstoken"');
    const back = readTokenFile(file)?.wstoken;
    const child = execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.env.FASTSTUDY_TOKEN_KEY))']).toString();
    process.stdout.write(JSON.stringify({ sealed, back, child }));`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, FASTSTUDY_TOKEN_KEY: key },
  }).toString();
  assert.deepEqual(JSON.parse(out), { sealed: true, back: 'w', child: 'undefined' });
});
