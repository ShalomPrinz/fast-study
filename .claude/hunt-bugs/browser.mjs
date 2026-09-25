#!/usr/bin/env node
// One long-running headless browser on the app, driven over HTTP on 127.0.0.1, so a flow agent
// keeps one page across many curl calls. It records what the page did as it goes: console
// messages, page errors, failed and 4xx/5xx requests, every API request, and each non-GET request
// with its body and answer — the last also appended to `<harness>/evidence/<tag>-mutations.jsonl`.
//
//   node .claude/hunt-bugs/browser.mjs --port N --tag T [--harness DIR]   (or HUNT_BUGS_HARNESS)
//
// Arguments ride as a JSON body or as query parameters, and the method does not matter:
// /goto {"url"}                 a path on the app, or a full URL
// /click {"selector"}           then the mouse leaves the page, so no tooltip covers the next
// /fill {"selector","value"}
// /text {"selector"}            innerText; the whole body when no selector
// /screenshot {"name","full"}   saved as <harness>/evidence/<tag>-<name>.png
// /eval <js>                    raw body: an async function body given `page` and `context`
// /log {"since"}                every recorded event from N on, numbered
// /mutations                    every non-GET request so far
// /health
//
// Each command answers its result, then any console error, page error or failed request that
// happened while it ran, so a click's fallout arrives with the click.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { APP, openBrowser } from './lib/browser.mjs';
import { harnessPaths } from './lib/env.mjs';

const args = process.argv.slice(2);
const value = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const port = Number(value('--port'));
const tag = value('--tag');
const root = value('--harness') ?? process.env.HUNT_BUGS_HARNESS;
if (!port || !tag || !root) {
  console.error('usage: browser.mjs --port N --tag T [--harness DIR]  (or HUNT_BUGS_HARNESS=DIR)');
  process.exit(2);
}
const paths = harnessPaths(path.resolve(root));
fs.mkdirSync(paths.evidence, { recursive: true });
const mutationsFile = path.join(paths.evidence, `${tag}-mutations.jsonl`);

const { browser, context, page } = await openBrowser();
// A throw inside an event handler must cost one record, not the session.
process.on('unhandledRejection', (error) =>
  console.log(`${new Date().toISOString()} harness ${error}`),
);

const events = [];
const mutations = [];
// `loud` events echo into the answer of the command that was running; the rest wait for /log.
function record(kind, text, loud) {
  const event = { n: events.length, time: new Date().toISOString(), kind, text, loud };
  events.push(event);
  console.log(`${event.time} ${kind} ${text}`);
}

page.on('console', (message) => {
  const type = message.type();
  record(`console.${type}`, message.text(), type === 'error' || type === 'warning');
});
page.on('pageerror', (error) => record('pageerror', error.message, true));
page.on('dialog', (dialog) => {
  record('dialog', `${dialog.type()}: ${dialog.message()} (dismissed)`, true);
  dialog.dismiss().catch(() => {});
});
// Chromium also fails a request whose body load is cut off after it was answered; that one is
// already recorded by its response, so it is noted quietly.
page.on('requestfailed', async (request) => {
  const line = `${request.method()} ${request.url()} ${request.failure()?.errorText}`;
  const answered = await request.response().catch(() => null);
  if (answered) return record('aborted', `${line} after ${answered.status()}`, false);
  record('failed', line, true);
  if (mutating(request)) saveMutation(request, null, request.failure()?.errorText);
});
// Vite's module and asset loads would bury the app's own traffic, so only API-shaped requests.
const API_TYPES = new Set(['fetch', 'xhr', 'eventsource', 'document']);
page.on('response', async (response) => {
  const request = response.request();
  const status = response.status();
  if (status >= 400) record('http', `${status} ${request.method()} ${request.url()}`, true);
  else if (API_TYPES.has(request.resourceType()))
    record('request', `${status} ${request.method()} ${request.url()}`, false);
  if (mutating(request)) saveMutation(request, response);
});

