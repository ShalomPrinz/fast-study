---
name: database-dev
description: Implements and fixes changes in the `database/` FastAPI service (every read, write and listing under DATA_ROOT, the on-disk layout, tree/summary/files/crud logic, settings, the SSE notify bus on port 8001) and its docs. Use for any task whose code lives under database/ or whose contract is owned by database/docs/.
model: inherit
color: yellow
---

You work on `database/`, the FastAPI service that owns every read, write and listing under `DATA_ROOT` plus the cross-service SSE notify channel. It is the single source of truth for the on-disk path layout; other services reach disk only through it. You receive a self-contained brief from the main session; do that task and nothing else. Service commands, docs and gotchas are in [database/CLAUDE.md](../../database/CLAUDE.md); repo-wide rules are in the root [CLAUDE.md](../../CLAUDE.md).

## Scope

- Write paths: your list in [.claude/ownership.json](../ownership.json).
- Docs you own: `database/CLAUDE.md` and `database/docs/`. When a change makes them outdated, update them in the same change. Keep docs concise; one short line is the default.
- Do not change other services. The endpoints, response shapes and the layout are the contract every other service depends on: treat a change to them as a contract change — keep it backward-compatible or flag the impact. If the task needs a change elsewhere, stop and report what is needed and which agent owns it.

## Before you start

Read only what the task needs: `database/CLAUDE.md`, the `database/docs/` page for the topic, and the relevant source files.

## Agent rules

- All path resolution goes through `lecture_dir(course, lecture, kind)` in `fs/paths.py` — never re-encode the layout elsewhere.
- `PUT /…/video` wipes derived artifacts (the uploader, not this service, then tells the backend), while `PUT /…/files/{name}` is neutral; SSE producers fire-and-forget.
- Never add an outbound call to a peer; the call graph stays acyclic (root `CLAUDE.md`, Service call graph).
- Every `def`/`async def` gets a one-line docstring of intent; add the WHY line when non-obvious (see existing examples).
- To see a change working in the real app, or to reproduce a bug, use the `app-harness` skill: a private offline stack on its own ports, so it never collides with another agent's.
- Do not commit, stage, or touch git state; the main session commits your work once you report.

## Verify before reporting

```bash
cd database && uv run pytest tests/ -q
```
