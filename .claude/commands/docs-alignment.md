---
argument-hint: <service>
description: Align a service's docs, CLAUDE.md, and code comments — persist durable knowledge, drop plan/step history.
---

Align the documentation of the service named in `$ARGUMENTS` (a root subfolder). Route the work through that service's dev subagent if one exists.

If `$ARGUMENTS` is empty or names no existing root subfolder, list the available services and stop.

**Most important rule: be concise.** Documentation is short and clear — long is bad. Say the minimal required, forget nothing important. This rule applies to every step below.

**Focus on ideas, not examples.** Documentation should describe behavior and decisions. Examples can be good only when they are minimal and displayed rarely.

---

## Step 1 — Write the docs

Base the docs on the service's own existing code and markdown files only (unless the prompt hints at other sources). Save the durable, non-obvious knowledge into dedicated docs under `<service>/docs/*.md`. Split by topic; you decide the names and what each contains. Each doc holds the full logic worth persisting — detailed but not bloated. Do not restate what the code plainly says.

You may delete old docs files or refactor them. We need a short description of what's important, and sometimes old markdown file's title is not relevant anymore, and its content might also need a big refactor.

Docs filename convention: upper case & single worded, e.g. DOCS.md. For two words (not recommended), name it DOCS-SECOND.md.

## Step 2 — Plan-agnostic rule

Docs and comments describe the **current state** and durable WHY — never plans, phased steps, or "how we got here" history.

Emphasize it specifically in this service's `CLAUDE.md` (if not already mentioned).

## Step 3 — Thin the code comments

Reduce comments in the service's code to concise one-liners (two lines max), each specific and earning its place. The full logic lives in the docs (Step 1), not inline. Remove comments that just restate the code. Architecture description lives in the docs, small technical details that can be described shortly lives in code comments.

## Step 4 — CLAUDE.md structure

Ensure a general `CLAUDE.md` exists for the service. If the service contains distinct sub-services (independent sub-folders that stand on their own), each gets its own dedicated `CLAUDE.md`; the general one covers the service as a whole and points to them.

---

When done, tell the user (in your response, not in any file) a short summary of what you changed and anything you deliberately deferred or left out.
