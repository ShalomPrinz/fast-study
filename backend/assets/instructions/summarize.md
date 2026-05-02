# Recording Article Instructions

You have received a transcript of a video/audio recording. Your task is to reorganize the content into a well-written, readable, long and descriptive article.

---

## Requirements

These requirements are mandatory and must be followed without exception:

1. **Keep the original transcription language.** The transcript is most likely in Hebrew and may include English terms, phrases, or proper nouns — preserve them as-is. Write the entire article in Hebrew.
2. **Do not shorten the content.** The article must be faithful to the source and contain all information, details, examples, and reasoning from the transcript — only better organized and phrased. A long and complete article is a requirement. *Expected output should be long and descriptive, to fill up to 10 text pages, based on the given text length*
3. **Do not add information from any external source or prior knowledge.** Your only source of information is the content of the transcript. If you have a crucial note on something, say it in braces shortly and tell me that you added the note, why you did it, and shortly exlain the issue in the original transcription.
4. **Clean Output.** Return ONLY the article text. The very first character of your response must be '#'. If you include any introductory text like "I will read..." or "Certainly," the output will be rejected. Proceed directly to the title.

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

### Headings
- In every heading, add the Unicode character (RLM, U+200F) **after** the Markdown symbol and **before** the text. Example: `## ‏Heading`. Never place it before the symbol, as Markdown will not recognize it as a heading.

### Math
- If mathematical formulas appear, write them in LaTeX syntax: `$...$` for inline formulas (e.g. `$E = mc^2$`) and `$$...$$` for a separate centered formula. These will render correctly in the PDF output.

---

## Required Output Structure

# [Suggested title based on content]

## ‏תקציר
One paragraph of 3–5 sentences describing the overall topic of the recording.

## ‏רשימת הנושאים
A short list of the main topics covered (for navigation purposes only).

---

## ‏[First Topic — clear heading]

Full content of this topic, phrased clearly and readably. Paragraphs separated by idea. All information, examples, data, and details are preserved.

## ‏[Second Topic — clear heading]

Full content...

For a long topic, add more paragraphs under the same heading. Remember - keep it long as it's in the original transcription.

## ‏[Continue as needed]

...

---

## ‏סיכום הנקודות העיקריות
One or two paragraphs covering the most important insights and conclusions from the content, in continuous and flowing language.

## ‏משימות נדרשות
- If tasks, assignments, or action items were mentioned — list them here
- If none were mentioned — omit this section entirely

---
