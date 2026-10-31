#!/usr/bin/env node
// Helpers run against a live harness. Each subcommand is one entry in COMMANDS; add one
// there and `hb help` lists it.
//
//   node .claude/harness/hb.mjs [--harness DIR] <command> [args…]   (or HARNESS_DIR=DIR)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ACTIONS, actionRequest } from './lib/act.mjs';
import { DATABASE, bindPorts, bytes, call, fireRetries, saveSettings } from './lib/api.mjs';
import { markSeeded, removeLecture, reseed, settingsPatch, unwall, wall } from './lib/baseline.mjs';
import { serveBefore } from './lib/before.mjs';
import { HARNESS_ROOT, SELFCHECK_TAG, harnessPaths, readPorts } from './lib/env.mjs';
import { holdMoodle, releaseMoodle } from './lib/moodle-busy.mjs';
import { kill, restart, startBrowser } from './lib/stack.mjs';
import { diff, readLocks, snapshot } from './lib/state.mjs';

// A lecture argument: `name`, or `Recitations/name` for a recitation, as the on-disk path reads.
function lectureArg(text) {
  const recitation = text?.startsWith('Recitations/');
  return {
    lecture: recitation ? text.slice('Recitations/'.length) : text,
    kind: recitation ? 'recitation' : 'lecture',
  };
}

// Splits `--filename name` out of the arguments; the rest are positional.
function fileArgs(args) {
  const positional = [];
  let filename;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--filename') {
      if (i + 1 >= args.length) throw new Error('--filename needs a value');
      filename = args[++i];
    } else positional.push(args[i]);
  }
  return { positional, filename };
}

// `--before` takes an optional ref, so a bare one before another flag or the end means HEAD.
function shotArgs(args) {
  const out = { langs: ['en', 'he'], setup: '', before: null, tag: 'main' };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => {
      if (i + 1 >= args.length) throw new Error(`${arg} needs a value`);
      return args[++i];
    };
    if (arg === '--langs') out.langs = next().split(',').filter(Boolean);
    else if (arg === '--setup') {
      const js = next();
      out.setup = js === '-' ? fs.readFileSync(0, 'utf8') : js;
    } else if (arg === '--browser') out.tag = next();
    else if (arg === '--before')
      out.before = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'HEAD';
    else positional.push(arg);
  }
  if (positional.length !== 1 || !out.langs.length)
    throw new Error(`usage: ${COMMANDS.shot.usage}`);
  return { ...out, name: positional[0] };
}

// One /eval for the whole loop: per side and language, reload in that locale, rerun the setup the
// reload undid, and shoot the full window; then put the session's page and locale back and say where it was left.
function shotScript(paths, tag, sides, langs, setup) {
  const file = (name) =>
    path.join(paths.evidence, `${tag}-${name.replace(/[^\p{L}\p{N}._-]+/gu, '-')}.png`);
  const shots = sides.flatMap(([origin, name]) =>
    langs.map((lang) => ({ origin, lang, file: file(`${name}-${lang}`) })),
  );
  return `
const KEY = 'fast-study:locale';
const back = page.url();
const saved = await page.evaluate((key) => localStorage.getItem(key), KEY);
const at = new URL(back);
const files = [];
try {
  for (const { origin, lang, file } of ${JSON.stringify(shots)}) {
    await page.goto(origin ? origin + at.pathname + at.search + at.hash : back);
    await page.evaluate(([key, lang]) => localStorage.setItem(key, lang), [KEY, lang]);
    await page.reload();
    await page.waitForTimeout(500);
    await (async (page, context) => {
${setup}
    })(page, context);
    await page.waitForTimeout(500);
    await page.screenshot({ path: file });
    files.push(file);
  }
} finally {
  await page.goto(back);
  await page.evaluate(([key, value]) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value), [KEY, saved]);
  await page.reload();
}
// index.html carries no lang; activateLocale sets it once the catalog loads.
await page.waitForFunction(() => document.documentElement.lang, null, { timeout: 5000 }).catch(() => {});
const lang = await page.evaluate(() => document.documentElement.lang || '?');
const stored = saved === null ? ' (none stored, app default)' : '';
return [...files, \`left at \${page.url()} · locale \${lang}\${stored}\`].join('\\n');
`;
}

function writeLocks(paths, globs) {
  if (globs.length) fs.writeFileSync(paths.locks, JSON.stringify(globs));
  else fs.rmSync(paths.locks, { force: true });
  console.log(globs.length ? `locked: ${globs.join(' | ')}` : 'no locks');
}

