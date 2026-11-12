import { bridge, launch, quit, waitForApp } from './app.js';
import { backend, database, downloader } from './services.js';

// Read by importers as live bindings, which they cannot assign: only the functions here change them.
export let session = null;
export let services = null;

/** Launch, wait for the four services, and bind the service clients to this launch's bridge. */
export async function start(env) {
  session = await launch(env);
  await waitForApp(session);
  await bind();
  return session;
}

/** Bind the service clients to the bridge the current page reads, which a restart's reload renews. */
export async function bind() {
  const reached = await bridge(session.page);
  services = {
    urls: reached.urls,
    secret: reached.secret,
    db: database(reached),
    api: backend(reached),
    dl: downloader(reached),
  };
}

export async function stop() {
  const closing = session;
  session = null;
  services = null;
  if (closing) await quit(closing);
}

/** Drop the launch without quitting it, for a main that is already dead or being abandoned. */
export function forget() {
  session = null;
  services = null;
}
