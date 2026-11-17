import fs from 'node:fs';
import { expect } from '@playwright/test';
import { completeInitWall, PLACEHOLDER_KEYS } from '../lib/firstRun.js';
import * as paths from '../lib/paths.js';
import { services, session } from '../lib/session.js';

export default async function firstRun() {
  await passFirstRun({});
}

/** The test body; `observed` fills as it goes, and the stored settings' field names land in it. */
export async function passFirstRun(observed) {
  const root = paths.dataRoot('data');
  await completeInitWall(session, root, { cancelFirst: true, observed });

  const text = fs.readFileSync(paths.settingsFile(), 'utf8');
  const stored = JSON.parse(text);
  observed.settings = Object.keys(stored).sort();
  for (const [provider, key] of Object.entries(PLACEHOLDER_KEYS)) {
    expect(text.includes(key), `the ${provider} key sits in settings.json in the clear`).toBe(
      false,
    );
    const field = stored[`${provider}_api_key`];
    expect(typeof field === 'string' && field.length > 0, `no ${provider} key was stored`).toBe(
      true,
    );
    expect(
      Buffer.from(field, 'base64').includes(Buffer.from(key)),
      `the ${provider} key is only base64-encoded`,
    ).toBe(false);
  }
  expect(stored.data_root).toBe(root);
  await services.db.configured();
}
