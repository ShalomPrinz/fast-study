import readline from 'node:readline';

/**
 * Ask one question on the terminal; resolves the trimmed answer.
 * @param {string} question
 * @returns {Promise<string>}
 */
export function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => resolve(String(a).trim()))).finally(() => rl.close());
}

/**
 * Ask repeatedly until `parse(answer)` returns a non-null value, which resolves.
 * `parse` returns null to reject (re-ask); used for "pick a valid number" prompts.
 * @template T
 * @param {string} question
 * @param {(answer: string) => T | null} parse
 * @returns {Promise<T>}
 */
export async function askUntil(question, parse) {
  for (;;) {
    const value = parse(await ask(question));
    if (value != null) return value;
    console.log('Invalid selection.');
  }
}
