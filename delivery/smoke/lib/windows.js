import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { delay } from './wait.js';

/** A PowerShell single-quoted literal. */
export const psq = (value) => `'${String(value).replace(/'/g, "''")}'`;

function spawnPowershell(script, stdio) {
  // -EncodedCommand, so no path or quote in the script ever meets a command-line parser.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { stdio, windowsHide: true },
  );
}

/** Run a PowerShell script to completion and answer its stdout; a non-zero exit throws with stderr. */
export function powershell(script, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnPowershell(`$ErrorActionPreference = 'Stop'\n${script}`, [
      'ignore',
      'pipe',
      'pipe',
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`PowerShell did not finish within ${timeoutMs / 1000}s:\n${script}`));
    }, timeoutMs);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`PowerShell exited ${code}: ${stderr.trim()}\n${script}`));
    });
  });
}

/** Run a program to exit, answering its exit code; `timeoutMs` elapsing throws `onTimeout`. */
export function runToExit(file, args, { timeoutMs, onTimeout, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], env, windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(onTimeout ?? `${file} did not exit within ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

const RULE_GROUP = 'FastStudy smoke';

/** Turn on any disabled firewall profile with both default actions Allow — the traffic policy a
 *  disabled profile already had — so the per-program block rules below are actually evaluated. */
export async function enableFirewall() {
  await powershell(`
Get-NetFirewallProfile | Where-Object { -not $_.Enabled } | ForEach-Object {
  Set-NetFirewallProfile -Name $_.Name -Enabled True -DefaultInboundAction Allow -DefaultOutboundAction Allow
}`);
}

/** One outbound block rule per program path. A path-based rule needs no file behind it yet, which
 *  is what lets the state root's yt-dlp copy be blocked before the server first seeds it. */
export async function blockOutbound(programs) {
  const lines = programs.map(
    (program, i) =>
      `New-NetFirewallRule -Group ${psq(RULE_GROUP)} -DisplayName ${psq(`${RULE_GROUP} ${i}`)} ` +
      `-Direction Outbound -Action Block -Profile Any -Program ${psq(program)} | Out-Null`,
  );
  await powershell(
    `Get-NetFirewallRule -Group ${psq(RULE_GROUP)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule\n` +
      lines.join('\n'),
  );
}

/** Live processes whose executable sits under any of `dirs`, or whose command line carries a
 *  Playwright browser profile — an orphaned headless browser from the auto-downloader's probe. */
export async function strayProcesses(dirs) {
  const prefixes = dirs.map((dir) => psq(path.join(dir, path.sep).toLowerCase())).join(', ');
  const json = await powershell(`
$prefixes = @(${prefixes})
@(Get-CimInstance Win32_Process | Where-Object {
  $exe = "$($_.ExecutablePath)".ToLower()
  ($prefixes | Where-Object { $exe.StartsWith($_) }) -or "$($_.CommandLine)" -like '*playwright_chromiumdev_profile*'
} | Select-Object ProcessId, Name, ExecutablePath) | ConvertTo-Json -Compress`);
  const parsed = json ? JSON.parse(json) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Processes whose image name matches, e.g. the NSIS installer and its uninstall helper. */
export async function processesNamed(patterns) {
  const json = await powershell(`
@(Get-Process | Where-Object { $n = $_.ProcessName; @(${patterns.map(psq).join(', ')}) | Where-Object { $n -like $_ } } |
  Select-Object Id, ProcessName) | ConvertTo-Json -Compress`);
  const parsed = json ? JSON.parse(json) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

export async function stopProcesses(names) {
  await powershell(
    `Stop-Process -Name ${names.map(psq).join(', ')} -Force -ErrorAction SilentlyContinue`,
  ).catch(() => {});
}

export async function productVersion(exe) {
  return powershell(`(Get-Item -LiteralPath ${psq(exe)}).VersionInfo.ProductVersion`);
}

/** Hold `file` open with no sharing at all, as a PDF viewer on Windows can. Answers `release()`. */
export async function holdExclusive(file, { timeoutMs = 30_000 } = {}) {
  const child = spawnPowershell(
    `$ErrorActionPreference = 'Stop'
$h = [System.IO.File]::Open(${psq(file)}, 'Open', 'ReadWrite', 'None')
[Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush()
[void][Console]::In.ReadLine()
$h.Close()`,
    ['pipe', 'pipe', 'pipe'],
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no lock on ${file} within ${timeoutMs}ms`)),
      timeoutMs,
    );
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('LOCKED')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`could not open ${file} exclusively (exit ${code}): ${stderr.trim()}`));
    });
  });
  return {
    release: () =>
      new Promise((resolve) => {
        child.once('exit', resolve);
        child.stdin.end('\n');
      }),
  };
}

/** Rename a directory aside, retrying while a just-killed process still holds a file in it. */
export async function renameAside(dir) {
  const aside = `${dir}.faststudy-smoke`;
  let lastError;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.renameSync(dir, aside);
      return aside;
    } catch (error) {
      lastError = error;
      await delay(1000);
    }
  }
  throw new Error(`could not rename ${dir} aside: ${lastError.message}`);
}
