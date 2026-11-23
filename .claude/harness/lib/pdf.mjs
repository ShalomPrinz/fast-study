// A hand-built valid PDF, side-effect-free so the unit tests import it bare: pypdf and pdf.js both parse it.

/** A one-page PDF with a real xref table and a two-level outline (`title` with `child` under it). */
export function minimalPdf({
  text = 'harness fixture handout',
  title = 'Summary',
  child = 'Details',
} = {}) {
  const stream = `BT /F1 18 Tf 72 760 Td (${text}) Tj ET`;
  const bodies = [
    '<</Type/Catalog/Pages 2 0 R/Outlines 6 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    '<</Type/Outlines/First 7 0 R/Last 7 0 R/Count 2>>',
    `<</Title(${title})/Parent 6 0 R/Dest[3 0 R/Fit]/First 8 0 R/Last 8 0 R/Count 1>>`,
    `<</Title(${child})/Parent 7 0 R/Dest[3 0 R/Fit]>>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = bodies.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) out += `${String(at).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<</Size ${bodies.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
