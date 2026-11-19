import json
import os
import sys

# Tells a service subagent, past 140K context, to state whether it hands back or continues, and past
# 180K to hand back now; each level fires once.
SOFT, HARD = 140_000, 180_000
SOFT_MESSAGE = (
    "CHECKPOINT: your context has passed 140K tokens. In your next text, say which case applies. "
    "(1) Some items of your brief are not started or not finished: finish the item you are on, leave it lint-clean "
    "with its tests passing, then hand back. Do not start another item. (2) Only finishing work on "
    "what is already built remains (tests, i18n, docs, verification): continue. Either way, if the "
    "item you are on is not passing within about 10 more tool calls, stop and hand back partial. "
    "A hand-back says what is done, files touched, what remains, what you tried, and anything the "
    "next agent must know."
)
HARD_MESSAGE = (
    "CHECKPOINT: your context has passed 180K tokens. Hand back now. Do not run another "
    "verification loop. Leave no half-made edit unmentioned, then report what is done, "
    "files touched, what remains, what you tried, and anything the next agent must know."
)

ev = json.load(sys.stdin)
aid, kind = ev.get("agent_id"), ev.get("agent_type") or ""
if not aid or not kind.endswith("-dev"):
    sys.exit(0)
# The hook gets the parent's transcript_path; the subagent's own transcript sits beside it.
path = os.path.join(
    ev.get("transcript_path", "")[: -len(".jsonl")], "subagents", f"agent-{aid}.jsonl"
)
if not os.path.exists(path) or os.path.exists(path + ".checkpoint-hard"):
    sys.exit(0)
ctx = 0
for line in open(path):
    try:
        e = json.loads(line)
    except ValueError:  # the last line may be mid-write
        continue
    u = (e.get("message") or {}).get("usage") if e.get("type") == "assistant" else None
    if u:
        ctx = (
            u.get("input_tokens", 0)
            + u.get("cache_read_input_tokens", 0)
            + u.get("cache_creation_input_tokens", 0)
        )
if ctx >= HARD:
    marker, message = path + ".checkpoint-hard", HARD_MESSAGE
elif ctx >= SOFT:
    marker, message = path + ".checkpoint", SOFT_MESSAGE
else:
    sys.exit(0)
try:
    # Exclusive create, so parallel tool calls in one turn inject the message only once.
    os.close(os.open(marker, os.O_CREAT | os.O_EXCL))
except FileExistsError:
    sys.exit(0)
print(
    json.dumps(
        {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": message,
            }
        }
    )
)
