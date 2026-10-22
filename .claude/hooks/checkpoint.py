import json
import os
import sys

# Tells a service subagent once, past 140K context, to finish its current concern and hand back.
THRESHOLD = 140_000
MESSAGE = (
    "CHECKPOINT: your context has passed 140K tokens. Finish the concern you are on, leave it "
    "lint-clean with its tests passing, then hand back: what is done, files touched, what remains, "
    "and anything the next agent must know. Do not start another concern. If this is your only "
    "concern, ignore this and continue."
)

ev = json.load(sys.stdin)
aid, kind = ev.get("agent_id"), ev.get("agent_type") or ""
if not aid or not kind.endswith("-dev"):
    sys.exit(0)
# The hook gets the parent's transcript_path; the subagent's own transcript sits beside it.
path = os.path.join(
    ev.get("transcript_path", "")[: -len(".jsonl")], "subagents", f"agent-{aid}.jsonl"
)
marker = path + ".checkpoint"
if os.path.exists(marker) or not os.path.exists(path):
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
if ctx < THRESHOLD:
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
                "additionalContext": MESSAGE,
            }
        }
    )
)
