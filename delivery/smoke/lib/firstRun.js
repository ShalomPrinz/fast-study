import { expect } from '@playwright/test';

// Shaped like real keys, prefix and all, so the field shows no prefix hint and goes straight to the
// probe. Neither can authenticate anywhere, and the firewall keeps the probe from trying.
export const PLACEHOLDER_KEYS = {
  gemini: 'AIzaFastStudySmokePlaceholderKey000000',
  groq: 'gsk_FastStudySmokePlaceholderKey0000000000000000',
};

const key = (page, part, provider) =>
  page.locator(`[data-testid="${part}"][data-provider="${provider}"]`);

const CANCELED = { canceled: true, filePaths: [] };

/** Replace main's `dialog.showOpenDialog` with one answering `answers` in order and recording each
 *  call's options; a call past the queue throws rather than opening a real modal on the runner. */
async function stubFolderDialog(app, answers) {
  await app.evaluate(({ dialog }, queued) => {
    const state = (globalThis.__smokeFolderDialog ??= { original: dialog.showOpenDialog });
    state.calls = [];
    state.answers = queued;
    dialog.showOpenDialog = async (...args) => {
      const options = args.length > 1 ? args[1] : args[0];
      state.calls.push({
        options: JSON.parse(JSON.stringify(options ?? {})),
        parented: args.length > 1 && !!args[0],
      });
      if (!state.answers.length) throw new Error('smoke: a folder dialog no answer was queued for');
      return state.answers.shift();
    };
  }, answers);
  return {
    calls: () => app.evaluate(() => globalThis.__smokeFolderDialog.calls),
    restore: () =>
      app.evaluate(({ dialog }) => {
        dialog.showOpenDialog = globalThis.__smokeFolderDialog.original;
        delete globalThis.__smokeFolderDialog;
      }),
  };
}

/** Click the data-folder field once and wait for exactly the `n`th dialog call, which must open
 *  parented at the field's `current` value as a directory picker. */
async function clickDataRoot(page, dialog, n, current) {
  await page.getByTestId('data-root-input').click();
  await expect
    .poll(async () => (await dialog.calls()).length, {
      message: `click ${n} on the data folder did not open exactly one folder dialog`,
      timeout: 30_000,
    })
    .toBe(n);
  const { options, parented } = (await dialog.calls())[n - 1];
  expect(parented, 'the folder dialog is not modal to the app window').toBe(true);
  expect(options.properties, 'the folder dialog does not pick a folder').toContain('openDirectory');
  expect(options.defaultPath, "the folder dialog does not open at the field's current value").toBe(
    current,
  );
}

/** Fill the init wall — both placeholder keys through their blocked probe, `dataRoot` picked
 *  through the stubbed folder dialog, and the university — and get past it. With `cancelFirst`,
 *  a canceled dialog must first leave the launcher's default in the field. */
export async function completeInitWall({ app, page }, dataRoot, { cancelFirst = false } = {}) {
  await expect(page.getByTestId('init-wall')).toBeVisible({ timeout: 60_000 });
  for (const [provider, value] of Object.entries(PLACEHOLDER_KEYS)) {
    const input = key(page, 'api-key-input', provider);
    await input.fill(value);
    await input.blur();
    const status = key(page, 'api-key-status', provider);
    // `rejected` or `valid` would mean the probe reached the provider through the firewall.
    await expect(status, `${provider} key probe did not end unverified`).toHaveAttribute(
      'data-status',
      'unverified',
      { timeout: 60_000 },
    );
  }
  const field = page.getByTestId('data-root-input');
  const prefilled = await page.evaluate(() => window.faststudy.defaultDataRoot ?? '');
  const dialog = await stubFolderDialog(
    app,
    cancelFirst
      ? [CANCELED, { canceled: false, filePaths: [dataRoot] }]
      : [{ canceled: false, filePaths: [dataRoot] }],
  );
  try {
    let clicks = 0;
    if (cancelFirst) {
      expect(prefilled, 'the bridge offers no default data folder').not.toBe('');
      await expect(
        field,
        "the data folder is not prefilled with the launcher's default",
      ).toHaveValue(prefilled);
      await clickDataRoot(page, dialog, ++clicks, prefilled);
      await expect(field, 'a canceled folder dialog changed the data folder').toHaveValue(
        prefilled,
      );
    }
    await clickDataRoot(page, dialog, ++clicks, prefilled);
    await expect(field, 'the picked folder never reached the data folder field').toHaveValue(
      dataRoot,
    );
    expect((await dialog.calls()).length, 'one click opened more than one folder dialog').toBe(
      clicks,
    );
  } finally {
    // Every launch is a fresh main process, so only a later step in this one could meet the stub.
    await dialog.restore().catch(() => {});
  }
  await page.locator('#moodle-site-select').selectOption('biu');
  // `supported` or `unsupported` would mean the probe reached the site through the firewall.
  await expect(
    page.locator('#moodle-site'),
    'the university probe did not end unverified',
  ).toHaveClass(/(^|\s)moodle-site--unverified(\s|$)/, { timeout: 60_000 });
  const submit = page.getByTestId('init-wall-submit');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId('init-wall')).toHaveCount(0, { timeout: 60_000 });
}
