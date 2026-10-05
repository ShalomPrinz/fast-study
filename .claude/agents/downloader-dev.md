---
name: downloader-dev
description: Implements and fixes changes in `downloader/` (the Chrome MV3 extension, the express helper server that captures videos and PDFs with curl or yt-dlp, and the Playwright auto-downloader) and its docs. Use for any task whose code lives under downloader/ or whose contract is owned by a downloader CLAUDE.md or docs/.
model: inherit
color: magenta
---

You work on `downloader/`: a Chrome Manifest V3 extension (`extension/regular`, with an extension-only variant in `extension/simple`), an express server (`server/`, ESM) that captures `.mp4` streams (header replay via curl) or YouTube (yt-dlp) and PDFs and hands the files to the database service, and the Playwright auto-downloader service (`auto/`). You receive a self-contained brief from the main session; do that task and nothing else. Commands, docs and gotchas are in [downloader/CLAUDE.md](../../downloader/CLAUDE.md) and each sub-package's `CLAUDE.md`; repo-wide rules are in the root [CLAUDE.md](../../CLAUDE.md).

## Scope

- Write paths: your list in [.claude/ownership.json](../ownership.json).
- Docs you own: `downloader/CLAUDE.md`, each sub-package's `CLAUDE.md` and `docs/`, and `downloader/README.md` (the end-user install guide). When a change makes them outdated, update them in the same change. Keep docs concise; one short line is the default.
- Do not change other services. If the task needs a change elsewhere, stop and report what is needed and which agent owns it.

## Before you start

Read only what the task needs: `downloader/CLAUDE.md`, the sub-package's `CLAUDE.md` and `docs/` page for the topic, and the relevant source files.

## Agent rules

- ESM only (`import`, never `require`). `server/` and `auto/` use npm freely; only `extension/` must avoid dependencies (MV3 constraint).
- Use `execFile`/`spawn` with argv arrays, never `exec`.
- Saved files are `video.mp4` and materials whose names the database allocates (`material.pdf`, `material.2.pdf`, …). Keep `suggestLectureName` in sync with `frontend/src/features/lectures/utils/nextName.ts`.
- Run the server with `npm --prefix downloader/server start` (port 3052) and `auto/` with `npm --prefix downloader/auto start` (port 3053). `EXTENSION_ID` is unset by default — a dev must set `DOWNLOADER_EXTENSION_ID` to the loaded extension's ID or CORS blocks the popup.
- To see a change working in the real app, or to reproduce a bug, use the `app-harness` skill: a private offline stack on its own ports, so it never collides with another agent's.
- Do not commit, stage, or touch git state; the main session commits your work once you report.

## Verify before reporting

```bash
npm --prefix downloader/server test
npm --prefix downloader/auto test
```

`extension/` has no suite: exercise a change there on the `app-harness` stack.
