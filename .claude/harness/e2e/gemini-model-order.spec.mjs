// The ordered Summary models list: reorder it in Settings, save, and a busy top model falls to the
// next one in the order — the unused model is never called.
import path from 'node:path';
import { BACKEND, DATABASE, PROVIDERS, call, json, saveSettings } from '../lib/api.mjs';
import { test, expect, harness, providers, reseed, reset } from './fixtures.mjs';

const COURSE = 'hb-fail';
const LECTURE = 'שיעור 2'; // transcribed, so Summarize is the next step
const MATCH = `${COURSE}/${LECTURE}`;
const HYDROGEN = 'gemini-4-hydrogen';
const FLASH_38 = 'gemini-3.8-flash';
const FLASH_36 = 'gemini-3.6-flash';

const DEFAULT_ORDER = { gemini_model: HYDROGEN, gemini_fallback_models: [FLASH_38, FLASH_36] };

// AUTO_RUN=full would run a reseeded transcribed lecture before the spec acts.
test.beforeEach(async () => {
  await reseed();
  await saveSettings({ auto_run: 'off', ...DEFAULT_ORDER });
});
test.afterEach(async () => {
  await reset();
});

const rows = (page) => page.locator('#summary-models .summary-model-row');

test('a reordered model list saves, and a busy top model falls to the next one in the order', async ({
  page,
}) => {
  test.setTimeout(100_000);

  await page.goto('/settings');
  const list = page.locator('#summary-models');
  await expect(rows(page)).toHaveCount(3);

  // Hydrogen 4, Flash 3.8, Flash 3.6 -> take Flash 3.8 out, then lift Flash 3.6 over Hydrogen 4.
  await list
    .locator(`.summary-model-row[data-model-id="${FLASH_38}"] .summary-model-remove`)
    .click();
  await expect(list.locator(`.summary-model-add[data-model-id="${FLASH_38}"]`)).toBeVisible();
  await list.locator(`.summary-model-row[data-model-id="${FLASH_36}"] .summary-model-up`).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveAttribute('data-model-id', FLASH_36);
  await page.screenshot({ path: path.join(harness.evidence, 'gemini-model-order-settings.png') });
  // Order changes autosave; the store answering is the proof.
  await expect
    .poll(async () => {
      const { body } = await call(`${DATABASE}/settings`);
      return [body.gemini_model, body.gemini_fallback_models];
    })
    .toEqual([FLASH_36, [HYDROGEN]]);
  await page.reload();
  await expect(rows(page).first()).toHaveAttribute('data-model-id', FLASH_36);
  await expect(rows(page).nth(1)).toHaveAttribute('data-model-id', HYDROGEN);
  await expect(page.locator(`.summary-model-add[data-model-id="${FLASH_38}"]`)).toBeVisible();

  // Flash 3.6 is busy for this lecture; the walk goes to Hydrogen 4 and never to Flash 3.8.
  await providers({ gemini: { mode: '503', match: MATCH, model: FLASH_36 } });
  await page.goto(`/${encodeURIComponent(COURSE)}/${encodeURIComponent(LECTURE)}`);
  const view = page.getByTestId('lecture-view');
  await expect(view.locator('[data-step="summarize"]')).not.toHaveAttribute('data-status', 'done');
  await view.getByRole('button', { name: 'Run Remaining' }).click();

  await expect(view.locator('.page-header-state--done')).toBeVisible({ timeout: 60_000 });
  await expect(view.getByTestId('open-pdf')).toBeVisible();
  await expect(view.getByTestId('lecture-error')).toHaveCount(0);
  // The toast is brief and the run can finish first, so read the notice the backend raised.
  const { body: status } = await json(`${BACKEND}/status`, 'GET');
  const hops = status.notices.filter((n) => n.code === 'model_fallback').map((n) => n.params);
  // Several Gemini calls (summary, extras) each hop; every hop is the one pair.
  expect(hops.length).toBeGreaterThan(0);
  expect(new Set(hops.map((h) => `${h.from}>${h.to}`))).toEqual(
    new Set([`${FLASH_36}>${HYDROGEN}`]),
  );
  const { body } = await json(`${PROVIDERS}/generate-models`, 'GET');
  expect(body.models).toContain(FLASH_36);
  expect(body.models).toContain(HYDROGEN);
  expect(body.models).not.toContain(FLASH_38);
  await page.screenshot({ path: path.join(harness.evidence, 'gemini-model-order-fallback.png') });
});
