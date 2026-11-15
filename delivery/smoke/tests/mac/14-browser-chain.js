import { evidence } from '../../lib/mac.js';
import { passBrowserChain } from '../15-browser-chain.js';

// The shared body, then what each leg saw — also when one failed. Browsers are put back by its finally.
export default async function browserChainMac() {
  const observed = {};
  try {
    await passBrowserChain(observed);
  } finally {
    const lines = Object.entries(observed).map(([leg, seen]) => `${leg}: ${seen}`);
    evidence('the browser chain', lines.join('\n') || 'no leg completed');
  }
}