const COMMANDS = {
  set: {
    usage: 'set NAME=value…',
    summary: 'save settings by their .env names, as the settings screen does (e.g. AUTO_RUN=off)',
    async run(paths, args) {
      const env = Object.fromEntries(
        args.map((arg) => {
          const at = arg.indexOf('=');
          if (at < 1) throw new Error(`expected NAME=value, got "${arg}"`);
          return [arg.slice(0, at), arg.slice(at + 1)];
        }),
      );
      if (!Object.keys(env).length) throw new Error('nothing to set');
      const stored = await saveSettings(settingsPatch(env));
      console.log(JSON.stringify(stored));
    },
  },
  reseed: {
    usage: 'reseed',
    summary:
      'restore settings, tokens, fake modes, locks and Drive, wipe both data roots, seed the flow courses',
    async run(paths) {
      const seeded = await reseed(paths);
      await markSeeded(paths);
      console.log(
        `reseeded: ${seeded.courses} courses / ${seeded.lectures} lectures, baseline restored`,
      );
    },
  },
  state: {
    usage: 'state',
    summary: 'save state.json and print what moved since the seed',
    async run(paths) {
      const now = await snapshot(paths);
      fs.writeFileSync(paths.snapshot, JSON.stringify(now, null, 2));
      console.log(`saved ${paths.snapshot}`);
      if (!fs.existsSync(paths.seedSnapshot)) {
        console.log('no seed snapshot to diff against — run `hb reseed` or `setup.mjs --reseed`');
        return;
      }
      const lines = diff(JSON.parse(fs.readFileSync(paths.seedSnapshot, 'utf8')), now);
      console.log(lines.length ? lines.join('\n') : 'unchanged since the seed');
    },
  },
  wall: {
    usage: 'wall',
    summary:
      'blank the data root, both keys and the Moodle site, so a reload shows the first-run screen',
    async run(paths) {
      await wall(paths);
      console.log('walled: DATA_ROOT, both keys and MOODLE_SITE are blank — reload the app');
    },
  },
  unwall: {
    usage: 'unwall',
    summary: 'put the data root, keys and Moodle site back to the baseline',
    async run(paths) {
      await unwall(paths);
      console.log('unwalled: DATA_ROOT, both keys and MOODLE_SITE back to the baseline');
    },
  },
  'add-material': {
    usage: 'add-material <course> <lecture> [file] [--filename name]',
    summary:
      'attach a material as the downloader does (default: the handout PDF; a file keeps its basename)',
    async run(paths, args) {
      const { positional, filename } = fileArgs(args);
      const [course, arg, file] = positional;
      if (!course || !arg || positional.length > 3) throw new Error(`usage: ${this.usage}`);
      const { lecture, kind } = lectureArg(arg);
      const data = fs.readFileSync(file ?? path.join(paths.fixtures, 'handout.pdf'));
      const name = filename ?? (file && path.basename(file));
      const at = `${DATABASE}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}`;
      const query = `kind=${kind}${name ? `&filename=${encodeURIComponent(name)}` : ''}`;
      const { body } = await bytes(
        `${at}/materials?${query}`,
        'POST',
        data,
        'application/octet-stream',
      );
      // The database does not announce its own writes; the downloader notifies after each upload.
      await call(`${DATABASE}/notify`, { method: 'POST' });
      console.log(`added ${course}/${arg}/${body.name} (${data.length} bytes), notified`);
    },
  },
  'add-assignment-file': {
    usage: 'add-assignment-file <course> <assignment> <file> [--filename name]',
    summary: "add a file to an assignment (named by the file's basename unless --filename)",
    async run(_paths, args) {
      const { positional, filename } = fileArgs(args);
      const [course, assignment, file] = positional;
      if (!course || !assignment || !file || positional.length > 3)
        throw new Error(`usage: ${this.usage}`);
      const data = fs.readFileSync(file);
      const name = filename ?? path.basename(file);
      const url = `${DATABASE}/courses/${encodeURIComponent(course)}/assignments/${encodeURIComponent(assignment)}/files?filename=${encodeURIComponent(name)}`;
      // The route broadcasts its own write, so no /notify here.
      const { body } = await bytes(url, 'POST', data, 'application/octet-stream');
      console.log(`added ${body.assignment}/${body.name} (${data.length} bytes)`);
    },
  },
  'rm-lecture': {
    usage: 'rm-lecture <course> <lecture>',
    summary: 'delete a lecture folder on disk and notify, as a user deleting it mid-run',
    async run(paths, [course, arg]) {
      if (!course || !arg) throw new Error('usage: rm-lecture <course> <lecture>');
      const { lecture, kind } = lectureArg(arg);
      console.log(`removed ${await removeLecture(course, lecture, kind)}, notified`);
    },
  },
  retry: {
    usage: 'retry fire [key]',
    summary:
      'fire the held Gemini auto retries now (key: course/lecture[/kind] or course/slug); prints the keys fired',
    async run(_paths, [verb, key]) {
      if (verb !== 'fire') throw new Error('usage: retry fire [key]');
      const fired = await fireRetries(key);
      console.log(fired.length ? fired.join('\n') : 'nothing held');
    },
  },
  lock: {
    usage: 'lock [glob…]',
    summary: "fail the database's writes, deletes and renames of matching files as a Windows lock",
    async run(paths, globs) {
      writeLocks(paths, [...new Set([...readLocks(paths), ...globs])]);
    },
  },
  unlock: {
    usage: 'unlock [glob…]',
    summary: 'drop these locks, or every lock when none is named',
    async run(paths, globs) {
      writeLocks(paths, globs.length ? readLocks(paths).filter((g) => !globs.includes(g)) : []);
    },
  },
  'moodle-busy': {
    usage: 'moodle-busy on|off',
    summary: "hold auto/'s Moodle lock with a call the fake site leaves unanswered, or answer it",
    async run(paths, [state]) {
      if (state === 'on') {
        await holdMoodle();
        console.log(
          'moodle busy: the lock is held for up to 5 min — `hb moodle-busy off` frees it',
        );
      } else if (state === 'off') {
        await releaseMoodle();
        console.log('moodle free: the held call answered and the cooldown ran out');
      } else throw new Error('usage: moodle-busy on|off');
    },
  },
  download: {
    usage: 'download <course> <title> [--browser TAG]',
    summary: "load a course's recordings in Downloads and press one row's Download, found by title",
    async run(paths, args) {
      const at = args.indexOf('--browser');
      const tag = at === -1 ? 'main' : args.splice(at, 2)[1];
      const [course, title] = args;
      if (!course || !title || !tag) throw new Error(`usage: ${COMMANDS.download.usage}`);
      const port = readPorts(paths)[`browser-${tag}`];
      if (!port)
        throw new Error(`no browser session "${tag}" — start one with \`hb browser ${tag}\``);
      // The session runs the same helper the specs import, so both drive the page alike.
      const helper = pathToFileURL(path.join(HARNESS_ROOT, 'lib', 'downloads.mjs')).href;
      const body = `const { downloadRecording } = await import(${JSON.stringify(helper)});
await downloadRecording(page, ${JSON.stringify(course)}, ${JSON.stringify(title)});
return ${JSON.stringify(`pressed Download on "${title}" in ${course}`)};`;
      const response = await fetch(`http://127.0.0.1:${port}/eval`, { method: 'POST', body });
      process.stdout.write(await response.text());
      if (!response.ok) process.exitCode = 1;
    },
  },
  'pick-course': {
    usage: 'pick-course <course> [--browser TAG]',
    summary:
      'open Downloads → University and pick a course (exact name) in the course combobox, which loads it',
    async run(paths, args) {
      const at = args.indexOf('--browser');
      const tag = at === -1 ? 'main' : args.splice(at, 2)[1];
      const [course] = args;
      if (!course || !tag) throw new Error(`usage: ${COMMANDS['pick-course'].usage}`);
      const port = readPorts(paths)[`browser-${tag}`];
      if (!port)
        throw new Error(`no browser session "${tag}" — start one with \`hb browser ${tag}\``);
      const helper = pathToFileURL(path.join(HARNESS_ROOT, 'lib', 'downloads.mjs')).href;
      const body = `const { pickCourse } = await import(${JSON.stringify(helper)});
await pickCourse(page, ${JSON.stringify(course)});
return ${JSON.stringify(`picked ${course}`)};`;
      const response = await fetch(`http://127.0.0.1:${port}/eval`, { method: 'POST', body });
      process.stdout.write(await response.text());
      if (!response.ok) process.exitCode = 1;
    },
  },
  'forget-probes': {
    usage: 'forget-probes',
    summary:
      "restart downloader-auto so every link it probed or captured reads unprobed ('?') again",
    async run(paths) {
      // Both caches are in-memory only, and nothing else — reseed included — empties them.
      await restart(paths, 'downloader-auto', {});
      console.log('forgot: probes and captures — reload the Downloads page so it re-lists');
    },
  },
  kill: {
    usage: 'kill <service>',
    summary: 'kill one recorded service (as --restart names it) and leave it down',
    async run(paths, [name]) {
      if (!name) throw new Error('name a service, e.g. kill database');
      await kill(paths, name);
      console.log(`killed: ${name} — bring it back with setup.mjs --restart ${name}`);
    },
  },
  url: {
    usage: 'url [name]',
    summary: "print one of this stack's URLs (database, frontend, browser-<tag>…), or all of them",
    async run(paths, [name]) {
      const ports = readPorts(paths);
      // The frontend by localhost, the only host its services' CORS takes; the rest by address.
      const url = (key) => `http://${key === 'frontend' ? 'localhost' : '127.0.0.1'}:${ports[key]}`;
      if (!name) {
        for (const key of Object.keys(ports)) console.log(`${key.padEnd(18)} ${url(key)}`);
        return;
      }
      if (!ports[name]) {
        throw new Error(
          `no port "${name}" in ${paths.ports} (known: ${Object.keys(ports).join(', ')})`,
        );
      }
      console.log(url(name));
    },
  },
  browser: {
    usage: 'browser <tag>',
    summary: 'start a browser.mjs session on the live stack, stopped by --down with the rest',
    async run(paths, [tag]) {
      if (!tag) throw new Error('usage: browser <tag>');
      const port = await startBrowser(paths, tag);
      console.log(`browser ${tag} on http://127.0.0.1:${port}, logged to logs/browser-${tag}.log`);
    },
  },
  shot: {
    usage: 'shot <name> [--langs en,he] [--setup js|-] [--before [ref]] [--browser TAG]',
    summary:
      "screenshot the session's page once per UI language, and as <ref> (HEAD) had it with --before",
    async run(paths, args) {
      const { name, langs, setup, before, tag } = shotArgs(args);
      const port = readPorts(paths)[`browser-${tag}`];
      if (!port)
        throw new Error(`no browser session "${tag}" — start one with \`hb browser ${tag}\``);
      const served = before ? await serveBefore(paths, before) : null;
      try {
        const sides = [[null, name], ...(served ? [[served.url, `${name}-before`]] : [])];
        const response = await fetch(`http://127.0.0.1:${port}/eval`, {
          method: 'POST',
          body: shotScript(paths, tag, sides, langs, setup),
        });
        process.stdout.write(await response.text());
        if (!response.ok) process.exitCode = 1;
      } finally {
        await served?.close();
      }
    },
  },
  refused: {
    usage: 'refused [--since <time>]',
    summary: "print network.log's real escapes (the self-check's probes left out); exit 1 if any",
    async run(paths, args) {
      const at = args.indexOf('--since');
      const since = at === -1 ? null : new Date(args[at + 1]);
      if (since && Number.isNaN(since.getTime())) throw new Error(`bad --since "${args[at + 1]}"`);
      const text = fs.existsSync(paths.network) ? fs.readFileSync(paths.network, 'utf8') : '';
      const escapes = text.split('\n').filter((line) => {
        const [stamp, service, verdict] = line.split(' ');
        return (
          verdict === 'REFUSED' && service !== SELFCHECK_TAG && (!since || new Date(stamp) >= since)
        );
      });
      for (const line of escapes) console.log(line);
      console.log(escapes.length ? `${escapes.length} escape(s)` : 'no escapes');
      if (escapes.length) process.exitCode = 1;
    },
  },
};

