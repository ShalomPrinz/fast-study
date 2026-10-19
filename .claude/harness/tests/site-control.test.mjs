import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MODES, createSiteControl } from '../fakes/site-control.mjs';
import { DEFAULT_DOWNLOAD_MS } from '../lib/env.mjs';

const DIE = 'https://lemida.biu.ac.il/die/lecture-08.mp4';

describe('control', () => {
  test('starts ok at the default speed', () => {
    assert.deepEqual(createSiteControl().state, {
      mode: 'ok',
      downloadMs: DEFAULT_DOWNLOAD_MS,
      hold: false,
    });
  });

  test('each field sets only itself', () => {
    const site = createSiteControl();
    assert.deepEqual(site.control({ mode: 'blocked' }), {
      mode: 'blocked',
      downloadMs: DEFAULT_DOWNLOAD_MS,
      hold: false,
    });
    assert.deepEqual(site.control({ downloadMs: 10 }), {
      mode: 'blocked',
      downloadMs: 10,
      hold: false,
    });
    assert.deepEqual(site.control({ hold: true }), { mode: 'blocked', downloadMs: 10, hold: true });
    assert.deepEqual(site.control({}), { mode: 'blocked', downloadMs: 10, hold: true });
  });

  test('every listed mode is accepted', () => {
    const site = createSiteControl();
    for (const mode of MODES) assert.equal(site.control({ mode }).mode, mode);
  });

  test('reset restores the mode, the speed and the drops', () => {
    const site = createSiteControl();
    site.control({ mode: 'invalidtoken', downloadMs: 0, hold: true });
    site.tool(DIE);
    assert.deepEqual(site.control({ reset: true }), {
      mode: 'ok',
      downloadMs: DEFAULT_DOWNLOAD_MS,
      hold: false,
    });
    assert.equal(site.tool(DIE).die, true);
  });

  test('an unknown mode is rejected and leaves the mode', () => {
    const site = createSiteControl();
    assert.throws(() => site.control({ mode: 'teapot' }), /mode: one of ok \| blocked/);
    assert.equal(site.state.mode, 'ok');
  });

  for (const bad of [-1, 'fast', Infinity, NaN]) {
    test(`downloadMs ${String(bad)} is rejected and leaves the speed`, () => {
      const site = createSiteControl();
      assert.throws(() => site.control({ downloadMs: bad }), /downloadMs: ms ≥ 0/);
      assert.equal(site.state.downloadMs, DEFAULT_DOWNLOAD_MS);
    });
  }

  test('downloadMs 0 and a numeric string are accepted', () => {
    const site = createSiteControl();
    assert.equal(site.control({ downloadMs: 0 }).downloadMs, 0);
    assert.equal(site.control({ downloadMs: '250' }).downloadMs, 250);
  });
});

describe('hold', () => {
  test('parks requests until it lifts, then answers each in order', () => {
    const site = createSiteControl();
    const answered = [];
    site.admit(() => answered.push('before'));
    site.control({ hold: true });
    site.admit(() => answered.push('a'));
    site.admit(() => answered.push('b'));
    assert.deepEqual(answered, ['before']);
    assert.equal(site.parked(), 2);
    site.control({ hold: false });
    assert.deepEqual(answered, ['before', 'a', 'b']);
    assert.equal(site.parked(), 0);
  });

  test('reset answers the parked requests too', () => {
    const site = createSiteControl();
    let answered = false;
    site.control({ hold: true });
    site.admit(() => (answered = true));
    site.control({ reset: true });
    assert.equal(answered, true);
  });

  test('a non-boolean hold is rejected and leaves it', () => {
    const site = createSiteControl();
    assert.throws(() => site.control({ hold: 'yes' }), /hold: true \| false/);
    assert.equal(site.state.hold, false);
  });
});

describe('solve', () => {
  test('an armed solve is taken once', () => {
    const site = createSiteControl();
    assert.equal(site.takeSolve(), false);
    site.control({ solve: true });
    assert.equal(site.takeSolve(), true);
    assert.equal(site.takeSolve(), false);
  });

  test('reset disarms it', () => {
    const site = createSiteControl();
    site.control({ solve: true });
    site.control({ reset: true });
    assert.equal(site.takeSolve(), false);
  });
});

describe('tool', () => {
  test('a /die/ URL dies once, then downloads', () => {
    const site = createSiteControl();
    assert.equal(site.tool(DIE).die, true);
    assert.equal(site.tool(DIE).die, false);
  });

  test('each /die/ URL dies once on its own', () => {
    const site = createSiteControl();
    site.tool(DIE);
    assert.equal(site.tool(DIE.replace('08', '09')).die, true);
  });

  test('other URLs never die', () => {
    const site = createSiteControl();
    for (let i = 0; i < 2; i++) {
      assert.equal(site.tool('https://lemida.biu.ac.il/media/lecture-01.mp4').die, false);
    }
  });

  test('answers the live speed', () => {
    const site = createSiteControl();
    site.control({ downloadMs: 42 });
    assert.deepEqual(site.tool(''), { downloadMs: 42, die: false });
  });
});

describe('fault', () => {
  const get = { method: 'GET', range: undefined };

  test('/deny/ refuses every download', () => {
    const site = createSiteControl();
    assert.equal(site.fault('/deny/lecture-07.mp4', get), 'deny');
    assert.equal(site.fault('/deny/lecture-07.mp4', get), 'deny');
  });

  test('/die/ drops the first download per path, until a reset', () => {
    const site = createSiteControl();
    assert.equal(site.fault('/die/lecture-08.mp4', get), 'die');
    assert.equal(site.fault('/die/lecture-08.mp4', get), null);
    assert.equal(site.fault('/die/lecture-09.mp4', get), 'die');
    site.control({ reset: true });
    assert.equal(site.fault('/die/lecture-08.mp4', get), 'die');
  });

  test('a probe never faults, nor spends the one /die/ drop', () => {
    const site = createSiteControl();
    for (const probe of [{ method: 'HEAD' }, { method: 'GET', range: 'bytes=0-0' }]) {
      assert.equal(site.fault('/deny/lecture-07.mp4', probe), null);
      assert.equal(site.fault('/die/lecture-08.mp4', probe), null);
    }
    assert.equal(site.fault('/die/lecture-08.mp4', get), 'die');
  });

  test('other files never fault', () => {
    assert.equal(createSiteControl().fault('/media/lecture-01.mp4', get), null);
  });
});
