// Windows only: keeps a parked Chrome window off the taskbar and out of Alt+Tab with the Win32
// tool-window style, applied from outside by one powershell.exe spawn per change. Best-effort, never
// fails a call. See docs/SESSIONS.md § Off the taskbar (Windows).
import { execFile } from 'node:child_process';
import { toolPath, NO_WINDOW } from '@faststudy/tools';

/** The switch both launches carry, so the helper finds the window by command line. */
export const windowMarker = (name) => `--faststudy-window=${name}`;

/** The PowerShell text that sets (`tool` true) or clears the tool style on the windows carrying `marker`. */
export function styleScript(marker, tool) {
  const literal = String(marker).replaceAll("'", "''");
  return `$ErrorActionPreference = 'Stop'
$marker = '${literal}'
$tool = $${tool ? 'true' : 'false'}
$asm = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object Reflection.AssemblyName 'FsWin'), [Reflection.Emit.AssemblyBuilderAccess]::Run)
$tb = $asm.DefineDynamicModule('FsWin').DefineType('FsWin', 'Public,Class')
function Def($name, $entry, $ret, [Type[]]$params) {
  $mb = $tb.DefinePInvokeMethod($name, 'user32.dll', $entry, 'Public,Static,PinvokeImpl', 'Standard', $ret, $params, 'Winapi', 'Unicode')
  $mb.SetImplementationFlags($mb.GetMethodImplementationFlags() -bor [Reflection.MethodImplAttributes]::PreserveSig)
}
Def 'FindWindowEx' 'FindWindowExW' ([IntPtr]) @([IntPtr], [IntPtr], [string], [string])
Def 'GetWindowThreadProcessId' 'GetWindowThreadProcessId' ([uint32]) @([IntPtr], [uint32].MakeByRefType())
Def 'IsWindowVisible' 'IsWindowVisible' ([bool]) @([IntPtr])
Def 'GetWindowTextLength' 'GetWindowTextLengthW' ([int]) @([IntPtr])
Def 'GetWindow' 'GetWindow' ([IntPtr]) @([IntPtr], [uint32])
Def 'ShowWindow' 'ShowWindow' ([bool]) @([IntPtr], [int])
Def 'GetLongPtr' 'GetWindowLongPtrW' ([IntPtr]) @([IntPtr], [int])
Def 'SetLongPtr' 'SetWindowLongPtrW' ([IntPtr]) @([IntPtr], [int], [IntPtr])
Def 'GetLong' 'GetWindowLongW' ([int]) @([IntPtr], [int])
Def 'SetLong' 'SetWindowLongW' ([int]) @([IntPtr], [int], [int])
$u = $tb.CreateType()
$pids = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$marker*" } | ForEach-Object { [uint32]$_.ProcessId })
$wide = [IntPtr]::Size -eq 8
$count = 0
$styles = @()
$h = [IntPtr]::Zero
$found = @()
while ($true) {
  # [NullString]::Value is a real null; a PS $null would become "" and match only untitled windows
  $h = $u::FindWindowEx([IntPtr]::Zero, $h, 'Chrome_WidgetWin_1', [NullString]::Value)
  if ($h -eq [IntPtr]::Zero) { break }
  $owner = [uint32]0
  [void]$u::GetWindowThreadProcessId($h, [ref]$owner)
  if ($pids -notcontains $owner -or -not $u::IsWindowVisible($h)) { continue }
  if ($u::GetWindowTextLength($h) -eq 0 -or $u::GetWindow($h, 4) -ne [IntPtr]::Zero) { continue }
  $found += $h
}
foreach ($h in $found) {
  if ($wide) { $ex = $u::GetLongPtr($h, -20).ToInt64() } else { $ex = [int64]$u::GetLong($h, -20) }
  if ($tool) { $next = ($ex -bor 0x80) -band (-bnot 0x40000) } else { $next = $ex -band (-bnot 0x80) }
  if ($next -ne $ex) {
    if ($wide) { [void]$u::SetLongPtr($h, -20, [IntPtr]$next) } else { [void]$u::SetLong($h, -20, [int]$next) }
    [void]$u::ShowWindow($h, 0)
    [void]$u::ShowWindow($h, 4)
  }
  $count++
  $styles += '"0x' + $next.ToString('x8') + '"'
}
Write-Output ('{"windows":' + $count + ',"exstyle":[' + ($styles -join ',') + ']}')
if ($count -eq 0) { exit ${NO_WINDOW_EXIT} }
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
