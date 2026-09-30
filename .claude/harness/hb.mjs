#!/usr/bin/env node
// Helpers run against a live harness. Each subcommand is one entry in COMMANDS; add one
// there and `hb help` lists it.
//
//   node .claude/harness/hb.mjs [--harness DIR] <command> [args…]   (or HARNESS_DIR=DIR)
import fs from 'node:fs';
import path from 'node:path';
import { DATABASE, bindPorts, bytes, call, saveSettings } from './lib/api.mjs';
import { markSeeded, removeLecture, reseed, settingsPatch, unwall, wall } from './lib/baseline.mjs';
import { SELFCHECK_TAG, harnessPaths, readPorts } from './lib/env.mjs';
import { restart, startBrowser } from './lib/stack.mjs';
import { diff, readLocks, snapshot } from './lib/state.mjs';

// A lecture argument: `name`, or `Recitations/name` for a recitation, as the on-disk path reads.
function lectureArg(text) {
  const recitation = text?.startsWith('Recitations/');
  return {
    lecture: recitation ? text.slice('Recitations/'.length) : text,
    kind: recitation ? 'recitation' : 'lecture',
  };
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
    usage: 'add-material <course> <lecture> [file]',
    summary: 'attach a PDF material as the downloader does (default: the handout fixture)',
    async run(paths, [course, arg, file]) {
      if (!course || !arg) throw new Error('usage: add-material <course> <lecture> [file]');
      const { lecture, kind } = lectureArg(arg);
      const data = fs.readFileSync(file ?? path.join(paths.fixtures, 'handout.pdf'));
      const at = `${DATABASE}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}`;
      const { body } = await bytes(`${at}/materials?kind=${kind}`, 'POST', data, 'application/pdf');
      // The database does not announce its own writes; the downloader notifies after each upload.
      await call(`${DATABASE}/notify`, { method: 'POST' });
      console.log(`added ${course}/${arg}/${body.name} (${data.length} bytes), notified`);
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

function help() {
  const width = Math.max(...Object.values(COMMANDS).map((command) => command.usage.length));
  console.log('usage: hb.mjs [--harness DIR] <command> [args…]\n');
  for (const { usage, summary } of Object.values(COMMANDS)) {
    console.log(`  ${usage.padEnd(width)}  ${summary}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--harness');
  const root = at === -1 ? process.env.HARNESS_DIR : args.splice(at, 2)[1];
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
