---
argument-hint: <service> | all
description: Align a service's docs, CLAUDE.md, and code comments — persist durable knowledge, drop plan/step history.
---

Align the documentation of the service named in `$ARGUMENTS` — a root subfolder — or of every
service when it is `all`. Each service is aligned by its dev subagent, never inline.

If `$ARGUMENTS` is empty or names neither `all` nor an existing root subfolder, list the available
services and stop.

**Most important rule: be concise.** Documentation is short and clear — long is bad. Say the minimal
required, forget nothing important. This rule applies to every step below.

**Focus on ideas, not examples.** Documentation describes behavior and decisions. An example earns
its place only when it is minimal and rare.

**Plan-agnostic.** Docs and comments describe the **current state** and the durable WHY — never
plans, phased steps, or "how we got here" history.

**Documentation-only.** This command changes markdown and comments. It never changes behavior: no
logic edits, no renames, no dead-code removal. Note anything you find and leave it.

**Stay inside the service.** A subagent edits only its own folder. Anything it finds outside —
duplication in the root `CLAUDE.md` or a sibling, a stale reference — goes in its report.

---

## Running on `all`

Subagents run in waves. A wave starts only when the previous one has finished; the subagents inside
a wave run in parallel. The order follows the cross-service doc links: a service is aligned after
every service its docs link to, so each subagent links to names that are already final.

| Wave | Services                                     | Why here                                           |
| ---- | -------------------------------------------- | -------------------------------------------------- |
| 1    | `lib` — `runtime`, `tools`, `logging`                | Linked to by most services; links to none.    |
| 2    | `database`, `backend`, `downloader`, `frontend`      | Link only to `lib`, not to each other.        |
| 3    | `delivery`, then `electron` — sequentially           | Link to each other; see the cycle rule below. |
| 4    | The agent running this command                       | Owns what no service does; see below.         |

In wave 1, one `lib-dev` per package runs sequentially — `logging`, then `runtime`, then `tools`,
since each links to the one before — then one `lib-dev` aligns `lib/CLAUDE.md`.

**Links never break.** A subagent fixes its own outbound links to services aligned before it, and
never renames or deletes a doc that an already-aligned service links to. A heading is a link target
too: renaming one breaks every `#anchor` pointing at it, so the same rule applies. That second rule is what
keeps the `delivery` ↔ `electron` cycle intact: `electron` runs second, repoints its links at
`delivery`'s new docs, and keeps the names `delivery` points at.

**Wave 4** — the agent running this command, not a subagent:

- align the root `CLAUDE.md` against the services' final docs
- update doc references in `.claude/agents/*.md`, `.claude/commands/**`, `.claude/skills/**` and
  `.claude/hooks/README.md`
- apply the cross-service findings the subagents reported

A new cross-service doc link changes the order: add the service to the wave after its link target.

---

## Services with sub-folder docs

Most services keep one `docs/` next to their `CLAUDE.md`. These instead keep docs per sub-package,
with a parent `CLAUDE.md` that points at the children and does not restate them:

- **`downloader/`** — `auto/` and `server/` each own a `CLAUDE.md` and a `docs/`. `extension/` is
  out of scope: leave its code, comments and its section of `downloader/CLAUDE.md` untouched.
- **`lib/`** — `runtime/`, `tools/` and `logging/` each own a `CLAUDE.md`, shared by their `py/` and
  `js/` halves, and a `docs/` only when Step 1's sizing rule earns one. `lib/CLAUDE.md` covers what
  holds across packages.

In the steps below, "the service" means each sub-package in turn, then the parent.

## `delivery/`

- **`kitchen-sink.md` is a test fixture** — production content the smoke suite renders. Never edit it.
- **`.github/workflows/` is out of scope**, though `delivery-dev` owns it.

---

## Step 1 — Write the docs

Base the docs on the service's own code and markdown only, unless the prompt points elsewhere. Move
the durable, non-obvious knowledge into `<service>/docs/*.md`. Each doc holds the full logic worth
persisting for one concern — detailed, not bloated. Never restate what the code plainly says.

- **One doc per big concern**, sized by what that concern actually carries. One doc is a fine
  outcome for a small service; do not pad it into five, and do not merge two real concerns to look
  tidy. A concern with a page of hard-won knowledge earns a doc; a concern with two sentences is a
  line in `CLAUDE.md`.
