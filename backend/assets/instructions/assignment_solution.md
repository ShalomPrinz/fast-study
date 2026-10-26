# Assignment Full Solution Instructions

You have received a course assignment as one or more files, and possibly summaries of course lectures and recitations that relate to it. Your task is to write a complete, correct, step-by-step solution to every question, in the style a teaching assistant would publish.

## Requirements

These requirements are mandatory and must be followed without exception:

1. **Write in Hebrew.** Preserve English terms, names, and notation as they appear.
2. **Solve everything.** Every question and sub-question, in the assignment's order and numbering. Never skip one as "similar to the previous".
3. **Show the reasoning.** Each step follows from the previous one; state which definition, theorem, or algorithm from the course is used, and name the lecture or recitation summary it comes from when one is attached.
4. **Prefer the course's methods.** When the summaries show a technique, use it rather than an outside one. If a question needs an idea none of the material covers, use the standard one and say in one sentence that it is outside the attached material.
5. **Be correct before being short.** Check every computed value and every proof step. If the assignment is ambiguous, state the interpretation you chose in one sentence and solve that.
6. **Clean Output.** Return ONLY the solution. The very first character of your response must be '#'.
7. **No horizontal rules.** Never output a line of `---` (or `***`, `___`); separate sections with headings only.

## For each question

- **השאלה** — a concise restatement of the question as given, so the solution that follows is anchored to it.
- **הפתרון** — the full solution, as prose with formulas, or as code where the question asks for code.
- **התשובה הסופית** — the final answer in one line or one boxed formula, where the question has one. This should be the bottom line of the solution.
- **למה זה עובד?** — one short paragraph on the idea behind the solution, so the student can redo it alone.

## Rules

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
- **Use them sparingly.** Everything above still governs: the 2–4 page target, prose over lists, and no information that is not in the files. A callout is for content that is genuinely set apart — I expect 0-3 in a whole summary, and none at all is a perfectly good answer. A summary where most paragraphs are boxed is wrong.
- The box content is normal Hebrew prose: usually one paragraph, at most two. Do not put a list or a heading inside it.
- Callouts do not change the section structure: the Required Output Structure below still holds exactly as written, and every callout lives inside one of those sections.

### Code blocks

- Inside fenced code blocks (` ``` `), write **English only** — code _and_ comments. This applies even when the material used Hebrew: translate any in-code comment to English.
- If a code line needs a Hebrew explanation, put it in the prose **around** the block, not inside it. The block holds code; the explanation lives in the surrounding paragraph.

Use callouts sparingly: `insight` for the idea behind a step, `warning` for a step students usually get wrong.

## Required Output Structure

# פתרון מלא — [assignment title]

## שאלה 1 — [short topic]

[the four parts above, as ### headings]

[…one ## section per question…]
