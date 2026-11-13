import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resultsDir } from './paths.js';

/** Run `file` to its exit, never throwing on a non-zero one: `{ code, stdout, stderr }`. */
export function run(file, args, { timeoutMs = 120_000, env } = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: env ?? process.env },
      (error, stdout, stderr) => {
        const code = error ? (error.killed ? 'timeout' : (error.code ?? 'failed')) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** `run`, as one line of what was run and everything it printed — the shape evidence quotes. */
export async function shown(file, args, options) {
  const { code, stdout, stderr } = await run(file, args, options);
  const text = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  return {
    code,
    text: `$ ${[path.basename(file), ...args].join(' ')}  (exit ${code})\n${text || '(no output)'}`,
  };
}

/** Record what a check observed: printed to the job log, and appended to `mac-evidence.md`, which
 *  the workflow puts in the run summary whatever the outcome. */
export function evidence(title, text) {
  console.log(`\n=== ${title} ===\n${text}\n`);
  fs.mkdirSync(resultsDir(), { recursive: true });
  fs.appendFileSync(
    path.join(resultsDir(), 'mac-evidence.md'),
    `### ${title}\n\n\`\`\`\n${text}\n\`\`\`\n\n`,
  );
}

/** A screenshot of the runner's desktop, for a boot that hangs on a system prompt. */
export async function screenshot(name) {
  const file = path.join(resultsDir(), name);
  fs.mkdirSync(resultsDir(), { recursive: true });
  await run('/usr/sbin/screencapture', ['-x', file], { timeoutMs: 30_000 });
  return file;
}
