// How the fake Gemini answers the summary-figures calls, apart from the server so the unit tests need no port.

// The box call is recognised by the first line of the backend's figure_boxes.md, read from its own copy.
export const boxesHead = (instructionsDir, readFile) =>
  readFile(`${instructionsDir}/figure_boxes.md`).split(/\r?\n/, 1)[0].trim();

// Normalized [ymin, xmin, ymax, xmax]: the graph on each of the econ-slides fixture's pages 1-3, indexed by page - 1.
export const FIGURE_BOXES = [
  [200, 30, 960, 500],
  [380, 270, 985, 720],
  [200, 490, 985, 960],
];

const texts = (parts) => parts.filter((p) => typeof p.text === 'string').map((p) => p.text.trim());

/** The materials a summary call labels: `{pdfs, pictures}` as the allocated names / refs it was sent, or null with none. */
export function figureSources(parts) {
  const pdfs = [];
  const pictures = [];
  for (const text of texts(parts)) {
    const file = /^FILE (\S+)/.exec(text)?.[1];
    if (file?.toLowerCase().endsWith('.pdf')) pdfs.push(file);
    const picture = /^PICTURE (\S+) \(on slide/.exec(text)?.[1];
    if (picture) pictures.push(picture);
  }
  return pdfs.length || pictures.length ? { pdfs, pictures } : null;
}

/** Standalone image lines naming the materials as attached: each PDF's pages 1 and 2, then the first PPTX picture. */
export function figureLines({ pdfs, pictures }) {
  const lines = [];
  for (const pdf of pdfs) {
    lines.push(`![מסגרת אדג'וורת'](${pdf}#page=1)`, `![עקומות אדישות](${pdf}#page=2)`);
  }
  if (pictures[0]) lines.push(`![תרשים מהמצגת](${pictures[0]})`);
  return lines;
}

/** `summary` with each line placed after one of its plain paragraphs, in order, as Gemini places a figure. */
export function placeFigures(summary, lines) {
  const queue = [...lines];
  const plain = (block) => /^[^\s#|$>\-*\d`!]/.test(block);
  const out = summary.split(/\n\s*\n/).flatMap((block) => {
    if (!queue.length || !plain(block)) return [block];
    return [block, queue.shift()];
  });
  return [...out, ...queue].join('\n\n');
}

/** Whether the request is the box call: its first text part is figure_boxes.md. */
export const isBoxCall = (parts, head) => !!head && texts(parts)[0]?.startsWith(head);

/** The box reply: every `Figure <id>:` part found at the box of page <id>, as figureLines links each PDF's pages in order. */
export function boxReply(parts) {
  const ids = texts(parts)
    .map((text) => /^Figure (\d+):/.exec(text)?.[1])
    .filter(Boolean);
  return JSON.stringify({
    figures: ids.map((id) => ({
      id: Number(id),
      found: true,
      box_2d: FIGURE_BOXES[(Number(id) - 1) % FIGURE_BOXES.length],
    })),
  });
}
