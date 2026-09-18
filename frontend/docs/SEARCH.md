# Search page

`/search` — full-text search across one course's `summary.md` files (not transcripts, not `overview/`).

## Client-side corpus, not a server search

`GET /courses/{course}/summaries` returns every non-empty summary of a course in one request.
`useCourseSummaries` fetches it on course selection and keeps it for the session; all matching and
highlighting run locally — no request per keystroke, no index. Justified by size: the largest course is
~760 KB across 35 summaries, cheaper than a debounce. `name` is the lecture directory, so a hit builds its
`summary.pdf` target directly.

`{summaries, loading, error}` is **one** state object so a resolved fetch lands results and clears the flag
in the same render (three `useState`s left a frame with both). The loading line shows only with a
non-empty query — a course switch with an empty box is nothing the user waits on.

**The corpus is never invalidated.** A summary edited mid-session matches its old text until reload;
re-fetching on every notify would re-download the course for edits the searcher isn't looking at.

## Matching — `utils/search.ts`

Three pure phases: `findMatches` returns every occurrence as a position only; `groupMatches` merges them
into groups with the content window their snippet covers; `buildHit` builds strings for one group. The
split is for cost: over the largest course a one-letter Hebrew query finds 15k matches in ~11ms and groups
them in ~15ms, while building every snippet took ~1s and froze the tab on the first keystroke. Grouping
stays eager (the counts need it); strings are built only for the groups on screen.

Case-insensitive substring over a regex-escaped query. Whole-word checks the adjacent characters against
an explicit letter/digit class including Hebrew letters and niqqud, because JS `\b` doesn't know Hebrew
letters. Hebrew punctuation (geresh, gershayim, maqaf, sof pasuq) is outside the class: `״ספר״` is a
whole-word hit for `ספר`.

## Snippets

A match's window is **the sentence containing it**, delimiter to delimiter (`.` `?` `!` `;` `:` `…` or a
line break, which ends a markdown heading, bullet or paragraph), with the line's markdown marker stripped.
There is **no length clamp**: a character cut lands mid-word, and a whole sentence is the smallest unit
that reads correctly — so a delimiter-less paragraph renders in full, and no ellipsis is ever needed.

Overlapping windows merge into one snippet with several `<mark>`s — with sentence windows, exactly the
matches sharing a sentence. Merging never crosses a summary and relies on `findMatches` order.

Whitespace collapses in one pass per segment between matches, accumulating offsets. That is correct only
because the needle is trimmed, so no whitespace run straddles a match boundary. The view slices at the
offsets and wraps each range in `<mark>` — never `dangerouslySetInnerHTML`.

## Rendering and paging

**One card per lecture**: a header row, then that lecture's snippets. Two independent limits: **5
findings per card** and **20 per page**, both counting occurrences, and **a group is never split** —
the group crossing a limit is included whole, since a merged snippet cut mid-group would show an
occurrence unhighlighted. `takeGroups(groups, limit)` is that walk for both.

**The page is a set of whole lectures**, taken until their _collapsed_ counts reach 20. Sizing at the
5-per-card cap keeps the limits independent: expanding a card grows it in place and never pushes a later
lecture off the page. A card's **Show N more** opens that lecture in full (`expanded` is a `Set` of
`kind:name`), revealing exactly the `N` it names.

The page's button advances from what is rendered (`pageCount + 20`), not the previous threshold — a
lecture overshooting the threshold would otherwise be re-selected and the click do nothing — and it is
keyed on lectures remaining, since collapsed cards always leave findings over.

The caption's counts are **two `<Plural>` messages**, since one would need a plural nested in a plural.
The lecture count is bound to a local named `lectures` because Lingui keys the placeholder on the
identifier — renaming it orphans the Hebrew translation. The threshold and `expanded` reset on any change
to query, filters, whole-word or course.

## Controls

**One field** — icon, autofocused query, divider, course picker — so the course reads as the query's
scope. The picker stays a real `<select>` (keyboard-accessible, options are the course list), its own
focus ring suppressed in favour of the field's `:focus-within`. Options exclude archived courses; the
choice is derived — the stored name if it still exists, else the first active course.

Three toggle pills (Lectures, Recitations, Whole word only) are `<button role="switch" aria-checked>`.
No match-case (Hebrew has none) and no regex. A card's Show more is a seam across the card's foot, not a
second button, so it never looks like a rival to the page's pager.

A result never navigates: the **whole header row is one button** opening the lecture's `summary.pdf`
through `services/open.ts` — one tab stop per lecture — **disabled, not hidden**, when the tree has no PDF.
