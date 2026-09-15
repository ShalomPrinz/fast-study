import { expect } from '@playwright/test';

// Shaped like real keys, prefix and all, so the field shows no prefix hint and goes straight to the
// probe. Neither can authenticate anywhere, and the firewall keeps the probe from trying.
export const PLACEHOLDER_KEYS = {
  gemini: 'AIzaFastStudySmokePlaceholderKey000000',
  groq: 'gsk_FastStudySmokePlaceholderKey0000000000000000',
};

const key = (page, part, provider) =>
  page.locator(`[data-testid="${part}"][data-provider="${provider}"]`);

/** Fill the init wall — both placeholder keys through their blocked probe, and `dataRoot` — and
 *  get past it. */
export async function completeInitWall(page, dataRoot) {
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
  await page.getByTestId('data-root-input').fill(dataRoot);
  await page.getByTestId('data-root-confirm').check();
  const submit = page.getByTestId('init-wall-submit');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId('init-wall')).toHaveCount(0, { timeout: 60_000 });
}
