// The Windows tool-window styler: one spawn per change, collapsing, never rejecting, a no-op elsewhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolPath } from '@faststudy/tools';
import {
  windowMarker,
  styleScript,
  windowStyler,
  powershellCommand,
  configureWindowStyle,
} from '../src/browser/windowStyle.js';

const isOn = (script) => /\$tool = \$true/.test(script);
const tick = () => new Promise((r) => setImmediate(r));

// A run the test finishes by hand: `runs` records each script, `finish(i)` ends the i-th.
function manualRun(t, platform = 'win32') {
  const runs = [];
  const done = [];
  t.after(
    configureWindowStyle({
      platform,
      run: (script) => {
        runs.push(isOn(script));
        return new Promise((resolve, reject) => done.push({ resolve, reject }));
      },
    }),
  );
  return { runs, finish: (i, err) => (err ? done[i].reject(err) : done[i].resolve('')) };
}

test('hide makes one run with the tool flag on', async (t) => {
  const { runs, finish } = manualRun(t);
  const p = windowStyler('zoom').hide();
  await tick();
  assert.deepEqual(runs, [true]);
  finish(0);
  await p;
});

test('show on a never-styled window makes no run', async (t) => {
  const { runs } = manualRun(t);
  await windowStyler('zoom').show();
  assert.deepEqual(runs, []);
});

test('hide then show: two runs, in order, never overlapping', async (t) => {
  const { runs, finish } = manualRun(t);
  const s = windowStyler('zoom');
  const a = s.hide();
  const b = s.show();
  await tick();
  assert.deepEqual(runs, [true], 'the second waits for the first');
  finish(0);
  await a;
  await tick();
  assert.deepEqual(runs, [true, false]);
  finish(1);
  await b;
});

test('calls made while a run is in flight collapse to the latest state', async (t) => {
  const { runs, finish } = manualRun(t);
  const s = windowStyler('zoom');
  const first = s.hide();
  await tick();
  const rest = [s.show(), s.hide(), s.show()];
  finish(0);
  await first;
  await tick();
  assert.deepEqual(runs, [true, false], 'one more run, the last wish');
  finish(1);
  await Promise.all(rest);
  assert.deepEqual(runs, [true, false]);
});

test('a request arriving as the drain loop ends still runs', async (t) => {
  const { runs, finish } = manualRun(t);
  const s = windowStyler('zoom');
  const first = s.hide();
  await tick();
  finish(0);
  // The run settled; its continuation has not run yet when the next request lands.
  const second = s.show();
  await first;
  await tick();
  assert.deepEqual(runs, [true, false]);
  finish(1);
  await second;
});

test('a rejecting run resolves, warns once, and the next request still runs', async (t) => {
  const { runs, finish } = manualRun(t);
  const warn = t.mock.method(console, 'warn', () => {});
  const s = windowStyler('challenge');
  const a = s.hide();
  await tick();
  finish(0, new Error('exit 1'));
  await a;
  const b = s.show();
  await tick();
  finish(1, new Error('timed out'));
  await b;
  const c = s.hide();
  await tick();
  assert.deepEqual(runs, [true, false, true]);
  finish(2);
  await c;
  assert.equal(warn.mock.calls.length, 1);
  assert.match(warn.mock.calls[0].arguments[0], /^\[window\] challenge .*exit 1/);
});

test('off Windows nothing is spawned', async (t) => {
  const { runs } = manualRun(t, 'linux');
  const s = windowStyler('zoom');
  await s.hide();
  await s.show();
  assert.deepEqual(runs, []);
});

test('the script embeds the marker, both style bits and the hide/show pair, and prints no command line', () => {
  const marker = windowMarker('zoom');
  assert.equal(marker, '--faststudy-window=zoom');
  const on = styleScript(marker, true);
  assert.match(on, /\$marker = '--faststudy-window=zoom'/);
  assert.match(on, /\$tool = \$true/);
  assert.match(styleScript(marker, false), /\$tool = \$false/);
  assert.match(on, /0x80\b/);
  assert.match(on, /0x40000\b/);
  assert.match(on, /ShowWindow\(\$h, 0\)[\s\S]*ShowWindow\(\$h, 4\)/);
  assert.match(on, /DefinePInvokeMethod/);
  assert.match(on, /FindWindowEx/);
  assert.match(on, /\[NullString\]::Value/);
  assert.match(on, /PreserveSig/);
  assert.equal(on.match(/CommandLine/g).length, 1, 'only the filter reads it');
  assert.match(on, /\$_\.CommandLine -like/);
});

test('the script never compiles C#, which would write into %TEMP%', () => {
  for (const tool of [true, false]) {
    const script = styleScript('--faststudy-window=zoom', tool);
    assert.doesNotMatch(script, /Add-Type|TypeDefinition/);
  }
});

test('the real spawn is toolPath("powershell") with windowsHide pinned true', () => {
  const { file, args, options } = powershellCommand('Write-Output 1');
  assert.equal(file, toolPath('powershell'));
  assert.equal(options.windowsHide, true);
  assert.ok(options.timeout > 0);
  assert.equal(args.at(-2), '-EncodedCommand');
  assert.equal(Buffer.from(args.at(-1), 'base64').toString('utf16le'), 'Write-Output 1');
});
