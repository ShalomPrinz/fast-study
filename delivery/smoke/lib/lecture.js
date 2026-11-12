import { expect } from '@playwright/test';
import { NETWORK_FAILURE, NOT_A_NETWORK_FAILURE } from './services.js';
import { services } from './session.js';

export const byTestId = (page, id, attributes = {}) =>
  page.locator(
    `[data-testid="${id}"]` +
      Object.entries(attributes)
        .map(([name, value]) => `[data-${name}="${value}"]`)
        .join(''),
  );

export async function openLecture(page, course, lecture) {
  await page.goto(`app://bundle/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}`);
  await expect(byTestId(page, 'lecture-view', { course, lecture, kind: 'lecture' })).toBeVisible();
  await expect(byTestId(page, 'lecture', { course, lecture })).toBeVisible();
}

/** Run one provider step alone and prove it died on the network: not a crash, not an import
 *  error, not a missing key, and the backend still up. Only that step ran, so the error is its own. */
export async function expectNetworkFailure(page, course, lecture, step) {
  const entry = await services.api.runStep(course, lecture, step);
  const error = entry?.message ?? null;
  expect(error, `${step} succeeded, so a provider answered`).not.toBeNull();
  expect(error, `${step} failed, but not on the network`).toMatch(NETWORK_FAILURE);
  expect(error, `${step} failed on something a network block cannot cause`).not.toMatch(
    NOT_A_NETWORK_FAILURE,
  );
  // The provider's own text rides verbatim beneath the translated headline — the one visible text read.
  await expect(page.getByTestId('lecture-error-message')).toContainText(
    entry.params?.detail ?? error,
  );
  await expect(byTestId(page, 'step-status', { step })).toHaveAttribute('data-status', 'failed');
  expect((await services.api.health()).status, 'the backend stopped answering').toBe('ok');
}
