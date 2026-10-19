// A first boot stops at the setup wall until both keys and a usable data folder are given, and a saved
// data folder switch re-points the tree at once — judged by the screen, then by the database's settings.
import { DATABASE, call, saveSettings } from '../lib/api.mjs';
import { unwall, wall } from '../lib/baseline.mjs';
import { FAKE_KEYS } from '../lib/env.mjs';
import { test, expect, harness, reseed, reset } from './fixtures.mjs';

test.beforeEach(reseed);
test.afterEach(async () => {
  await unwall(harness);
  await saveSettings({ data_root: harness.data });
  await reset();
});

const courseNames = (page) => page.locator('.course-group .course-header .course-name');

test('the first-run wall takes both keys and a data folder, then opens the app', async ({
  page,
}) => {
  await wall(harness);
  await page.goto('/');
  const wallView = page.getByTestId('init-wall');
  await expect(wallView).toBeVisible();
  await expect(page.locator('.sidebar-nav-block')).toHaveCount(0);

  // A key is probed when the field loses focus; the fake rejects any key containing `bad`.
  const keyInput = (id) => page.locator(`[data-testid="api-key-input"][data-provider="${id}"]`);
  const keyStatus = (id) => page.locator(`[data-testid="api-key-status"][data-provider="${id}"]`);
  await keyInput('groq').fill('gsk_bad_key');
  await keyInput('groq').blur();
  await expect(keyStatus('groq')).toHaveAttribute('data-status', 'rejected');

  await keyInput('groq').fill(FAKE_KEYS.GROQ_API_KEY);
  await keyInput('groq').blur();
  await expect(keyStatus('groq')).toHaveAttribute('data-status', 'valid');
  await keyInput('gemini').fill(FAKE_KEYS.GEMINI_API_KEY);
  await keyInput('gemini').blur();
  await expect(keyStatus('gemini')).toHaveAttribute('data-status', 'valid');

  // The folder probe is debounced: its verdict is the reason line appearing, then going.
  const folder = page.getByTestId('data-root-input');
  const reason = page.locator('#data-root-status');
  const submit = page.getByTestId('init-wall-submit');
  await folder.fill('/no-such-folder/lectures');
  await expect(reason).toBeVisible();
  await expect(submit).toBeDisabled();
  await folder.fill(harness.data);
  await expect(reason).toHaveCount(0);
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(wallView).toHaveCount(0);
  await expect(courseNames(page).filter({ hasText: /^hb-pipeline$/ })).toBeVisible();
  const { body: settings } = await call(`${DATABASE}/settings`);
  expect(settings).toMatchObject({
    data_root: harness.data,
    groq_api_key_set: true,
    gemini_api_key_set: true,
  });
});

test('switching the data folder in settings re-points the tree without a reload', async ({
  page,
}) => {
  await page.goto('/');
  await expect(courseNames(page).filter({ hasText: /^hb-pipeline$/ })).toBeVisible();
  // Settings and Lectures are the sidebar's own rows: client-side navigation, never a reload.
  const switchTo = async (root) => {
    await page.locator('.sidebar-nav-block a[href="/settings"]').click();
    await page.getByTestId('data-root-input').fill(root);
    await page.locator('.page-header-actions .btn--primary').click();
    // The store answering, not the toast: the first save's toast can still be up during the second.
    await expect.poll(async () => (await call(`${DATABASE}/settings`)).body.data_root).toBe(root);
    await page.locator('.sidebar-nav-block button').click();
  };

  await switchTo(harness.dataEmpty);
  await expect(page.locator('.tree-pane-empty:not(.tree-pane-empty--failed)')).toBeVisible();
  await expect(courseNames(page)).toHaveCount(0);

  await switchTo(harness.data);
  await expect(courseNames(page).filter({ hasText: /^hb-pipeline$/ })).toBeVisible();
  await expect(page.locator('.tree-pane-empty')).toHaveCount(0);
});
