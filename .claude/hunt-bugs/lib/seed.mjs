// The scratch DATA_ROOT's contents, written through `database/`'s own routes. Enough shape that a
// flow has somewhere to land: lectures at every pipeline stage, a recitation, Hebrew and Latin
// names, a very long name, two names that differ only by a suffix, and one course whose source_url
// is the fake site, so the downloads page has a course to browse.
import fs from 'node:fs';
import path from 'node:path';
import { DATABASE, bytes, json } from './api.mjs';
import { FAKE_COURSE_URL } from './env.mjs';

const encode = (part) => encodeURIComponent(part);

export const COURSES = {
  hebrew: 'אלגוריתמים',
  latin: 'Intro to Systems',
};

// Long on purpose: a sidebar, a heading and a PDF title all have to survive it.
const LONG_LECTURE =
  'שיעור 11 — מבוא ארוך במיוחד שנועד לבדוק גלישת טקסט בכותרת, בתפריט הצד וברשימת הקבצים';

async function course(name, sourceUrl) {
  await json(`${DATABASE}/courses`, 'POST', sourceUrl ? { name, source_url: sourceUrl } : { name });
}

async function lecture(courseName, name, kind = 'lecture') {
  await json(`${DATABASE}/courses/${encode(courseName)}/lectures?kind=${kind}`, 'POST', { name });
}

async function put(courseName, lectureName, file, buffer, type, kind = 'lecture') {
  const base = `${DATABASE}/courses/${encode(courseName)}/lectures/${encode(lectureName)}`;
  const url =
    file === 'video.mp4'
      ? `${base}/video?kind=${kind}`
      : `${base}/files/${encode(file)}?kind=${kind}`;
  await bytes(url, 'PUT', buffer, type);
}

export async function seed(paths) {
  const video = fs.readFileSync(path.join(paths.fixtures, 'video.mp4'));
  const pdf = fs.readFileSync(path.join(paths.fixtures, 'handout.pdf'));
  const transcript = fs.readFileSync(path.join(paths.fixtures, 'transcript.txt'));
  const summary = fs.readFileSync(path.join(paths.fixtures, 'summary.md'));

  await course(COURSES.hebrew, FAKE_COURSE_URL);
  // One lecture per pipeline stage, so a flow can start anywhere without running everything first.
  await lecture(COURSES.hebrew, 'שיעור 1');
  await put(COURSES.hebrew, 'שיעור 1', 'video.mp4', video, 'video/mp4');

  await lecture(COURSES.hebrew, 'שיעור 2');
  await put(COURSES.hebrew, 'שיעור 2', 'video.mp4', video, 'video/mp4');
  await put(COURSES.hebrew, 'שיעור 2', 'transcript.txt', transcript, 'text/plain');

  await lecture(COURSES.hebrew, 'שיעור 3');
  await put(COURSES.hebrew, 'שיעור 3', 'video.mp4', video, 'video/mp4');
  await put(COURSES.hebrew, 'שיעור 3', 'transcript.txt', transcript, 'text/plain');
  await put(COURSES.hebrew, 'שיעור 3', 'summary.md', summary, 'text/markdown');
  await bytes(
    `${DATABASE}/courses/${encode(COURSES.hebrew)}/lectures/${encode('שיעור 3')}/materials`,
    'POST',
    pdf,
    'application/pdf',
  );

  await lecture(COURSES.hebrew, 'שיעור 4'); // empty: nothing to run yet
  // Two names one suffix apart, which is where a "next name" guess and a prefix match go wrong.
  await lecture(COURSES.hebrew, 'שיעור 10');
  await lecture(COURSES.hebrew, 'שיעור 10 - המשך');
  await lecture(COURSES.hebrew, LONG_LECTURE);
  await put(COURSES.hebrew, LONG_LECTURE, 'video.mp4', video, 'video/mp4');

  await lecture(COURSES.hebrew, 'תרגול 1', 'recitation');
  await put(COURSES.hebrew, 'תרגול 1', 'video.mp4', video, 'video/mp4', 'recitation');

  await course(COURSES.latin);
  await lecture(COURSES.latin, 'Lecture 1');
  await put(COURSES.latin, 'Lecture 1', 'video.mp4', video, 'video/mp4');
  await put(COURSES.latin, 'Lecture 1', 'transcript.txt', transcript, 'text/plain');
  await lecture(COURSES.latin, 'Lecture 2');

  return {
    courses: 2,
    lectures: 9,
    ready: `${COURSES.hebrew}/שיעור 1 (video only) → run any step against the fakes`,
  };
}
