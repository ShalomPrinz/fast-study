# Recording Article Instructions

You have received a transcript of a video/audio recording. Your task is to reorganize the content into a well-written, clear, and well-organized article.

---

## Requirements

These requirements are mandatory and must be followed without exception:

1. **Keep the original transcription language.** The transcript is most likely in Hebrew and may include English terms, phrases, or proper nouns — preserve them as-is. Write the entire article in Hebrew.
2. **Be faithful, but tight.** Preserve all ideas, examples, derivations, names, numbers, and the professor's emphases from the transcript — but merge redundant phrasing, drop filler ("um", restarts, asides that go nowhere), and prefer tight prose over exhaustive reproduction. **Target 2–4 PDF pages. Hard maximum: 5 pages, and only for unusually dense lectures with a lot of distinct material.** If you find yourself exceeding 4 pages, tighten before adding. Faithfulness is about _which ideas_ appear, not about reproducing every sentence.
3. **Professor notes and personal opinions.** Whenever the speaker expresses a personal view, emphasizes something from their own experience, warns the class, or shares a non-textbook insight — keep that sentence or clause
4. **Do not add information from any external source or prior knowledge.** Your only source of information is the content of the transcript. If you have a crucial note on something, say it in braces shortly and tell me that you added the note, why you did it, and shortly explain the issue in the original transcription.
5. **Clean Output.** Return ONLY the article text. The very first character of your response must be '#'. If you include any introductory text like "I will read..." or "Certainly," the output will be rejected. Proceed directly to the title.

---

## Rules

### Language and Style

- Write in correct, readable Hebrew.
- Fix spelling and grammar errors introduced by automatic transcription.
- If the speaker repeats themselves unnecessarily, merge the repetitions into one clean paragraph.
- Preserve all examples, numbers, names, technical details, and important quotes.

### Structure and Flow

- If the speaker moves between topics, mark each transition with a new heading.
- **Prefer continuous paragraphs and flowing prose over lists.** Convert lists into well-written, naturally phrased prose. Use lists only when there is no practical alternative — for example, a sequence of ordered technical steps where order is critical, or a set of items that cannot be naturally linked together.
- Leave at least one blank line before every list (whether bullet `-` or numbered `1.`), even if the list immediately follows a heading or paragraph.

### Separators

- The output must contain **exactly two** horizontal-rule separators, and only at the two positions shown in the Required Output Structure: (1) between the תקציר section and the first topic, and (2) between the last topic and the הערות אישיות section.
- Each separator is a line containing only three hyphens (`---`) with a blank line above and below. It is a Markdown horizontal rule — never write the words "Required line separator" or any description of it.
- Do **not** insert `---` anywhere else: not between paragraphs, not between topics, not between subsections, not before/after the title, תקציר, סיכום, or משימות נדרשות.

### Headings

- In every heading, add the Unicode character (RLM, U+200F) **after** the Markdown symbol and **before** the text. Example: `## ‏Heading`. Never place it before the symbol, as Markdown will not recognize it as a heading.

### Math

- If mathematical formulas appear, write them in LaTeX syntax: `$...$` for inline formulas (e.g. `$E = mc^2$`) and `$$...$$` for a separate centered formula. These will render correctly in the PDF output.
- Math `$...$` is **only** for actual formulas/expressions. Function names, system calls, and identifiers (e.g. `_exit`, `_Exit`, `malloc`, `O_RDONLY`, `x86_64`) are **code**, not math — wrap them using the "Code blocks" section rules, never with `$...$`.
- Note: inside math, a leading underscore is the subscript operator, so `$_exit$` would render as a subscript "e" followed by "xit".

### Code blocks

- Inside fenced code blocks (` ``` `), write **English only** — code _and_ comments. This applies even when the lecture used Hebrew: translate any in-code comment to English.
- If a code line needs a Hebrew explanation, put it in the prose **around** the block, not inside it. The block holds code; the explanation lives in the surrounding paragraph.

---

## Required Output Structure

# [Suggested title based on content]

## ‏תקציר

One paragraph of 3–5 sentences describing the overall topic of the recording.

---

## ‏[First Topic — clear heading]

Full content of this topic, phrased clearly and readably. Paragraphs separated by idea. All information, examples, data, and details are preserved.

## ‏[Second Topic — clear heading]

Full content...

For a substantial topic, add more paragraphs under the same heading — but only as many as the content genuinely requires.

## ‏[Continue as needed]

...

---

## ‏הערות אישיות והדגשות המרצה

A dedicated paragraph (or paragraphs) collecting all the professor's personal opinions, non-textbook insights, warnings, and emphases from throughout the lecture.

## ‏סיכום

One or two paragraphs covering the most important insights and conclusions from the content, in continuous and flowing language.

## ‏משימות נדרשות

- If tasks, assignments, or action items were mentioned — list them here
- If none were mentioned — omit this section entirely
