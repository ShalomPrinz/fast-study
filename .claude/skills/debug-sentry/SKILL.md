---
name: debug-sentry
description: Use for any first look at a Sentry error in the faststudy project — the newest one, or one named by its short id (FASTSTUDY-A) — including when the user says Sentry reported something, pastes a Sentry link, or asks what the latest crash was.
---

### Run the script first

Before any Sentry MCP call or any guess, run `sentry.py` — stdlib Python for plain `python3`, runs
from anywhere, read-only.

```
python3 <repo-root>/.claude/skills/debug-sentry/sentry.py [SHORT_ID] [--query Q] [--crumbs N] --out <scratchpad>/sentry
```

No id takes the issue seen most recently that matches `--query` (default `is:unresolved`; pass `""`
for any status). An id like `FASTSTUDY-A` (any case) takes that issue; a Sentry issue link's last
path segment or its title's short id is the same thing.

The output is the issue header (level, status, link, culprit, event and user counts, first/last
seen, releases), then the latest event: its tags (`service`, `runtime`, release, OS), contexts,
message, the exception chain with in-app frames and their source line, the request, the last
breadcrumbs and any extra data. Do not re-derive any of it with Sentry MCP calls; read it and answer.

### Auth

The script uses Sentry's REST API with a personal auth token — the MCP's OAuth login belongs to
Claude Code and no script can use it. It reads `SENTRY_AUTH_TOKEN`, else `[auth] token=` in
`~/.sentryclirc`. With neither, it prints where to create one (scopes `event:read`, `project:read`,
`org:read`); relay that to the user and stop — never go looking for a token elsewhere.

### What the saved paths are for

`<out>/<SHORT_ID>/event.json` is the whole latest event: every frame including the hidden library
ones, every breadcrumb, full contexts. `issue.json` is the issue. Reach for them only when the
printed digest left a question open.

### Then fix it in the owning service

The `service` tag says which runtime reported it; route the fix to that service's subagent. The
output is diagnosis, not a licence to edit, and never resolve or ignore the issue in Sentry.
