import { evidence } from '../../lib/mac.js';
import { checkHebrewTemp } from '../14-hebrew-temp.js';
import { readLaunchLog } from '../../lib/app.js';

// The shared body, then the TMPDIR the app saw and what each tool step made in it — also when it failed.
export default async function hebrewTempMac() {
  const observed = {};
  try {
    await checkHebrewTemp(observed);
  } finally {
    const lines = [
      `TMPDIR the app's main process saw: ${observed.mainSaw ?? 'not reached'}`,
      `TMPDIR the suite set: ${observed.temp ?? 'not reached'}`,
    ];
    for (const [step, entries] of Object.entries(observed.steps ?? {})) {
      const named = [...entries].map((name) => `${observed.temp}/${name}`);
      lines.push(`${step} step made in it: ${named.join(', ') || 'nothing'}`);
    }
    const log = readLaunchLog()
      .split('\n')
      .filter((line) => observed.temp && line.includes(observed.temp));
    lines.push(`launch.log lines naming it: ${log.length ? '\n' + log.join('\n') : 'none'}`);
    evidence('the tools run under a Hebrew temp path', lines.join('\n'));
  }
}
