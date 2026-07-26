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
returns `{summary, snippet, ranges}`.

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

`.` is the sentence terminator. A match's window is the sentence containing it plus the one before and
the one after, then **clamped** to ~140 chars before and ~200 after the match, since a summary with few
periods would otherwise dump a whole document into one card.

**If two matches' windows touch or overlap they become one snippet with both occurrences highlighted**,
chained so a run of nearby matches collapses into a single block with N `<mark>`s. Without this, nearby
matches produced separate snippets repeating most of the same text. Merging never crosses a summary, and
relies on `findMatches` order (by summary, ascending index) rather than re-sorting.

A merged block is **deliberately uncapped**: the per-match clamp still bounds each individual window, but
the merged span runs from the first window's start to the last window's end however long that gets. The
alternative — cutting a run in half at some size limit — reintroduces the duplicated context the merge
exists to remove.

Whitespace collapses to single spaces, one regex pass per segment (before the first match, between
consecutive matches, after the last), accumulating offsets as it goes. That is only correct because the
needle is trimmed: a match never begins or ends on whitespace, so no whitespace run can straddle a match
boundary and collapse into two spaces. The view slices the snippet at the returned offsets and wraps each
range in a `<mark>` — never `dangerouslySetInnerHTML`.

## Rendering and paging

**One block per lecture.** `SearchResult` renders a lecture's header row once, followed by every snippet
found in it (`SearchSnippet`), separated by a rule.

Paging is over **findings** — individual occurrences — 20 at a time, and **Show more** adds 20 more.
Visible groups are chosen by walking the full group list and accumulating `matches.length` until the
threshold is reached. 20 is a **minimum, not an exact cut**: the group that crosses it is included whole.
A merged snippet's text extends past a mid-group cut, so stopping there would leave an occurrence visible
in the text but unhighlighted, which reads as a bug; completing the group guarantees every occurrence on
screen is marked. Pages are therefore 20-or-slightly-more findings.

**Show more advances from what is rendered, not from the previous threshold** (`setShown(shownFindings + 20)`).
A group that overshoots the threshold would otherwise be re-selected unchanged by the next threshold and
the click would do nothing — with uncapped merging a single group can hold hundreds of findings, so a
one-letter query made most clicks dead.

Grouping always runs over the *full* match list (it is cheap, ~15ms for 15k matches, and gives the count
line its totals); only `buildHit` is restricted to the visible groups. Those are regrouped by summary on
every render, so a lecture straddling a page boundary keeps one title block that simply grows — a title
can never appear twice. The count line reports findings (`71 results in 16 lectures — showing 21`), where
the "showing" number is the true count rendered and vanishes once everything is shown. The shown count
resets to 20 on any change to the query, the filters, the whole-word toggle or the course, so a new search
never inherits the previous one's expanded page.

## Controls

Course options come from `CourseTreeContext`, archived excluded. The selection is derived, not stored:
the last choice is persisted in `localStorage`, and a stored name that no longer exists (or a tree that
hasn't loaded yet) falls back to the first active course. Filter state — include lectures / include
recitations, both on by default, and the whole-word toggle — is view-local. No match-case (Hebrew has
none) and no regex.

A result never navigates. The **whole header row is one button** that `window.open`s the lecture's
`summary.pdf` — title, kind label and the (decorative) external-link icon are all inside it, so there is
one tab stop and one click target per lecture. It is **disabled, not hidden**, when `CourseTreeContext`
says that lecture has no PDF.
