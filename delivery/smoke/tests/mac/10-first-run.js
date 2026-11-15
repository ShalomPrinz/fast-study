import { evidence } from '../../lib/mac.js';
import { passFirstRun } from '../04-first-run.js';

// The shared body, then what it observed as evidence — also when it failed, which is when it matters.
export default async function firstRun() {
  const observed = {};
  try {
    await passFirstRun(observed);
  } finally {
    const lines = [`init wall: ${observed.wall ?? 'never shown'}`];
    for (const [probe, result] of Object.entries(observed.probes ?? {})) {
      lines.push(`${probe} probe: ${result} (blocked offline, as expected)`);
    }
    if (observed.privacy) lines.push(`privacy policy: ${observed.privacy}`);
    if (observed.settings) lines.push(`settings.json fields: ${JSON.stringify(observed.settings)}`);
    evidence('7. first run', lines.join('\n'), { print: false });
  }
}
