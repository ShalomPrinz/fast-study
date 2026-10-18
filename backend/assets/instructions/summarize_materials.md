# Lecture Material Article Instructions

You have received the material of a lecture as one or more PDF documents — slides, lecture notes, or handouts. There is no recording or transcript of the lecture. Your task is to turn this material into a well-written, clear, and well-organized article.

---

## Requirements

These requirements are mandatory and must be followed without exception:

1. **Write in Hebrew.** The material is most likely in Hebrew and may include English terms, phrases, or proper nouns — preserve them as-is. Write the entire article in Hebrew, even where a document is in English.
2. **Be faithful, but tight.** Preserve all ideas, definitions, examples, derivations, names, and numbers from the PDFs. Slides are terse: connect their bullet points into explanatory prose, but explain only what the material itself states or directly shows — never fill a gap with what the lecturer probably said. Merge content that repeats across slides or across documents, and skip pure navigation (title slides, agendas, "questions?" slides, page headers and footers). **Target 2–4 PDF pages. Hard maximum: 5 pages, and only for unusually dense material.** If you find yourself exceeding 4 pages, tighten before adding. Faithfulness is about _which ideas_ appear, not about reproducing every line.
3. **Several documents are one lecture.** When more than one PDF is attached, they are parts of the same lecture: combine them into one article organized by topic, not one section per file.
4. **Do not add information from any external source or prior knowledge.** Your only source of information is the content of the PDFs. If you have a crucial note on something, say it in braces shortly and tell me that you added the note, why you did it, and shortly explain the issue in the original material.
5. **Clean Output.** Return ONLY the article text. The very first character of your response must be '#'. If you include any introductory text like "I will read..." or "Certainly," the output will be rejected. Proceed directly to the title.

---

## Rules

### Language and Style

- Write in correct, readable Hebrew.
- Text extracted from slides may be fragmented or out of order; reconstruct it into complete sentences without changing its meaning.
- Preserve all examples, numbers, names, technical details, formulas, and important quotes.
- Describe a diagram, chart, or table only through what its labels and the surrounding text state; do not invent values it does not show.

### Structure and Flow

- Mark each new topic of the material with a new heading.
- **Prefer continuous paragraphs and flowing prose over lists.** Convert lists into well-written, naturally phrased prose. Use lists only when there is no practical alternative — for example, a sequence of ordered technical steps where order is critical, or a set of items that cannot be naturally linked together.
- Leave at least one blank line before every list (whether bullet `-` or numbered `1.`), even if the list immediately follows a heading or paragraph.

### Separators

- The output must contain **exactly two** horizontal-rule separators, and only at the two positions shown in the Required Output Structure: (1) between the תקציר section and the first topic, and (2) between the last topic and the סיכום section.
- Each separator is a line containing only three hyphens (`---`) with a blank line above and below. It is a Markdown horizontal rule — never write the words "Required line separator" or any description of it.
- Do **not** insert `---` anywhere else: not between paragraphs, not between topics, not between subsections, not before/after the title, תקציר, or משימות נדרשות.

### Math

- If mathematical formulas appear, write them in LaTeX syntax: `$...$` for inline formulas (e.g. `$E = mc^2$`) and `$$...$$` for a separate centered formula. These will render correctly in the PDF output.
- Math `$...$` is **only** for actual formulas/expressions. Function names, system calls, and identifiers (e.g. `_exit`, `_Exit`, `malloc`, `O_RDONLY`, `x86_64`) are **code**, not math — wrap them using the "Code blocks" section rules, never with `$...$`.
- Note: inside math, a leading underscore is the subscript operator, so `$_exit$` would render as a subscript "e" followed by "xit".

### Callout boxes

- A short passage that deserves to stand apart from the prose may be wrapped in a callout, which renders as a coloured box in the PDF. The syntax is a line with `:::` and the class, the content, then a line with only `:::`:

  ```
  ::: [definition | warning | insight]
  [Box content]
  :::
  ```

- There are **exactly three** classes, and no others: 
  1. `definition` - a formal definition of a term
  2. `warning` - a caveat the material stresses, a common mistake, an exam note
  3. `insight` - a non-obvious key idea worth remembering.
  Any other class name renders as ordinary prose with no box.
- The box carries no title, so do not add a heading or a label line inside it.
- Box content should be new content. *Don't repeat existing text inside a box*.
- **Use them sparingly.** Everything above still governs: the 2–4 page target, prose over lists, and no information that is not in the PDFs. A callout is for content that is genuinely set apart — I expect 0-3 in a whole summary, and none at all is a perfectly good answer. A summary where most paragraphs are boxed is wrong.
- The box content is normal Hebrew prose: usually one paragraph, at most two. Do not put a list, a heading, or a `---` inside it.
- Callouts do not change the section structure: the `---` separator rules and the Required Output Structure below still hold exactly as written, and every callout lives inside one of those sections.

### Code blocks

- Inside fenced code blocks (` ``` `), write **English only** — code _and_ comments. This applies even when the material used Hebrew: translate any in-code comment to English.
- If a code line needs a Hebrew explanation, put it in the prose **around** the block, not inside it. The block holds code; the explanation lives in the surrounding paragraph.

---

## Required Output Structure

# [Suggested title based on content]

## תקציר

One paragraph of 3–5 sentences describing the overall topic of the lecture.

---

## [First Topic — clear heading]

Full content of this topic, phrased clearly and readably. Paragraphs separated by idea. All information, examples, data, and details are preserved.

## [Second Topic — clear heading]

Full content...

For a substantial topic, add more paragraphs under the same heading — but only as many as the content genuinely requires.

## [Continue as needed]

...

---

## סיכום

One or two paragraphs covering the most important insights and conclusions from the content, in continuous and flowing language.

## משימות נדרשות

- If the material lists tasks, assignments, or action items — list them here
- If it lists none — omit this section entirely
