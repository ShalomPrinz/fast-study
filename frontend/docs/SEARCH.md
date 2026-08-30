# Search page

`/search` — full-text search across one course's summaries. Corpus is `summary.md` only: not transcripts,
not course-level `overview/` files.

## Client-side corpus, not a server search

`GET /courses/{course}/summaries` returns every non-empty summary of a course as
`{summaries: [{name, kind, content}]}` in one request. `useCourseSummaries` fetches it on course
selection, keeps it in a `useRef` map for the session, and all matching, filtering and highlighting run
locally — no request per keystroke, no index, no server-side search. This is justified by size: the
largest course is ~760 KB across 35 summaries, so the whole corpus is cheaper than a debounce.

`name` is the bare lecture/recitation directory name — the same identifier every lecture-scoped route
takes — so a hit builds `fileUrl(course, name, 'summary.pdf', kind)` directly.

`useCourseSummaries` holds `{summaries, loading, error}` in **one** state object, so a resolved fetch lands
the results and clears the flag in the same render; as three separate `useState`s the `.then`/`.finally` pair
left a frame in which the loading line sat above the new results and then vanished.

The loading line shows only while the query box is non-empty. Switching course with an empty box is nothing
the user is waiting on, and on a cached-corpus-sized fetch a flash was all the line ever communicated.

**The corpus is never invalidated.** A summary edited elsewhere mid-session keeps matching its old text
until the page is reloaded. Deliberate: the staleness window is one visit and re-fetching on every SSE
notify would re-download the course for edits the searcher isn't looking at.

## Matching — `utils/search.ts`

Three pure functions, React-free and dependency-free, so the module is unit-testable on its own.

`findMatches(summaries, query, { wholeWord })` scans the whole corpus and returns **every** occurrence as
a position only — `{summary, index, end}`, the summary held by reference so no content is copied.
Case-insensitive substring; the query is regex-escaped before it becomes a `RegExp`.

`groupMatches(matches)` turns those positions into `MatchGroup`s — each a run of matches plus the
`{from, to}` content window their shared snippet will cover. Still position-only.

`buildHit(group)` is the only phase that builds strings: it slices the window, collapses whitespace and
returns `{summary, snippet, ranges}`. A snippet carries no leading or trailing ellipsis — it is a
complete sentence, so there is nothing to signal as cut off.

