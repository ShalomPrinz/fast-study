// The flow brief and the findings merge. brief.md defines the fragment format; parseFragment
// accepts exactly that shape and throws on anything else, so a finding is never silently dropped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessPaths } from '../harness/lib/env.mjs';
import { diff } from '../harness/lib/state.mjs';

const HUNT_ROOT = path.dirname(fileURLToPath(import.meta.url));

// The flows a wave runs, by browser tag: the Step 2 sweep items each owns and its seeded course.
// Their order is the merged findings file's order.
export const FLOWS = {
  settings: { title: 'Settings', sweep: '1', course: null },
  mgmt: { title: 'Course and lecture management', sweep: '2', course: 'hb-mgmt' },
  dl: { title: 'Downloads', sweep: '3', course: 'hb-dl' },
  pipeline: { title: 'Pipeline and course overview', sweep: '4 and 7', course: 'hb-pipeline' },
  fail: { title: 'Failure surfacing', sweep: '5', course: 'hb-fail' },
  edit: { title: 'Editor and PDF', sweep: '6', course: 'hb-edit' },
  nav: { title: 'Search, materials, other links, navigation', sweep: '8', course: 'hb-nav' },
};

/** Where a flow agent writes its `<tag>.md`, inside its own harness root. */
export const fragmentsDir = (paths) => path.join(paths.root, 'fragments');

const SECTIONS = ['Confirmed', 'Unconfirmed / flaky', 'Harness gaps'];
const FIELDS = [
  'Severity',
  'Owner',
  'Flow',
  'Observed',
  'Expected',
  'Evidence',
  'Lands in',
  'Harness ruled out by',
];
const SEVERITIES = ['critical', 'major', 'minor', 'cosmetic'];
// `path/to/file.ext:42` (or `:42-50`) anywhere in a Lands in field; the start line is the key.
const LOCATION = /([\w./-]+\.[A-Za-z0-9]+):(\d+)/g;

/** brief.md with every `{{name}}` filled from `values`; an unfilled one is an error. */
export function renderBrief(values) {
  const template = fs.readFileSync(path.join(HUNT_ROOT, 'brief.md'), 'utf8');
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    if (!(name in values)) throw new Error(`brief.md: no value for {{${name}}}`);
    return values[name];
  });
}

/** One fragment's flow title and findings; collects every problem as `file:line: why`. */
export function parseFragment(file, text) {
  const lines = text.replace(/\s+$/, '').split('\n');
  const errors = [];
  const fail = (index, why) =>
    errors.push({ line: index + 1, text: `${file}:${index + 1}: ${why}` });
  const findings = [];
  let title = null;
  let section = -1; // index into SECTIONS; -1 is the header
  let header = '';
  let finding = null;
  let field = null;

  const close = () => {
    if (!finding) return;
    for (const name of FIELDS) {
      if (!(name in finding.fields)) fail(finding.line, `finding has no **${name}:** field`);
    }
    const severity = finding.fields.Severity?.trim().match(/^[a-z]+/)?.[0];
    if (finding.fields.Severity !== undefined && !SEVERITIES.includes(severity)) {
      fail(finding.line, `Severity must start with ${SEVERITIES.join(' | ')}`);
    }
    finding.severity = severity;
    finding.owner = (finding.fields.Owner ?? '').split(/ \(| —/)[0].trim();
    finding.locations = [
      ...new Set(
        [...(finding.fields['Lands in'] ?? '').matchAll(LOCATION)].map((m) => `${m[1]}:${m[2]}`),
      ),
    ];
    if (finding.fields['Lands in'] !== undefined && !finding.locations.length) {
      fail(finding.line, 'Lands in names no `path:line`');
    }
    findings.push(finding);
    finding = null;
  };

  const first = lines.findIndex((line) => line.trim());
  if (first === -1)
    return { title, findings, errors: [{ line: 0, text: `${file}: empty fragment` }] };
  const top = lines[first].match(/^## Flow: (.+)$/);
  if (!top) fail(first, 'first line must be `## Flow: <title>`');
  else title = top[1].trim();

  for (let i = first + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,2} /.test(line)) {
      fail(i, 'a fragment holds one `## Flow:` heading and nothing above `###`');
      continue;
    }
    const sub = line.match(/^### (.+)$/);
    if (sub) {
      close();
      field = null;
      if (sub[1].trim() !== SECTIONS[section + 1]) {
        fail(
          i,
          `expected \`### ${SECTIONS[section + 1] ?? '(no more sections)'}\`, got \`${line}\``,
        );
      }
      section = Math.min(section + 1, SECTIONS.length - 1);
      continue;
    }
    if (section === -1) {
      header += `${line}\n`;
      continue;
    }
    const head = line.match(/^#### (.+)$/);
    if (head) {
      if (section !== 0) fail(i, '`####` findings belong under `### Confirmed` only');
      close();
      finding = { symptom: head[1].trim(), line: i, fields: {} };
      field = null;
      continue;
    }
    if (section !== 0 || !line.trim()) {
      if (field) finding.fields[field] += `\n${line}`;
      continue;
    }
    const bullet = line.match(/^- \*\*([^*]+):\*\*(.*)$/);
    if (bullet && finding) {
      const name = bullet[1];
      if (!FIELDS.includes(name)) fail(i, `unknown field **${name}:**`);
      else if (name in finding.fields) fail(i, `**${name}:** given twice`);
      else {
        finding.fields[name] = bullet[2];
        field = name;
      }
      continue;
    }
    if (/^\s/.test(line) && field) {
      finding.fields[field] += `\n${line}`;
      continue;
    }
    fail(
      i,
      finding
        ? 'stray line: a field is `- **Name:** …`, its continuation indented'
        : 'text under `### Confirmed` before the first `####` finding',
    );
  }
  close();
  if (title !== null && section < SECTIONS.length - 1) {
    fail(
      lines.length - 1,
      `missing \`### ${SECTIONS[section + 1]}\` (keep every section, \`- none\` if empty)`,
    );
  }
  if (!/\*\*Driven:\*\*/.test(header)) fail(first, 'no **Driven:** line before `### Confirmed`');
  if (!/\*\*Not covered:\*\*/.test(header))
    fail(first, 'no **Not covered:** line before `### Confirmed`');
  errors.sort((a, b) => a.line - b.line);
  return { title, findings, text: lines.slice(first).join('\n'), errors };
}

// Known flows in FLOWS order, then any other tag alphabetically.
const byFlow = (key) => (a, b) => {
  const order = Object.keys(FLOWS);
  const rank = (tag) => (order.includes(tag) ? order.indexOf(tag) : order.length);
  return rank(key(a)) - rank(key(b)) || key(a).localeCompare(key(b));
};

/** A wave's flow stacks: each `<wave>/<tag>/` holding a `fragments/` dir. */
function waveStacks(wave) {
  if (!fs.existsSync(wave)) throw new Error(`no wave root at ${wave}`);
  return fs
    .readdirSync(wave, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ tag: entry.name, paths: harnessPaths(path.join(wave, entry.name)) }))
    .filter((stack) => fs.existsSync(fragmentsDir(stack.paths)))
    .sort(byFlow((stack) => stack.tag));
}

