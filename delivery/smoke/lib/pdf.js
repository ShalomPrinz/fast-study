import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Every page's text, concatenated. Only text extraction runs, so no canvas is needed. */
export async function pdfText(bytes) {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(content.items.map((item) => item.str ?? '').join(''));
    }
    return pages.join('\n');
  } finally {
    await task.destroy();
  }
}

/** Whether a phrase survived into the PDF's text, whitespace ignored — a line break can join or
 *  split words, and what the check is after is that no glyph was dropped. */
export function carriesPhrase(text, phrase) {
  const flat = (value) => value.replace(/\s+/g, '');
  return flat(text).includes(flat(phrase));
}
