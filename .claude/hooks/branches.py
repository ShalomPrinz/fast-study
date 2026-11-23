import json
import os
import re
import shlex
import subprocess
import sys

# Cloud sessions only: denies a `git push` to any branch but a `claude/<task-slug>` the session created (docs/CLOUD.md).
if os.environ.get("CLAUDE_CODE_REMOTE") != "true":
    sys.exit(0)

ev = json.load(sys.stdin)
cmd = (ev.get("tool_input") or {}).get("command") or ""
cwd = ev.get("cwd") or None
SLUG = re.compile(r"claude/[a-z0-9]+(-[a-z0-9]+)*")
# Flags of `git push` that take a separate value, so the value is not read as the remote or a refspec.
VALUED = {"-o", "--push-option", "--repo", "--receive-pack", "--exec"}


def deny(reason):
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason
                    + " Cloud sessions push only to `claude/<task-slug>` (docs/CLOUD.md): the branch or slug "
                    "the prompt names, else a short kebab-case name for the task, created from HEAD with "
                    "`git switch -c claude/<task-slug>`. The branch the session started on never counts "
                    "unless the user's prompt names exactly that branch.",
                }
            }
        )
    )
    sys.exit(0)


def start_branch_and_prompts():
    # The transcript's first entry carrying `gitBranch` is the branch the session started on.
    start, prompts = None, []
    try:
        with open(ev.get("transcript_path") or "", encoding="utf-8") as f:
            for line in f:
                d = json.loads(line)
                if start is None and d.get("gitBranch"):
                    start = d["gitBranch"]
                content = (
                    (d.get("message") or {}).get("content")
                    if d.get("type") == "user" and not d.get("isMeta")
                    else None
                )
                if isinstance(content, list):
                    content = " ".join(
                        b.get("text", "") for b in content if isinstance(b, dict)
                    )
                if content:
                    prompts.append(content)
    except (OSError, ValueError):
        pass
    return start, prompts


def push_targets(args):
    if "--all" in args or "--mirror" in args or "--branches" in args:
        return None
    positional, skip = [], False
    for a in args:
        if skip:
            skip = False
        elif a in VALUED:
            skip = True
        elif not a.startswith("-"):
            positional.append(a)
    current = None
    targets = []
    for dst in [s.lstrip("+").split(":")[-1] for s in positional[1:]] or ["HEAD"]:
        if dst in ("HEAD", "@"):
            # A bare push or `HEAD` pushes the current branch to its namesake.
            current = (
                current
                or subprocess.run(
                    ["git", "branch", "--show-current"],
                    cwd=cwd,
                    capture_output=True,
                    text=True,
                ).stdout.strip()
            )
            dst = current
        targets.append(dst.removeprefix("refs/heads/"))
    return targets


def commands():
    # Quote-aware split into simple commands, so a `;` or newline inside a commit message is not a separator.
    lex = shlex.shlex(cmd, posix=True, punctuation_chars="();<>|&\n")
    lex.whitespace = " \t\r"
    lex.whitespace_split = True
    words, redirect = [], False
    try:
        for tok in lex:
            if redirect:
                redirect = False  # the redirection's target (`1` in `2>&1`, a file, a heredoc tag)
            elif tok and set(tok) <= set("();<>|&\n"):
                # shlex glues a punctuation run into one token (`;>`, `>&`), so a token can both end
                # a command and open a redirection; `<(`/`>(` start a subshell, not a redirection.
                if set(tok) & set(";|()\n") or "&&" in tok or tok == "&":
                    yield words
                    words = []
                if ("<" in tok or ">" in tok) and "(" not in tok:
                    redirect = True
                    if words and words[-1].isdigit():
                        words.pop()  # the fd number in `2>`
            else:
                words.append(tok)
    except ValueError:
        # Unparseable (an unbalanced quote, say in a heredoc body): fail closed on any line pushing.
        for line in cmd.splitlines():
            if re.search(r"\bgit\b.*\bpush\b", line):
                deny(
                    "This command could not be parsed, so its `git push` could not be checked."
                )
    yield words


for words in commands():
    while words and re.fullmatch(r"\w+=.*", words[0]):
        words = words[1:]
    if words[:1] != ["git"]:
        continue
    words = words[1:]
    while words and words[0].startswith("-"):
        words = (
            words[2:]
            if words[0] in ("-C", "-c", "--git-dir", "--work-tree")
            else words[1:]
        )
    if words[:1] != ["push"]:
        continue
    targets = push_targets(words[1:])
    if targets is None:
        deny(
            "Pushing every branch at once (`--all`, `--mirror`, `--branches`) is not allowed."
        )
    start, prompts = start_branch_and_prompts()
    for t in targets:
        if not SLUG.fullmatch(t):
            deny(f"`{t}` is not a `claude/<task-slug>` branch.")
        if t == start and not any(
            re.search(rf"(?<![\w/-]){re.escape(t)}(?![\w/-])", p) for p in prompts
        ):
            deny(
                f"`{t}` is the branch this session started on, which the prompt did not name."
            )
