#!/usr/bin/env node
// Helpers a sweep runs against a live harness. Each subcommand is one entry in COMMANDS; add one
// there and `hb help` lists it.
//
//   node .claude/hunt-bugs/hb.mjs [--harness DIR] <command> [args…]   (or HUNT_BUGS_HARNESS=DIR)
import fs from 'node:fs';
import path from 'node:path';
import { DATABASE, bytes, call, saveSettings } from './lib/api.mjs';
import { markSeeded, removeLecture, reseed, settingsPatch, unwall, wall } from './lib/baseline.mjs';
import { BROWSER_PORTS, FLOWS, REPO_ROOT, SELFCHECK_TAG, harnessPaths } from './lib/env.mjs';
import { mergeFindings, renderBrief } from './lib/findings.mjs';
import { startBrowser } from './lib/stack.mjs';
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
    summary: 'blank the data root and both keys, so a reload shows the first-run screen',
    async run(paths) {
      await wall(paths);
      console.log('walled: DATA_ROOT, GROQ_API_KEY and GEMINI_API_KEY are blank — reload the app');
    },
  },
  unwall: {
    usage: 'unwall',
    summary: 'put the data root and keys back to the baseline',
    async run(paths) {
      await unwall(paths);
      console.log('unwalled: DATA_ROOT and both keys back to the baseline');
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
  browser: {
    usage: 'browser <tag> [--port N]',
    summary: 'start a browser.mjs session on the live stack, stopped by --down with the rest',
    async run(paths, [tag, ...rest]) {
      const at = rest.indexOf('--port');
      const port = at === -1 ? BROWSER_PORTS[tag] : Number(rest[at + 1]);
      if (!tag || !port) {
        throw new Error(
          `usage: browser <tag> [--port N] (known tags: ${Object.keys(BROWSER_PORTS).join(', ')})`,
        );
      }
      await startBrowser(paths, tag, port);
      console.log(`browser ${tag} on http://127.0.0.1:${port}, logged to logs/browser-${tag}.log`);
    },
  },
  brief: {
    usage: 'brief <tag> [focus…]',
    summary: "print a flow agent's brief: brief.md filled in for this harness and flow tag",
    async run(paths, [tag, ...focus]) {
      const flow = FLOWS[tag];
      if (!flow)
        throw new Error(`usage: brief <tag> [focus…] (tags: ${Object.keys(FLOWS).join(', ')})`);
      console.log(
        renderBrief({
          title: flow.title,
          tag,
          sweep: flow.sweep,
          focus: focus.length ? ` Narrowed to: ${focus.join(' ')}.` : '',
          course: flow.course
            ? `\`${flow.course}\`. Stay in it, and give any course you create the prefix \`${flow.course}-\`.`
            : 'none of your own. Settings are global, so put back everything you change.',
          port: String(BROWSER_PORTS[tag]),
          harness: paths.root,
          since: new Date().toISOString().slice(0, 19) + 'Z',
          fragment: path.join(paths.fragments, `${tag}.md`),
        }),
      );
    },
  },
  findings: {
    usage: 'findings <area> <YYYY-MM-DD> [--out FILE]',
    summary:
      'join fragments/*.md into findings-<area>-<date>.md at the repo root: summary table, duplicate locations',
    async run(paths, args) {
      const at = args.indexOf('--out');
      const out = at === -1 ? null : args.splice(at, 2)[1];
      const [area, date] = args;
      if (!area || /[\s/]/.test(area) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
        throw new Error(
          'usage: findings <area> <YYYY-MM-DD> [--out FILE] (area: no spaces or slashes)',
        );
      }
      const file = out ? path.resolve(out) : path.join(REPO_ROOT, `findings-${area}-${date}.md`);
      if (fs.existsSync(file)) throw new Error(`${file} exists; delete it to merge again`);
      fs.writeFileSync(file, mergeFindings(paths, area, date));
      console.log(`wrote ${file}`);
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
  const root = at === -1 ? process.env.HUNT_BUGS_HARNESS : args.splice(at, 2)[1];
  const [name, ...rest] = args;
  if (!name || name === 'help' || !COMMANDS[name]) {
    help();
    if (name && name !== 'help') throw new Error(`unknown command "${name}"`);
    return;
  }
  if (!root) throw new Error('which harness? pass --harness DIR or set HUNT_BUGS_HARNESS');
  await COMMANDS[name].run(harnessPaths(path.resolve(root)), rest);
}

main().catch((error) => {
  console.error(`hb: ${error.message}`);
  process.exit(1);
});