The split exists because the phases differ by two orders of magnitude: over the largest course, the
one-letter query `ר` finds 15k matches in ~11ms and groups them in ~15ms, while building every snippet
cost ~1s and froze the tab on the first letter of any Hebrew word. Window computation is cheap enough to
stay eager (grouping can't be decided without it); string assembly is built only for the groups on screen.

Whole-word is implemented by inspecting the characters adjacent to the match against an explicit
letter/digit class that includes Hebrew letters and niqqud — JS `\b` doesn't recognise Hebrew letters as
word characters, so anchoring the RegExp would match every Hebrew word. Hebrew punctuation (geresh,
gershayim, maqaf, sof pasuq) is deliberately outside the class: it separates words, so `״ספר״` is a
whole-word hit for `ספר`.

## Snippet window and overlap merging

A match's window is **the sentence containing it** — from the delimiter before the match to the delimiter
after it, inclusive. Delimiters are `.` `?` `!` `;` `:` `…` and any line break; a newline is what ends a
heading, a bullet or a paragraph in markdown, and the markdown marker opening the line (`#`, `-`, `*`,
`>`) is stripped off the snippet's front.

There is **no length clamp**. Snippets are always whole words and whole sentences, so a delimiter-less
paragraph renders in full rather than being cut at a character count — the previous ~140/200-char clamp
severed words mid-token, which is what this replaces.

**If two matches' windows overlap they become one snippet with both occurrences highlighted**, chained so
a whole run collapses into a single block with N `<mark>`s. With sentence-aligned windows this means
exactly the matches that share a sentence: two distinct sentences never overlap, so they stay separate
cards. Merging never crosses a summary, and relies on `findMatches` order (by summary, ascending index)
rather than re-sorting.

Whitespace collapses to single spaces, one regex pass per segment (before the first match, between
consecutive matches, after the last), accumulating offsets as it goes. That is only correct because the
needle is trimmed: a match never begins or ends on whitespace, so no whitespace run can straddle a match
boundary and collapse into two spaces. The view slices the snippet at the returned offsets and wraps each
range in a `<mark>` — never `dangerouslySetInnerHTML`.

## Rendering and paging

**One card per lecture.** `SearchResult` renders a lecture's header row once — file icon, name, a neutral
`.chip` reading `lecture`/`recitation`, and the open glyph — followed by that lecture's visible snippets
(`SearchSnippet`), indented to clear the icon column and parted by `--line-soft` rules. Matches wear
`--highlight`.

Two independent limits bound what is on screen: **5 findings per lecture card** and **20 findings per page**.
Both count findings — individual occurrences — and both obey the same rule: **a group is never split**, so the
group crossing a limit is included whole and each limit is a minimum rather than an exact cut. A merged
snippet's text extends past a mid-group cut, so stopping there would leave an occurrence visible in the text
but unhighlighted, which reads as a bug; completing the group guarantees every occurrence on screen is marked.
`takeGroups(groups, limit)` is that walk, shared by both limits.

**The page is a set of whole lectures.** Groups are bucketed into consecutive-summary lectures once, then
lectures are taken in order until their *base-capped* counts reach 20. Sizing the page at the 5-per-lecture
cap — never at the expanded counts — is what keeps the two limits independent: expanding a card grows it in
place and can never push a later lecture off the page. Bucketing up front also replaces the old regroup-on-
render step, so a title still can never appear twice.

A card's own **Show more snippets** raises that lecture's threshold by 5, keyed by `kind:name` in an
`expanded` map. Both buttons **advance from what is rendered, not from the previous threshold**
(`count + 5` in a card, `pageCount + 20` at the foot). A group that overshoots the threshold would otherwise
be re-selected unchanged by the next threshold and the click would do nothing — with uncapped merging a single
group can hold hundreds of findings, so a one-letter query made most clicks dead. The page's button is keyed
on **lectures** remaining, not findings remaining: with cards collapsed there are always findings left over,
and a button that re-renders the same page of lectures does nothing.

Grouping always runs over the *full* match list (it is cheap, ~15ms for 15k matches, and gives the count line
its totals); only `buildHit` is restricted to the groups actually rendered — at most 5-or-slightly-more per
card. The counts sit at the end of the `Results` caption and report findings
(`71 results in 16 lectures — showing 21`), where the "showing" number is the true count rendered, in-card
expansions included, and vanishes once everything is shown. They are **two `<Plural>` messages, not one**: a
single message would need a plural nested in a plural, and each half already reads as a phrase on its own.
The lecture count is bound to a local literally named `lectures` because Lingui keys the placeholder on the
identifier — renaming it silently orphans the Hebrew translation. Both the page threshold and the `expanded`
map reset on any change to the query, the filters, the whole-word toggle or the course, so a new search never
inherits the previous one's expanded cards.

## Controls

The page leads with **one field** — search icon, the autofocused query input, a divider, and the course
picker — so the course reads as scope on the query rather than a control of its own. Switching course
mid-search is rare, which is what earns the picker its place inside. It stays a real `<select>`: it is
keyboard-accessible and its option list is already the course list. Its own focus ring is suppressed — the
black box it drew around the picker was redundant next to `.search-field:focus-within`, which already accents
the whole field's border.

Course options come from `CourseTreeContext`, archived excluded. The selection is derived, not stored:
the last choice is persisted in `localStorage`, and a stored name that no longer exists (or a tree that
hasn't loaded yet) falls back to the first active course.

Under the field sit three **toggle pills** — Lectures, Recitations, Whole word only — each a
`<button role="switch" aria-checked>` rather than a styled `<div>`, so space and enter work. All three are
view-local; the two kind filters default on. No match-case (Hebrew has none) and no regex. A query that
matches nothing renders the shared `.empty-state` card. The page's **Show more** is the full-width ghost
button; a card's **Show more snippets** is a quiet accent-text button on the snippet inset, so the two never
read as rival pagers.

A result never navigates. The **whole header row is one button** that `window.open`s the lecture's
`summary.pdf` — icon, title, kind chip and the (decorative) external-link glyph are all inside it, so
there is one tab stop and one click target per lecture. It is **disabled, not hidden**, when
`CourseTreeContext` says that lecture has no PDF, and the glyph is then replaced by a muted `no PDF`.