- **Around 150 lines is the ceiling** — Step 2 enforces it.
- Delete or rewrite freely, within the link rule above. A stale title is as misleading as stale
  prose, and rewriting beats patching a doc whose subject has moved.
- Filenames are upper case and single-worded (`PDF.md`). Two words hyphenate (`PDF-FONTS.md`)
  and are a sign the split is wrong.
- **Testing is a concern like any other**: how to run the suite, where tests live and how they
  mirror the source, the conventions a new test follows, and what is deliberately left untested and
  why. It gets `docs/TESTING.md` only when it carries enough to earn one.
- **`README.md` files are user-facing and out of scope**. Leave them as they are; link to them from
  `CLAUDE.md` or a doc instead of restating their content.

## Step 2 — Compress the existing docs

Every doc, the ones you just wrote and the ones already there, gets a reduction pass. Existing docs
drift long: they accumulate narration, restate `CLAUDE.md`, and keep examples that stopped earning
their place. Read each in full and cut it to what a reader could not get from the code.

Cut:

- prose that restates the code, and any step-by-step walkthrough of what a function does
- history — migration notes, "previously / now", anything dated by a change rather than by behavior
- an explanation that also appears in `CLAUDE.md` or another doc — see the ownership rule below
- examples past the single minimal one that makes a rule concrete, and code blocks over ~10 lines
- throat-clearing: intro paragraphs, section preambles, closing summaries, hedging

Never trade these away for brevity:

- the WHY behind a non-obvious choice, and the alternative that was rejected
- gotchas, invariants, and empirically verified constraints — versions, platform behavior, tool quirks
- what is deliberately *not* done, and the signal that would justify doing it

**Ownership.** A cross-service fact is explained once, by the service that implements it; every
other service mentions it in one line and links there. The root `CLAUDE.md` keeps the launch-contract
names, not their reasoning. A mention is not a duplicate — only a second explanation is.

A doc that lands under ~30 lines after the cut is really a `CLAUDE.md` section: fold it in and delete
the file. One still over the ~150-line ceiling is either two concerns or still narrating — split it
or cut again. A doc that has never had this pass usually loses a third or more.

## Step 3 — Thin the code comments

The full logic lives in the docs; comments carry only what a reader of *this line* would otherwise
get wrong.

- Prose comments compress to one line, two at most. Delete any that restate the code.
- **Leave an anchor.** When a comment's reasoning moves into a doc, the code keeps a one-line
  pointer naming that doc (`# … — see docs/PDF.md`). Stripping the WHY without a pointer makes the
  knowledge unfindable from the place that needs it, which is worse than the bloat.
- **Typed annotations are not prose and are exempt** from the line limit — JSDoc `@typedef`,
  `@param`, `@returns`, type aliases. They are machine-read contracts; the editor and the
  typechecker consume them. Trim their English padding, keep every type.
- **Directive comments are untouchable** — `noqa`, `type: ignore`, `eslint-disable`,
  `@ts-expect-error`, `prettier-ignore`, and the like. They change what the tools do; keep each one
  and its same-line reason exactly as they are.
- **Tests are out of scope.** A test comment names the case being pinned and has no home in a doc.
  Leave them; the testing doc covers the conventions around them, not the individual cases.

## Step 4 — CLAUDE.md structure

Every service has a `CLAUDE.md`, always — including one whose whole story fits on a page. It states
what the service is, how to run and test it, its rules and invariants, a table pointing at `docs/`,
and a link to its `README.md` when one exists. Doc links are plain relative links, never `@`-prefixed —
`@` inlines the file into every session.

## Step 5 — Verify

Run `npm run lint` from the repo root and the service's test suite, using the test command its
`CLAUDE.md` gives (e.g. `cd database && uv run pytest tests/ -q`). Nothing here should change behavior, so a failure means
an edit went too far — fix it before reporting. A suite that cannot run on this machine (a
Windows-only smoke suite, an Electron run under WSL) is reported as not run, never as passed.

---

When done, tell the user (in your response, not in any file) a short summary of what you changed,
plus anything you deliberately deferred or left out. On `all`, that is one summary across every
wave, with each subagent's cross-service findings and what wave 4 did with them.
