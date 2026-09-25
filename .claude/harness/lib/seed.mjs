// The scratch DATA_ROOT's contents, written through `database/`'s own routes. One course per flow,
// so parallel flows never touch each other's data, each holding the fixture mix its flow starts from.
import fs from 'node:fs';
import path from 'node:path';
import { DATABASE, PROVIDERS, bytes, json } from './api.mjs';
import { FAKE_COURSE_URL } from './env.mjs';

const encode = (part) => encodeURIComponent(part);

// The self-check runs audio → transcribe here, so no flow's starting state depends on it.
export const SELFCHECK = { course: 'hb-selfcheck', lecture: 'selfcheck' };

// Long on purpose: a sidebar, a heading and a PDF title all have to survive it.
const LONG_LECTURE =
  'שיעור 11 — מבוא ארוך במיוחד שנועד לבדוק גלישת טקסט בכותרת, בתפריט הצד וברשימת הקבצים';

// Where the seeded "Open in Drive" link goes: a loopback page the fake providers serve, so a
// browser following it never leaves the machine.
const DRIVE_URL = `${PROVIDERS}/drive/view/hunt-seeded`;

// Per course: `[lecture, files, kind]`, files being fixture names in upload order. `material` adds
// the handout as a material PDF; `summary.pdf` is the handout too, so a lecture can look finished
// without a render.
export const FLOWS = {
  'hb-mgmt': {
    lectures: [
      ['שיעור 1', ['video.mp4']],
      // Two names one suffix apart, which is where a "next name" guess and a prefix match go wrong.
      ['שיעור 10', []],
      ['שיעור 10 - המשך', []],
      [LONG_LECTURE, ['video.mp4']],
      ['Lecture 2', []],
      ['תרגול 1', ['video.mp4'], 'recitation'],
    ],
  },
  'hb-dl': {
    // The fake site's course; `שיעור 1` holds a video, so its first recording reads as downloaded.
    sourceUrl: FAKE_COURSE_URL,
    lectures: [['שיעור 1', ['video.mp4']]],
  },
  'hb-edit': {
    lectures: [
      ['שיעור 1', ['video.mp4', 'transcript.txt', 'summary.md']],
      ['שיעור 2', ['video.mp4', 'transcript.txt', 'summary.md']],
      ['Lecture 3', ['video.mp4', 'transcript.txt', 'summary.md']],
    ],
  },
  'hb-nav': {
    lectures: [
      [
        'שיעור 1',
        ['video.mp4', 'transcript.txt', 'summary.md', 'summary.pdf', 'drive_url.txt', 'material'],
      ],
      ['שיעור 2', ['video.mp4', 'transcript.txt', 'summary.md', 'material']],
      ['שיעור 3', []],
    ],
  },
  'hb-pipeline': {
    // One lecture per stage, so a step can start anywhere; two video-only for queue + lock.
    lectures: [
      ['שיעור 1', ['video.mp4']],
      ['שיעור 2', ['video.mp4', 'transcript.txt']],
      ['שיעור 3', ['video.mp4', 'transcript.txt', 'summary.md']],
      ['שיעור 4', ['video.mp4']],
      ['שיעור 5', ['video.mp4', 'transcript.txt', 'summary.md', 'summary.pdf']],
      ['שיעור 6', []],
      ['תרגול 1', ['video.mp4'], 'recitation'],
    ],
  },
  'hb-fail': {
    lectures: [
      ['שיעור 1', ['video.mp4']],
      ['שיעור 2', ['video.mp4', 'transcript.txt']],
      ['שיעור 3', ['video.mp4', 'transcript.txt', 'summary.md']],
      ['שיעור 4', ['video.mp4']],
    ],
  },
  [SELFCHECK.course]: { lectures: [[SELFCHECK.lecture, ['video.mp4']]] },
};

const TYPES = {
  'video.mp4': 'video/mp4',
  'transcript.txt': 'text/plain',
  'summary.md': 'text/markdown',
  'summary.pdf': 'application/pdf',
  'drive_url.txt': 'text/plain',
};

export async function seed(paths) {
  const fixture = (name) => fs.readFileSync(path.join(paths.fixtures, name));
  const content = {
    'video.mp4': fixture('video.mp4'),
    'transcript.txt': fixture('transcript.txt'),
    'summary.md': fixture('summary.md'),
    'summary.pdf': fixture('handout.pdf'),
    'drive_url.txt': Buffer.from(DRIVE_URL),
    material: fixture('handout.pdf'),
  };
  let lectures = 0;
  for (const [course, { sourceUrl, lectures: rows }] of Object.entries(FLOWS)) {
    await json(
      `${DATABASE}/courses`,
      'POST',
      sourceUrl ? { name: course, source_url: sourceUrl } : { name: course },
    );
    for (const [lecture, files, kind = 'lecture'] of rows) {
      const base = `${DATABASE}/courses/${encode(course)}/lectures`;
      await json(`${base}?kind=${kind}`, 'POST', { name: lecture });
      for (const file of files) {
        const at = `${base}/${encode(lecture)}`;
        // The video first: writing it wipes every derived file, as a fresh upload should.
        const url =
          file === 'video.mp4'
            ? `${at}/video?kind=${kind}`
            : file === 'material'
              ? `${at}/materials?kind=${kind}`
              : `${at}/files/${encode(file)}?kind=${kind}`;
        const method = file === 'material' ? 'POST' : 'PUT';
        await bytes(url, method, content[file], TYPES[file] ?? 'application/pdf');
      }
      lectures += 1;
    }
  }
  return { courses: Object.keys(FLOWS).length, lectures };
}
