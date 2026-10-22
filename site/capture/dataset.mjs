// The courses the site's screenshots show, written into a wiped harness stack by `site/capture.mjs`.
// `text` names `text/<text>.transcript.txt` and `.summary.md`; `minutes` is the video's length.
// `state`: 'video' (video only), 'summarized' (+ audio, transcript, summary), 'pdf' (+ a rendered
// PDF) or 'done' (+ the PDF uploaded to the fake Drive); `studied` marks it studied.

export const COURSES = [
  {
    name: 'מבני נתונים',
    // Linked to the fake Moodle course, whose plain-link "הקלטה 3 — עצים" is the journey's recording.
    moodle: true,
    lectures: [
      { name: 'הרצאה 1 — מבוא', text: 'ds-intro', minutes: 84, state: 'done', studied: true },
      {
        name: 'הרצאה 2 — סיבוכיות',
        text: 'ds-complexity',
        minutes: 91,
        state: 'done',
        studied: true,
      },
      {
        name: 'תרגול 1 — ניתוח לולאות',
        kind: 'recitation',
        text: 'ds-recitation',
        minutes: 46,
        state: 'summarized',
      },
    ],
  },
  {
    name: 'אלגוריתמים',
    lectures: [
      { name: 'הרצאה 1 — מיון', text: 'alg-sorting', minutes: 88, state: 'done', studied: true },
      { name: 'הרצאה 2 — תכנון דינמי', text: 'alg-dp', minutes: 93, state: 'done' },
      {
        name: 'הרצאה 3 — אלגוריתמים חמדניים',
        text: 'alg-greedy',
        minutes: 85,
        state: 'pdf',
      },
    ],
  },
  {
    name: 'מבוא למדעי המחשב',
    lectures: [
      { name: 'הרצאה 1 — משתנים וטיפוסים', text: 'cs-variables', minutes: 79, state: 'done' },
      { name: 'הרצאה 2 — תנאים ולולאות', minutes: 82, state: 'video' },
    ],
  },
  {
    name: 'חשבון אינפיניטסימלי 1',
    lectures: [
      { name: 'הרצאה 1 — גבולות', text: 'calc-limits', minutes: 95, state: 'done', studied: true },
      { name: 'הרצאה 2 — רציפות', minutes: 90, state: 'video' },
    ],
  },
];

// The one lecture the page's journey follows: downloaded from the fake Moodle course on camera,
// then given its dataset text once its pipeline has run on the fakes. A plain-link row, so auto
// probes its size and the download card shows a bar with time left.
export const JOURNEY = {
  course: 'מבני נתונים',
  lecture: 'הרצאה 3 — עצים',
  recording: 'הקלטה 3 — עצים',
  text: 'ds-trees',
  minutes: 87,
};

// What each feature shot opens.
export const HERO = { course: 'מבני נתונים', lecture: 'הרצאה 2 — סיבוכיות' };
export const OVERVIEW = 'אלגוריתמים';
export const EDITOR = { course: 'מבוא למדעי המחשב', lecture: 'הרצאה 1 — משתנים וטיפוסים' };
// Shot after the journey, so its lecture is among the hits.
export const SEARCH = { course: 'מבני נתונים', query: 'חיפוש בינארי' };
