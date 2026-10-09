// Preloaded into every test child, so no test reaches the dev's real browser or state: a blocked
// call opens the challenge window, whose launcher fails here unless a test swaps it, and
// disconnect() deletes the window's profile under the state root, which a test file may re-point.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configureChallenge } from '../src/moodle/challenge.js';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autodl-sandbox-'));
process.env.FASTSTUDY_STATE_DIR = stateDir;
process.on('exit', () => fs.rmSync(stateDir, { recursive: true, force: true }));

configureChallenge({
  launch: async () => {
    throw new Error('no real browser in tests');
  },
});