function mutating(request) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(request.method());
}

async function saveMutation(request, response, error) {
  const sent = request.postDataBuffer();
  const entry = {
    time: new Date().toISOString(),
    method: request.method(),
    url: decodeURI(request.url()),
    status: response?.status() ?? null,
    // A video upload is megabytes of binary; its size says enough.
    body:
      sent && sent.length <= 4000 ? sent.toString('utf8') : sent ? `<${sent.length} bytes>` : null,
    answer: response ? (await response.text().catch(() => '')).slice(0, 2000) : null,
    error: error ?? undefined,
  };
  mutations.push(entry);
  fs.appendFileSync(mutationsFile, `${JSON.stringify(entry)}\n`);
}

// A short settle after an action, so an error the action causes arrives in its own answer.
const settle = () => sleep(500);

function evidenceName(name) {
  const safe = String(name ?? Date.now()).replace(/[^\p{L}\p{N}._-]+/gu, '-');
  return path.join(paths.evidence, `${tag}-${safe}.png`);
}

const AsyncFunction = (async () => {}).constructor;

const COMMANDS = {
  '/goto': async ({ url }) => {
    const response = await page.goto(new URL(url ?? '/', APP).href);
    await settle();
    return `${response?.status()} ${page.url()}`;
  },
  '/click': async ({ selector }) => {
    await page.click(selector);
    await page.mouse.move(-1, -1);
    await settle();
    return `clicked ${selector}`;
  },
  '/fill': async ({ selector, value: text }) => {
    await page.fill(selector, text ?? '');
    await settle();
    return `filled ${selector}`;
  },
  '/text': async ({ selector }) =>
    (
      await page
        .locator(selector ?? 'body')
        .first()
        .innerText()
    ).replace(/\n{2,}/g, '\n'),
  '/screenshot': async ({ name, full }) => {
    const file = evidenceName(name);
    await page.screenshot({ path: file, fullPage: full === true || full === 'true' });
    return file;
  },
  '/eval': async (_, raw) => {
    const result = await new AsyncFunction('page', 'context', raw)(page, context);
    return result === undefined || typeof result === 'string'
      ? (result ?? 'ok')
      : JSON.stringify(result, null, 1);
  },
  '/log': async ({ since }) =>
    events
      .slice(Number(since ?? 0))
      .map((event) => `${event.n} ${event.time} ${event.kind} ${event.text}`)
      .join('\n'),
  '/mutations': async () => mutations.map((entry) => JSON.stringify(entry)).join('\n'),
  '/health': async () => JSON.stringify({ status: 'ok', tag, url: page.url() }),
};

http
  .createServer(async (request, response) => {
    const url = new URL(request.url, 'http://browser');
    const command = COMMANDS[url.pathname];
    let raw = '';
    for await (const chunk of request) raw += chunk;
    if (!command) {
      response
        .writeHead(404)
        .end(`unknown command ${url.pathname}: ${Object.keys(COMMANDS).join(' ')}\n`);
      return;
    }
    const from = events.length;
    let status = 200;
    let out;
    try {
      const body = url.pathname === '/eval' || !raw ? {} : JSON.parse(raw);
      out = await command({ ...Object.fromEntries(url.searchParams), ...body }, raw);
    } catch (error) {
      status = 500;
      out = `error: ${error.message}`;
    }
    const fallout = events.slice(from).filter((event) => event.loud);
    if (fallout.length && url.pathname !== '/log')
      out += `\n--- console/http ---\n${fallout.map((event) => `${event.kind} ${event.text}`).join('\n')}`;
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(`${out}\n`);
  })
  .listen(port, '127.0.0.1', () => console.log(`browser ${tag} on :${port}, app ${APP}`));

// Closing the browser ourselves: SIGKILL on this process would leave chromium orphaned.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await browser.close().catch(() => {});
    process.exit(0);
  });
}
