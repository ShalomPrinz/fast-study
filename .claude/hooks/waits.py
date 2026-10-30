import json
import re
import sys

# Denies the ways agents have lost track of a run: a Monitor in a subagent, and a backgrounded harness command.
ev = json.load(sys.stdin)
tool, inp = ev.get("tool_name"), ev.get("tool_input") or {}

reason = None
if tool == "Monitor" and ev.get("agent_id"):
    reason = (
        "Monitor is not available to subagents: a subagent cannot idle until it fires, so it "
        "re-arms in a loop. Run the command in the foreground (Bash timeout up to 1200000) instead."
    )
elif tool == "Bash":
    harness = re.compile(r"setup\.mjs|test:e2e|hb\.mjs|(^|[\s;&|(])hb\s")
    # A lone `&`: not `&&`, and not a redirection such as `2>&1`, `&>` or `|&`.
    detach = re.compile(r"\bnohup\b|(?<![&>|])&(?![&>])")
    lines = inp.get("command", "").replace("\\\n", " ").splitlines()
    # Per line, so a heredoc of docs that merely names both is not denied.
    if (inp.get("run_in_background") and any(harness.search(x) for x in lines)) or any(
        harness.search(x) and detach.search(x) for x in lines
    ):
        reason = (
            "Run harness commands in the foreground: `setup.mjs` returns once the stack is "
            "ready and `npm run test:e2e` exits when the suite ends, so give the Bash call "
            "timeout: 600000 for setup and 1200000 for e2e. Never run_in_background, nohup or `&` them."
        )

if reason:
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