// One stack's `state-seed.json` → `state.json` diff, to follow its flow's label directly.
function stateDiff(paths) {
  if (!fs.existsSync(paths.snapshot) || !fs.existsSync(paths.seedSnapshot)) {
    return ' no `state.json`: the flow never ran `hb state`.';
  }
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  const lines = diff(read(paths.seedSnapshot), read(paths.snapshot));
  return lines.length ? `\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`` : ' unchanged since the seed.';
}

const cell = (text) => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/** The merged findings file's text for a wave root; throws with every malformed fragment line at once. */
export function mergeFindings(wave, area, date) {
  const stacks = waveStacks(wave);
  const files = stacks
    .flatMap((stack) =>
      fs
        .readdirSync(fragmentsDir(stack.paths))
        .filter((name) => name.endsWith('.md'))
        .map((name) => ({
          tag: name.slice(0, -3),
          file: path.join(fragmentsDir(stack.paths), name),
        })),
    )
    .sort(byFlow((fragment) => fragment.tag));
  if (!files.length) throw new Error(`no fragments in ${wave}/*/fragments`);
  const flows = files.map(({ tag, file }) => ({
    tag,
    ...parseFragment(file, fs.readFileSync(file, 'utf8')),
  }));
  const errors = flows.flatMap((flow) => flow.errors.map((error) => error.text));
  if (errors.length) {
    throw new Error(`${errors.length} problem(s), nothing written:\n  ${errors.join('\n  ')}`);
  }

  // Number findings by severity, keeping each flow's order within one severity.
  const all = flows.flatMap((flow) => flow.findings.map((finding) => ({ ...finding, flow })));
  all.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  all.forEach((finding, index) => (finding.n = index + 1));

  const byLocation = new Map();
  for (const finding of all) {
    for (const location of finding.locations) {
      byLocation.set(location, [...(byLocation.get(location) ?? []), finding]);
    }
  }
  // One line per set of findings sharing a location across flows, however many locations they share.
  const groups = new Map();
  for (const [location, found] of byLocation) {
    if (new Set(found.map((f) => f.flow.tag)).size < 2) continue;
    const key = found.map((f) => `#${f.n} (${f.flow.title})`).join(', ');
    groups.set(key, [...(groups.get(key) ?? []), `\`${location}\``]);
  }
  const overlaps = [...groups].map(([key, locations]) => `${key}: ${locations.join(', ')}`);

  // A paragraph per flow, not a list item, so a diff's code fence renders under it.
  const states = stacks.flatMap((stack) => [
    `*${FLOWS[stack.tag]?.title ?? stack.tag}:*${stateDiff(stack.paths)}`,
    '',
  ]);
  const missing = Object.keys(FLOWS).filter((tag) => !flows.some((flow) => flow.tag === tag));

  const number = (flow) => {
    let k = 0;
    const own = all.filter((f) => f.flow === flow).sort((a, b) => a.line - b.line);
    return flow.text.replace(/^#### /gm, () => `#### ${own[k++].n}. `);
  };

  return [
    `# Findings — ${area}, ${date}`,
    '',
    `**Run:** wave root \`${wave}\`, one stack per flow: ${stacks.map((s) => `\`${s.paths.root}\``).join(', ')}. Flows: ${flows.map((f) => f.title).join(', ')}.`,
    '',
    "**Left changed since the seed** (each flow's `hb state`):",
    '',
    ...states,
    `**Not covered:** ${missing.length ? `no fragment from ${missing.join(', ')}.` : 'every flow reported.'}`,
    '',
    '## Summary',
    '',
    '| # | Severity | Owner | Symptom | Flow |',
    '|---|---|---|---|---|',
    ...all.map(
      (f) => `| ${f.n} | ${f.severity} | ${cell(f.owner)} | ${cell(f.symptom)} | ${f.flow.title} |`,
    ),
    '',
    `**Overlaps across flows:** ${overlaps.length ? `probable duplicates, same location:\n\n${overlaps.map((o) => `- ${o}`).join('\n')}` : 'none by location.'}`,
    '',
    'The per-flow sections follow, verbatim from each flow.',
    '',
    flows.map(number).join('\n\n---\n\n'),
    '',
  ].join('\n');
}
