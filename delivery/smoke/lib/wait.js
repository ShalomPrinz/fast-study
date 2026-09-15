export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `probe` until it answers truthy, answering that value. `message` names what never happened,
 *  and may be a function so it can report state gathered while waiting. */
export async function waitFor(probe, { timeoutMs, intervalMs = 1000, message }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(typeof message === 'function' ? message() : message);
    await delay(intervalMs);
  }
}
