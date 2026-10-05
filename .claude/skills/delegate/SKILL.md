---
name: delegate
description: Turn a task into a self-contained brief and hand it to the owning service agent (backend-dev, database-dev, frontend-dev, downloader-dev, lib-dev, electron-dev, delivery-dev, site-dev). Use whenever the main session routes work to a service subagent, which CLAUDE.md requires for every change inside a service.
---

The main session routes; service agents do the work (CLAUDE.md, Service subagents). A subagent starts cold: it knows only CLAUDE.md, its own agent file and the brief. Everything else it needs must be in the brief.

### 1. Pick the owner

The agent whose list in `.claude/ownership.json` covers the files the task changes owns it (a trailing `/` is a folder, else one file). Paths no agent covers — the root `CLAUDE.md`, `docs/`, `.claude/`, root config — are the main session's own: edit those yourself, do not delegate them.

A task that touches two owners becomes one brief per agent, run in sequence, with the side that defines the contract first: `lib/` before its consumers (the launcher included), `database/` before its callers, `backend/` before `frontend/` and `downloader/`, and `delivery/` and `site/` last, since they describe what the others own. Pass the first agent's report into the second brief.

### 2. Scope it to what the user asked

Brief exactly the items the user named. If the request is ambiguous, ask before delegating — the root CLAUDE.md's "always ask" rule holds for a brief too. Delegated scope creep is expensive to undo.

### 3. Write the brief

Keep it short and concrete, with paths rather than explanations of the code:

```
Goal: <one sentence: the outcome, not the steps>
Context: <what exists now, with paths; decisions the user already made; why>
Owning doc: <the service CLAUDE.md or docs/ page to update in the same change; a docs/ERROR-CODES.md row for a new code>
Do: <numbered items, each checkable>
Out of scope: <what not to touch; other owners' code; the user's unrelated dirty files>
Verify: <commands to run; the expected result, e.g. suite green, app-harness flow shown working>
Report: <only what this task needs beyond the report core in CLAUDE.md; omit if nothing>
```

Name the user's explicit decisions in Context so the agent does not re-open them. In worktree mode, name the worktree path as the tree to work in. Name any risky step and what to do instead, for example "if a consumer suite fails, stop and report; do not edit that service".

### 4. Launch and wait

Launch with the Agent tool and the agent's `subagent_type`, one task at a time. Do not read the service's source or doc set yourself while it runs. If the user narrows the scope mid-run, message the agent at once with what to drop and what to revert.

### 5. After the report

- Verify with commands only: `git status --short`, `git diff --stat`, and the service's suite when the report does not quote it.
- Check the report for deviations and decisions, and relay them to the user.
- Route each follow-up the report names for another owner as its own brief.
- Commit with the `git-commit` skill, which runs the `reviewer` first.
