import { formatsSnapshot } from '../../lib/formats.js';
import { evidence } from '../../lib/mac.js';
import { carriesPhrase, pdfText } from '../../lib/pdf.js';
import { services } from '../../lib/session.js';
import { COURSE, LECTURE, PDF_PHRASE } from '../../lib/suite.js';
import pdfForReal from '../06-pdf.js';

const FIGURE_PHRASE = 'Good X';

// The shared body, then what it saw as evidence — also when it failed, which is when it matters.
export default async function pdf() {
  try {
    await pdfForReal();
  } finally {
    const lines = [`latex/formats/: ${JSON.stringify(formatsSnapshot().map((f) => f.name))}`];
    try {
      const bytes = await services.db.bytes(COURSE, LECTURE, 'summary.pdf');
      const text = await pdfText(bytes);
      lines.push(
        `summary.pdf: ${bytes.length} bytes, ${text.length} characters of text`,
        `Hebrew phrase present: ${carriesPhrase(text, PDF_PHRASE)}`,
        `PDF figure text "${FIGURE_PHRASE}" present: ${carriesPhrase(text, FIGURE_PHRASE)}`,
      );
    } catch (error) {
      lines.push(`summary.pdf unreadable: ${error.message}`);
    }
    evidence('8. the PDF, for real', lines.join('\n'));
  }
}
