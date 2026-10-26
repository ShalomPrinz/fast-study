// The files the fake Moodle course serves beyond its PDFs: what setup writes under fixtures/ and
// what the site maps a pluginfile name to. Side-effect-free, so the unit tests import it bare.
import { zip } from './zip.mjs';

// Over Gemini's 10 MB attach limit, so a material of it is refused as `material_too_large`.
export const OVERSIZE_BYTES = 11 * 1024 * 1024;

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const PPTX_SLIDE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>harness fixture slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

/** A minimal valid one-slide .pptx. */
export function minimalPptx() {
  const rels = (target, type) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`;
  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
    '_rels/.rels': rels('ppt/presentation.xml', 'officeDocument'),
    'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels('slides/slide1.xml', 'slide'),
    'ppt/slides/slide1.xml': PPTX_SLIDE,
  });
}

/** Every served file by name: how it is built, its mime type, or the fixture it reuses (`from`). */
export const COURSE_FILES = {
  'lecture3-slides.pptx': {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    build: minimalPptx,
  },
  'diagram.png': { mime: 'image/png', build: () => PNG_1X1 },
  'code-samples.zip': {
    mime: 'application/zip',
    build: () => zip({ 'sample.py': 'print("harness")\n' }),
  },
  'lecture3-audio.mp3': { mime: 'audio/mpeg', from: 'audio.mp3' },
  'big-appendix.pdf': { mime: 'application/pdf', from: 'big-appendix.pdf' },
  'ex1-instructions.pdf': { mime: 'application/pdf', from: 'handout.pdf' },
  'ex1-starter.py': {
    mime: 'text/x-python',
    build: () => Buffer.from('def solve(n):\n    return n\n'),
  },
  'ex2-instructions.pdf': { mime: 'application/pdf', from: 'handout.pdf' },
};

/** The generated fixture over the limit: a valid PDF followed by comment padding. */
export function oversizePdf(pdf) {
  return Buffer.concat([pdf, Buffer.from('%'), Buffer.alloc(OVERSIZE_BYTES, 0x78)]);
}
