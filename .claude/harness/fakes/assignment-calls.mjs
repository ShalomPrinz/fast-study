// How the fake Gemini tells an assignment-doc request from a summarize one and what it records of it,
// apart from the server so the unit tests need no port.

// A doc's prompt is recognised by the first line of its instructions file, read from the backend's
// own copy so a reworded prompt is still matched.
export function promptHeads(instructionsDir, readFile) {
  return Object.fromEntries(
    ['intuition', 'solution'].map((doc) => [
      doc,
      readFile(`${instructionsDir}/assignment_${doc}.md`).split(/\r?\n/, 1)[0].trim(),
    ]),
  );
}

const LECTURE = /^<lecture kind="([^"]*)" title="([^"]*)">/;

/** The parts of a generateContent body, flattened across its contents. */
export const partsOf = (body) => (body.contents ?? []).flatMap((content) => content.parts ?? []);

/**
 * The doc ('intuition' | 'solution') the request asks for, or null for any other call: its last text
 * part starts with that doc's prompt head.
 */
export function assignmentDoc(parts, heads) {
  const last = parts.findLast((part) => typeof part.text === 'string');
  if (!last) return null;
  const text = last.text.trimStart();
  return Object.keys(heads).find((doc) => heads[doc] && text.startsWith(heads[doc])) ?? null;
}

/**
 * What a spec asserts on: the mime of each attached file (an Office file's extracted text is
 * uploaded as `text/plain`) and each lecture summary sent.
 */
export function describeCall(doc, parts) {
  const files = [];
  const summaries = [];
  for (const part of parts) {
    if (part.fileData || part.file_data) {
      const data = part.fileData ?? part.file_data;
      files.push(data.mimeType ?? data.mime_type);
    } else if (typeof part.text === 'string') {
      const text = part.text.trim();
      const lecture = LECTURE.exec(text);
      if (lecture) summaries.push({ kind: lecture[1], title: lecture[2], chars: text.length });
    }
  }
  return { doc, files, summaries };
}
