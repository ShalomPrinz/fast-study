#!/usr/bin/env node
// The /hunt-bugs wave's own helpers, on top of a harness started by `.claude/harness/setup.mjs`.
//
//   node .claude/hunt-bugs/hunt.mjs [--harness DIR] <brief|findings> [args…]   (or HARNESS_DIR=DIR)
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, harnessPaths, readPorts } from '../harness/lib/env.mjs';
import { FLOWS, fragmentsDir, mergeFindings, renderBrief } from './findings.mjs';

const COMMANDS = {
  brief: {
    usage: 'brief <tag> [focus…]',
    summary: "print a flow agent's brief: brief.md filled in for this harness and flow tag",
    async run(paths, [tag, ...focus]) {
      const flow = FLOWS[tag];
      if (!flow)
        throw new Error(`usage: brief <tag> [focus…] (tags: ${Object.keys(FLOWS).join(', ')})`);
      const port = readPorts(paths)[`browser-${tag}`];
      if (!port) {
        throw new Error(
          `no browser-${tag} session on this harness — start it with \`hb browser ${tag}\` first`,
        );
      }
      fs.mkdirSync(fragmentsDir(paths), { recursive: true });
      console.log(
        renderBrief({
          title: flow.title,
          tag,
          sweep: flow.sweep,
          focus: focus.length ? ` Narrowed to: ${focus.join(' ')}.` : '',
          course: flow.course
            ? `\`${flow.course}\`. Stay in it, and give any course you create the prefix \`${flow.course}-\`.`
            : 'none of your own. Settings are global, so put back everything you change.',
          port: String(port),
          harness: paths.root,
          since: new Date().toISOString().slice(0, 19) + 'Z',
          fragment: path.join(fragmentsDir(paths), `${tag}.md`),
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
};

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--harness');
  const root = at === -1 ? process.env.HARNESS_DIR : args.splice(at, 2)[1];
  const [name, ...rest] = args;
  if (!COMMANDS[name]) {
    for (const { usage, summary } of Object.values(COMMANDS)) console.log(`  ${usage}  ${summary}`);
    if (name && name !== 'help') throw new Error(`unknown command "${name}"`);
    return;
  }
  if (!root) throw new Error('which harness? pass --harness DIR or set HARNESS_DIR');
  await COMMANDS[name].run(harnessPaths(path.resolve(root)), rest);
}

main().catch((error) => {
  console.error(`hunt: ${error.message}`);
  process.exit(1);
});
