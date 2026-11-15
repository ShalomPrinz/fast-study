import { evidence } from '../../lib/mac.js';
import * as paths from '../../lib/paths.js';
import { services } from '../../lib/session.js';
import { COURSE, LECTURE } from '../../lib/suite.js';
import { passProviderSteps } from '../05-provider-steps.js';

// The shared body, then each provider step's code and detail and the lecture it leaves for the PDF — also when it failed.
export default async function providers() {
  const observed = {};
  try {
    await passProviderSteps(observed);
  } finally {
    const lines = [];
    for (const [step, { code, detail }] of Object.entries(observed)) {
      lines.push(`${step}: code ${code ?? 'none'}, detail ${JSON.stringify(detail)}`);
    }
    try {
      const present = [];
      for (const file of ['audio.mp3', 'transcript.txt']) {
        if (await services.db.exists(COURSE, LECTURE, file)) present.push(file);
      }
      lines.push(`lecture state in ${paths.dataRoot('data')}: ${present.join(', ') || 'no files'}`);
    } catch (error) {
      lines.push(`lecture state unreadable: ${error.message}`);
    }
    evidence('the provider steps fail on the network', lines.join('\n'), { print: false });
  }
}