// One browser action per entry, sent to the session `--browser` names; a failed action exits 1.
for (const name of Object.keys(ACTIONS)) {
  COMMANDS[name] = {
    usage: ACTIONS[name].usage,
    summary:
      name === 'eval'
        ? "run JS (an async function body given page, context) in a session; stdin when no arg or '-'"
        : `/${name} on a browser session (default main), arguments as typed — no JSON to escape`,
    async run(paths, args) {
      const {
        tag,
        path: route,
        body,
      } = actionRequest(name, args, () => fs.readFileSync(0, 'utf8'));
      const port = readPorts(paths)[`browser-${tag}`];
      if (!port)
        throw new Error(`no browser session "${tag}" — start one with \`hb browser ${tag}\``);
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST', body });
      process.stdout.write(await response.text());
      if (!response.ok) process.exitCode = 1;
    },
  };
}

function help() {
  const width = Math.max(...Object.values(COMMANDS).map((command) => command.usage.length));
  console.log('usage: hb.mjs [--harness DIR] <command> [args…]\n');
  for (const { usage, summary } of Object.values(COMMANDS)) {
    console.log(`  ${usage.padEnd(width)}  ${summary}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  // Only ahead of the command, so a fill value that reads `--harness` stays a value.
  const root = args[0] === '--harness' ? args.splice(0, 2)[1] : process.env.HARNESS_DIR;
  const [name, ...rest] = args;
  if (!name || name === 'help' || !COMMANDS[name]) {
    help();
    if (name && name !== 'help') throw new Error(`unknown command "${name}"`);
    return;
  }
  if (!root) throw new Error('which harness? pass --harness DIR or set HARNESS_DIR');
  const paths = harnessPaths(path.resolve(root));
  bindPorts(paths);
  await COMMANDS[name].run(paths, rest);
}

main().catch((error) => {
  console.error(`hb: ${error.message}`);
  process.exit(1);
});
