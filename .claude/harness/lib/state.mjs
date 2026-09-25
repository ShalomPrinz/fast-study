// What a wave left behind, read back through the services: fake modes, settings, Drive and Moodle
// status, file locks, and every course's lectures with the files they hold. `diff` names each leaf
// that moved.
import fs from 'node:fs';
import { AUTO, BACKEND, DATABASE, PROVIDERS, SITE, call } from './api.mjs';

function lectures(nodes) {
  return Object.fromEntries(
    nodes.map((node) => [
      node.name,
      [
        ...Object.entries(node.files)
          .filter(([, file]) => file.exists)
          .map(([name]) => name),
        ...node.materials.map((material) => material.name),
      ].join(' '),
    ]),
  );
}

/** The globs `hb lock` set, [] when none. */
export function readLocks(paths) {
  try {
    return JSON.parse(fs.readFileSync(paths.locks, 'utf8'));
  } catch {
    return [];
  }
}

/** The current state, as plain JSON. */
export async function snapshot(paths) {
  const get = async (url) => (await call(url)).body;
  const tree = await get(`${DATABASE}/tree`);
  const site = await get(`${SITE}/health`);
  return {
    fakes: {
      providers: (await get(`${PROVIDERS}/health`)).mode,
      site: { mode: site.mode, downloadMs: site.downloadMs },
    },
    settings: await get(`${DATABASE}/settings`),
    drive: await get(`${BACKEND}/config/drive/status`),
    moodle: await get(`${AUTO}/auth/status`),
    locks: readLocks(paths),
    courses: Object.fromEntries(
      tree.map((course) => [
        course.name,
        {
          archived: course.archived,
          source_url: course.source_url,
          lectures: lectures(course.lectures),
          recitations: lectures(course.recitations),
        },
      ]),
    ),
  };
}

function leaves(value, prefix, out) {
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) leaves(item, `${prefix}/${key}`, out);
  } else {
    out.set(prefix, JSON.stringify(value));
  }
  return out;
}

/** One line per leaf that differs: `+` only in `after`, `-` only in `before`, `~` changed. */
export function diff(before, after) {
  const a = leaves(before, '', new Map());
  const b = leaves(after, '', new Map());
  const lines = [];
  for (const [key, value] of a) {
    if (!b.has(key)) lines.push(`- ${key} ${value}`);
    else if (b.get(key) !== value) lines.push(`~ ${key} ${value} → ${b.get(key)}`);
  }
  for (const [key, value] of b) if (!a.has(key)) lines.push(`+ ${key} ${value}`);
  return lines;
}
