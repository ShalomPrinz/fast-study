// Windows only: keeps a parked Chrome window off the taskbar and out of Alt+Tab with the Win32
// tool-window style, applied from outside by one powershell.exe spawn per change. Best-effort, never
// fails a call. See docs/SESSIONS.md § Off the taskbar (Windows).
import { execFile } from 'node:child_process';
import { toolPath, NO_WINDOW } from '@faststudy/tools';

/** The switch both launches carry, so the helper finds the window by command line. */
export const windowMarker = (name) => `--faststudy-window=${name}`;

// $tool = $true sets WS_EX_TOOLWINDOW and clears WS_EX_APPWINDOW; $false clears the tool bit only.
// A changed style is followed by SW_HIDE, SW_SHOWNOACTIVATE so the shell rereads it. Chrome's
// invisible helper windows of the same class are skipped: visible, titled, unowned only.
const CSHARP = `using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class FsWin {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetLongPtr(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetLong(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint="SetWindowLongW")] static extern int SetLong(IntPtr h, int i, int v);
  const int GWL_EXSTYLE = -20;
  const long TOOL = 0x80;
  const long APP = 0x40000;
  public static int Count;
  static long Get(IntPtr h) { return IntPtr.Size == 8 ? GetLongPtr(h, GWL_EXSTYLE).ToInt64() : GetLong(h, GWL_EXSTYLE); }
  static void Set(IntPtr h, long v) { if (IntPtr.Size == 8) SetLongPtr(h, GWL_EXSTYLE, new IntPtr(v)); else SetLong(h, GWL_EXSTYLE, (int)v); }
  public static string Apply(uint[] pids, bool tool) {
    var want = new HashSet<uint>(pids);
    var styles = new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!want.Contains(pid) || !IsWindowVisible(h)) return true;
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      if (cls.ToString() != "Chrome_WidgetWin_1" || GetWindowTextLength(h) == 0 || GetWindow(h, 4) != IntPtr.Zero) return true;
      long ex = Get(h);
      long next = tool ? ((ex | TOOL) & ~APP) : (ex & ~TOOL);
      if (next != ex) { Set(h, next); ShowWindow(h, 0); ShowWindow(h, 4); }
      Count++;
      styles.Add("\\"0x" + next.ToString("x8") + "\\"");
      return true;
    }, IntPtr.Zero);
    return "{\\"windows\\":" + Count + ",\\"exstyle\\":[" + string.Join(",", styles.ToArray()) + "]}";
  }
}`;

/** The PowerShell text that sets (`tool` true) or clears the tool style on the windows carrying `marker`. */
export function styleScript(marker, tool) {
  const literal = String(marker).replaceAll("'", "''");
  return `$ErrorActionPreference = 'Stop'
$marker = '${literal}'
$tool = $${tool ? 'true' : 'false'}
Add-Type -TypeDefinition @'
${CSHARP}
'@
$pids = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$marker*" } | ForEach-Object { [uint32]$_.ProcessId })
[FsWin]::Apply($pids, $tool)
if ([FsWin]::Count -eq 0) { exit ${NO_WINDOW_EXIT} }
`;
}

const NO_WINDOW_EXIT = 3;
const TIMEOUT_MS = 15_000;

/** The spawn for `script`. NO_WINDOW is mandatory: packaged, a bare spawn from a GUI process opens a console. */
export function powershellCommand(script) {
  return {
    file: toolPath('powershell'),
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    options: { timeout: TIMEOUT_MS, ...NO_WINDOW },
  };
}

// Rejects with a reason that never carries the command line (execFile's own message does).
function spawnRun(script) {
  const { file, args, options } = powershellCommand(script);
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout) => {
      if (!err) return resolve(stdout);
      if (err.killed) return reject(new Error('timed out'));
      reject(new Error(err.code === NO_WINDOW_EXIT ? 'no window found' : `exit ${err.code}`));
    });
  });
}

const deps = { platform: process.platform, run: spawnRun };

/** Tests swap the platform and the spawn; → a function restoring the previous ones. */
export function configureWindowStyle(overrides) {
  const prev = { ...deps };
  Object.assign(deps, overrides);
  return () => Object.assign(deps, prev);
}

/**
 * `{ hide(), show() }` for one browser instance's window (a new window is unstyled, so a relaunch
 * needs a fresh styler): hide sets the tool style, show clears it. Each promise resolves once the
 * wanted state is applied or a later call superseded it, and never rejects.
 */
export function windowStyler(name) {
  const marker = windowMarker(name);
  let applied = false;
  let desired = false;
  let draining = false;
  let warned = false;
  let waiting = [];

  // Runs one change at a time until applied meets desired; calls made meanwhile collapse to the latest.
  async function drain() {
    draining = true;
    while (applied !== desired) {
      const target = desired;
      try {
        const out = await deps.run(styleScript(marker, target));
        if (typeof out === 'string' && out.trim()) console.log(`[window] ${name} ${out.trim()}`);
      } catch (err) {
        // A failed run counts as applied, so a broken PowerShell cannot loop.
        if (!warned) console.warn(`[window] ${name} style not applied: ${err?.message ?? err}`);
        warned = true;
      }
      applied = target;
      const keep = [];
      for (const w of waiting) {
        if (w.want === desired && applied !== desired) keep.push(w);
        else w.resolve();
      }
      waiting = keep;
    }
    // Same tick as the loop's last check, so a request arriving later starts a new drain.
    draining = false;
  }

  function request(want) {
    if (deps.platform !== 'win32') return Promise.resolve();
    desired = want;
    if (!draining && applied === want) return Promise.resolve();
    const promise = new Promise((resolve) => waiting.push({ want, resolve }));
    if (!draining) void drain();
    return promise;
  }

  return { hide: () => request(true), show: () => request(false) };
}
