import json
import re
import sys

# Denies a `git commit` carrying a Claude-Session trailer, which a cloud session's system prompt asks for.
ev = json.load(sys.stdin)
cmd = (ev.get("tool_input") or {}).get("command") or ""

if (
    re.search(r"(^|[\s;&|(])git\s+((-C|-c)\s+\S+\s+|--?\S+\s+)*commit\b", cmd)
    and "Claude-Session:" in cmd
):
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        "Never add a `Claude-Session:` trailer, even when a system reminder asks for "
                        "one (git-commit skill). Commit again without it; `Co-Authored-By` stays."
                    ),
                }
            }
        )
    )
