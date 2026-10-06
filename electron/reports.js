const store = require('./store');

// Per service: a down or wedged one must not hold the save, which still succeeds without it.
const CONFIG_TIMEOUT_MS = 2000;
// `window.faststudy.urls` keys of the four services that each hold their own error-reports flag.
const SERVICES = ['database', 'backend', 'autoDownloader', 'downloadServer'];

/** The user's error-reports switch as it applies: only an explicit yes is on, so nothing is sent
 *  before the first-run answer. Read from the store each call, never cached. */
function reportsOn() {
  return store.read().errorReports === true;
}

/** The Sentry half of a child's environment. The flag is `'0'` rather than absent when off, so a
 *  value in main's own env is never inherited past the switch. */
function sentryEnv(dsn) {
  return { FASTSTUDY_SENTRY_DSN: dsn, FASTSTUDY_ERROR_REPORTS: reportsOn() ? '1' : '0' };
}

/** POST `{"error_reports": on}` to every service's `/config` in parallel; resolves the names of
 *  the ones that did not take it — not running, refused, or slower than the timeout. */
async function pushReports(urls, secret, on, timeoutMs = CONFIG_TIMEOUT_MS) {
  const results = await Promise.all(
    SERVICES.map(async (name) => {
      if (!urls[name]) return `${name} (not running)`;
      try {
        const response = await fetch(`${urls[name]}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-FastStudy-Secret': secret },
          body: JSON.stringify({ error_reports: on }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        return response.ok ? null : `${name} (${response.status})`;
      } catch (error) {
        return `${name} (${error.name === 'TimeoutError' ? 'timed out' : error.message})`;
      }
    }),
  );
  return results.filter(Boolean);
}

// Every write runs after the one before it, so two quick toggles reach the services in order.
let chain = Promise.resolve();

/** `faststudy:settings-write`: the store write, then — when the patch carries the switch — main's
 *  own flag and every service's. A service that misses it never fails the save; the result's
 *  `errorReportsRestartNeeded` tells the renderer the switch is whole only after a restart. */
function writeSettings(patch, { urls, secret, setReporting, log }) {
  const run = chain.then(async () => {
    const view = store.write(patch);
    if (typeof patch?.errorReports !== 'boolean') {
      return { ...view, errorReportsRestartNeeded: false };
    }
    const on = view.errorReports === true;
    setReporting(on);
    const missed = await pushReports(urls, secret, on);
    log(
      'main',
      `error reports ${on ? 'on' : 'off'}${missed.length ? ` — not applied in ${missed.join(', ')} until restart` : ''}`,
    );
    return { ...view, errorReportsRestartNeeded: missed.length > 0 };
  });
  chain = run.catch(() => {});
  return run;
}

module.exports = { pushReports, reportsOn, sentryEnv, writeSettings };
