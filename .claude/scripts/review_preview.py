"""Print a Markdown preview of the uncommitted diff for the reviewer; read-only (.claude/scripts/README.md)."""

from __future__ import annotations

import difflib
import json
import os
import re
import subprocess
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from fnmatch import fnmatch
from pathlib import Path

EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
GREP_HITS = 5  # per stale name (tunable)

# Contract surfaces a peer depends on, and the doc that owns each (reviewer check 1).
CONTRACTS: tuple[tuple[str, str], ...] = (
    (
        "lib/runtime/*",
        "launch contract: port report, secret, state root (CLAUDE.md, lib/runtime/CLAUDE.md)",
    ),
    ("frontend/src/services/runtime.ts", "launch contract, frontend side (CLAUDE.md)"),
    ("electron/main.js", "service spawn order and env handoff (electron/CLAUDE.md)"),
    (
        "electron/preload.js",
        "preload bridge `window.faststudy` (electron/docs/RENDERER.md)",
    ),
    ("electron/protocol.js", "`app://bundle` origin (electron/docs/RENDERER.md)"),
    (
        "lib/tools/*",
        "external-binary resolution and /health probe (lib/tools/CLAUDE.md)",
    ),
    ("lib/sentry/*", "Sentry policy for all six runtimes (lib/sentry/CLAUDE.md)"),
    ("database/database_main.py", "database HTTP routes (database/docs/API.md)"),
    ("database/events/*", "SSE /events channel (database/docs/EVENTS.md)"),
    ("database/fs/paths.py", "DATA_ROOT layout (database/docs/LAYOUT.md)"),
    ("backend/backend_main.py", "backend HTTP routes (backend/docs/API.md)"),
    (
        "downloader/server/src/routes/*",
        "downloader server routes (downloader/server/CLAUDE.md)",
    ),
    (
        "downloader/auto/src/http/*",
        "auto-downloader routes (downloader/auto/CLAUDE.md)",
    ),
    ("*/errors.py", "error codes and params (docs/ERROR-CODES.md)"),
    ("*/errors.js", "error codes and params (docs/ERROR-CODES.md)"),
    (
        "docs/ERROR-CODES.md",
        "error-code vocabulary, held in step by frontend/src/shared/i18n/errorCodeDrift.test.ts",
    ),
    (
        "frontend/src/locales/*",
        "Lingui catalogs: user-reachable codes need a row (docs/ERROR-CODES.md)",
    ),
    (
        "backend/pyproject.toml",
        "frozen bundle: database deps stay a subset of backend's (delivery/CLAUDE.md)",
    ),
    (
        "database/pyproject.toml",
        "frozen bundle: database deps stay a subset of backend's (delivery/CLAUDE.md)",
    ),
    ("delivery/services.spec", "frozen bundle (delivery/CLAUDE.md)"),
    (
        ".github/workflows/*",
        "build, smoke, publish and Pages pipeline (delivery/CLAUDE.md, site/CLAUDE.md)",
    ),
)
# Reviewer check 3 leads: outbound HTTP from database/, and process spawns that must resolve through tool_path.
OUTBOUND = re.compile(
    r"\b(httpx|requests|aiohttp|urllib\.request|urlopen|http\.client)\b"
)
SPAWN = re.compile(
    r"\b(subprocess\.\w+|create_subprocess_exec|create_subprocess_shell|spawn|spawnSync|execFile|execFileSync)\("
)
BUNDLE_FILES = (
    "backend/pyproject.toml",
    "database/pyproject.toml",
    "delivery/services.spec",
)

GENERATED = ("package-lock.json", "uv.lock", ".po")
CODE = (".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx")
JS = (".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx")
DEF = re.compile(r"^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)")
CONST = re.compile(r"^\s*([A-Z][A-Z0-9_]{2,})\s*(?::[^=]+)?=(?!=)")
JS_DEF = re.compile(
    r"^\s*(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)"
)
JS_CONST = re.compile(
    r"^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)"
)  # top level only: no indent
QUOTED_CODE = re.compile(
    r"""["']([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)["']"""
)
NUMBER = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?(?:e-?\d+)?(?![\w.])")
LITERAL = re.compile(r""""(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|""" + NUMBER.pattern)
HUNK = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")
MD_LINK = re.compile(r"\]\(([^)\s]+)\)")
AT_PATH = re.compile(r"(?<![\w`])@[\w.-]*[/.][\w./-]*\w")
DOC_CITE = re.compile(r"(?<![\w/.-])([\w.-]+(?:/[\w.-]+)*\.md)\b")
COMMENT = re.compile(r"(?:^|\s)(?:#|//|/?\*)\s(.*)")


@dataclass
class FileDiff:
    path: str
    removed: list[tuple[int, str]] = field(
        default_factory=list
    )  # old line number, text
    added: list[tuple[int, str]] = field(default_factory=list)  # new line number, text
    pairs: list[tuple[int, str, str]] = field(
        default_factory=list
    )  # new line number, old text, new text


def git(*args: str) -> str:
    done = subprocess.run(
        ["git", "-c", "core.quotepath=off", *args],
        capture_output=True,
        text=True,
        errors="replace",
    )
    return done.stdout if done.returncode == 0 else ""


def base() -> str:
    return "HEAD" if git("rev-parse", "--verify", "-q", "HEAD").strip() else EMPTY_TREE


def parse_diff(text: str) -> dict[str, FileDiff]:
    """Per-file removed and added lines of a `-U0` diff, and the -/+ lines paired in order within each change."""
    files: dict[str, FileDiff] = {}
    cur: FileDiff | None = None
    in_hunk = False
    old_no = new_no = 0
    minus: list[str] = []
    plus: list[tuple[int, str]] = []

    def flush() -> None:
        if cur is not None:
            cur.pairs.extend(
                (n, old, new) for old, (n, new) in zip(minus, plus, strict=False)
            )
        minus.clear()
        plus.clear()

    for line in text.splitlines():
        if line.startswith("diff --git "):
            flush()
            name = line.rsplit(" b/", 1)[-1]
            cur, in_hunk = files.setdefault(name, FileDiff(name)), False
        elif m := HUNK.match(line):
            flush()
            in_hunk, old_no, new_no = True, int(m[1]), int(m[2])
        elif cur is None or not in_hunk:
            continue
        elif line.startswith("-"):
            if plus:
                flush()
            cur.removed.append((old_no, line[1:]))
            minus.append(line[1:])
            old_no += 1
        elif line.startswith("+"):
            cur.added.append((new_no, line[1:]))
            plus.append((new_no, line[1:]))
            new_no += 1
    flush()
    return files


def read(root: Path, rel: str) -> str | None:
    try:
        data = (root / rel).read_bytes()
    except OSError:
        return None
    return None if b"\0" in data[:4096] else data.decode("utf-8", "replace")


def section(title: str, lines: Iterable[str]) -> list[str]:
    body = list(lines)
    return [f"## {title}", "", *body, ""] if body else []


def load_map(path: Path) -> tuple[dict[str, tuple[str, ...]], tuple[str, ...]]:
    """Per-agent write prefixes and the service folders, or empty ones when the map is missing or malformed."""
    try:
        data = json.loads(path.read_text())
        return {a: tuple(ps) for a, ps in data["agents"].items()}, tuple(
            data["packages"]
        )
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {}, ()


def covers(prefixes: Iterable[str], rel: str) -> bool:
    """`rel` matches a prefix: a trailing `/` is a folder, else one file."""
    return any(rel == p or (p.endswith("/") and rel.startswith(p)) for p in prefixes)


def is_test(rel: str) -> bool:
    name = rel.rsplit("/", 1)[-1]
    return (
        "/tests/" in f"/{rel}"
        or ".test." in name
        or name.startswith("test_")
        or name == "conftest.py"
    )


def change_set(root: Path, untracked: list[str], spec: list[str]) -> list[str]:
    out = ["```", git("status", "--short", "--", *spec).rstrip(), "```"]
    stat = git("diff", "--stat=120", "-M", base(), "--", *spec).rstrip()
    if stat:
        out += ["", "```", stat, "```"]
    for rel in untracked:
        text = read(root, rel)
        if text is None:
            out += ["", f"Untracked `{rel}`: binary or unreadable."]
            continue
        if rel.endswith(GENERATED):
            out += ["", f"Untracked `{rel}`: generated, not shown."]
            continue
        lines = text.splitlines()
        out += [
            "",
            f"Untracked `{rel}` ({len(lines)} lines):",
            "",
            "````",
            *lines,
            "````",
        ]
    return out


def all_docs() -> list[str]:
    """Every CLAUDE.md, README.md and docs/ page in the tree, tracked or new."""
    files = git(
        "ls-files", "--cached", "--others", "--exclude-standard", "*.md"
    ).splitlines()
    return [
        f
        for f in files
        if f.rsplit("/", 1)[-1] in ("CLAUDE.md", "README.md") or "docs/" in f"/{f}"
    ]


def mentions(text: str, name: str) -> bool:
    return re.search(rf"(?<![\w./-]){re.escape(name)}(?![\w/-])", text) is not None


def owning_docs(
    root: Path, rel: str, docs: list[str], texts: dict[str, str]
) -> list[str]:
    """Docs naming `rel`: by full path anywhere, by any shorter path or file name inside its own service."""
    if rel in docs:
        return [rel]
    parts = rel.split("/")
    tails = ["/".join(parts[i:]) for i in range(1, len(parts))]
    found = []
    for d in docs:
        same_service = len(parts) > 1 and d.startswith(parts[0] + "/")
        names = [rel, *tails] if same_service else [rel]
        if any(mentions(texts[d], n) for n in names):
            found.append(d)
    if rel.endswith(CODE):
        comments = "\n".join(
            m[1]
            for line in (read(root, rel) or "").splitlines()
            if (m := COMMENT.search(line))
        )
        cited = {
            c
            for c in (resolve(root, rel, c) for c in DOC_CITE.findall(comments))
            if c in docs
        }
        found += sorted(cited - set(found))
    return found


def ownership(
    root: Path,
    paths: list[str],
    scopes: dict[str, tuple[str, ...]],
    packages: tuple[str, ...],
) -> list[str]:
    docs = all_docs()
    texts = {d: read(root, d) or "" for d in docs}
    out = ["| Path | Agent | Owning docs |", "|---|---|---|"]
    flags = []
    for rel in paths:
        found = owning_docs(root, rel, docs, texts)
        agent = (
            ", ".join(a for a, ps in scopes.items() if covers(ps, rel))
            or "the main session"
        )
        out.append(f"| `{rel}` | {agent} | {', '.join(found) or '-'} |")
        if (
            covers(packages, rel)
            and rel.endswith(CODE)
            and not is_test(rel)
            and not set(found) & set(paths)
        ):
            flags.append(
                f"- `{rel}`: service code changed with no owning doc in the diff."
            )
    return out + ([""] + flags if flags else [])


def removed_names(diffs: Iterable[FileDiff]) -> set[str]:
    names: set[str] = set()
    for d in diffs:
        if not d.path.endswith(CODE):
            continue
        patterns = (JS_DEF, JS_CONST) if d.path.endswith(JS) else (DEF, CONST)
        for _, text in d.removed:
            names.update(m[1] for p in patterns if (m := p.match(text)))
            names.update(QUOTED_CODE.findall(text))
    return {n for n in names if len(n) > 2}


def stale_references(diffs: dict[str, FileDiff]) -> list[str]:
    added = "\n".join(t for d in diffs.values() for _, t in d.added)
    names = sorted(
        n
        for n in removed_names(diffs.values())
        if not re.search(rf"(?<![\w$]){re.escape(n)}(?![\w$])", added)
    )
    if not names:
        return []
    args = [a for n in names for a in ("-e", n)]
    excluded = [":!*package-lock.json", ":!*uv.lock", ":!*.po"]
    hits: dict[str, list[str]] = {}
    for line in git(
        "grep", "-n", "-w", "-F", "-I", "--untracked", *args, "--", ".", *excluded
    ).splitlines():
        for n in names:
            if re.search(rf"(?<![\w$]){re.escape(n)}(?![\w$])", line.split(":", 2)[-1]):
                hits.setdefault(n, []).append(line.strip())
    out = []
    for n in names:
        if n in hits:
            shown = hits[n][:GREP_HITS]
            more = (
                f" (+{len(hits[n]) - GREP_HITS} more)"
                if len(hits[n]) > GREP_HITS
                else ""
            )
            out += [
                f"- `{n}` removed, still referenced{more}:",
                *(f"  - `{h[:160]}`" for h in shown),
            ]
    return out


def changed_values(diffs: dict[str, FileDiff]) -> list[str]:
    out = []
    for d in diffs.values():
        if d.path.endswith(
            GENERATED
        ):  # catalog line refs and lock hashes shift on every unrelated edit
            continue
        for n, old, new in d.pairs:
            pattern = (
                NUMBER if d.path.endswith(".md") else LITERAL
            )  # prose apostrophes are not strings
            old_lits, new_lits = pattern.findall(old), pattern.findall(new)
            if old_lits == new_lits or not (old_lits or new_lits):
                continue
            ratio = difflib.SequenceMatcher(
                None, pattern.sub("_", old), pattern.sub("_", new)
            ).ratio()
            gone = [short(x) for x in old_lits if x not in new_lits]
            came = [short(x) for x in new_lits if x not in old_lits]
            if ratio >= 0.8 and (gone or came):
                out.append(
                    f"- `{d.path}:{n}`: {', '.join(gone) or '-'} -> {', '.join(came) or '-'}"
                )
    return out


def short(text: str, limit: int = 60) -> str:
    return text if len(text) <= limit else text[: limit - 3] + "..."


def contract_surfaces(paths: list[str]) -> list[str]:
    return [
        f"- `{p}`: {why}" for p in paths for pat, why in CONTRACTS if fnmatch(p, pat)
    ]


def changed_lines(
    root: Path, rel: str, diffs: dict[str, FileDiff]
) -> list[tuple[int, str]]:
    """Added lines of a tracked file, or every line of an untracked one."""
    return (
        diffs[rel].added
        if rel in diffs
        else list(enumerate((read(root, rel) or "").splitlines(), 1))
    )


def invariants(
    root: Path,
    diffs: dict[str, FileDiff],
    untracked: list[str],
    packages: tuple[str, ...],
) -> list[str]:
    paths = [*diffs, *untracked]
    code = [
        p for p in paths if covers(packages, p) and p.endswith(CODE) and not is_test(p)
    ]
    out = []
    for rel in (p for p in code if p.startswith("database/")):
        for n, line in changed_lines(root, rel, diffs):
            if m := OUTBOUND.search(line):
                out.append(
                    f"- `{rel}:{n}`: `{m[1]}` in database/, which calls no peer (CLAUDE.md, Service call graph)"
                )
    for module in sorted(
        {"/".join(p.split("/")[:2]) for p in code if p.startswith("lib/")}
    ):
        halves = {
            h for h in ("py", "js") if any(p.startswith(f"{module}/{h}/") for p in code)
        }
        both = all(git("ls-files", f"{module}/{h}/").strip() for h in ("py", "js"))
        if both and len(halves) == 1:
            out.append(
                f"- `{module}`: only its `{halves.pop()}/` half changed (lib/CLAUDE.md)"
            )
    for rel in paths:
        parts = rel.split("/")
        new_module = (
            rel in untracked
            and parts[0] in ("backend", "database")
            and rel.endswith(".py")
        )
        new_module = new_module and (
            len(parts) == 2 or (len(parts) == 3 and parts[2] == "__init__.py")
        )
        if rel in BUNDLE_FILES or new_module:
            out.append(f"- `{rel}`: frozen bundle invariants (delivery/CLAUDE.md)")
    for rel in code:
        for n, line in changed_lines(root, rel, diffs):
            if m := SPAWN.search(line):
                out.append(
                    f"- `{rel}:{n}`: `{m[1]}(` spawns a process: binary through `tool_path`/`toolPath`?"
                )
    if not out:
        return [
            "No database/ outbound call, one-sided lib/ change, frozen-bundle or process-spawn change: check 3 not needed."
        ]
    return ["Check 3 needed:", *out]


def resolve(root: Path, rel: str, cite: str) -> str:
    """A cited doc path, tried from the root, then from the citing file's folder and each folder above it."""
    if (root / cite).exists():
        return cite
    for folder in Path(rel).parents:
        if (root / folder / cite).exists():
            return os.path.normpath(folder / cite)
    return cite


def doc_hygiene(
    root: Path, diffs: dict[str, FileDiff], untracked: list[str]
) -> list[str]:
    out = []
    changed = [p for p in [*diffs, *untracked] if (root / p).is_file()]
    for rel in (p for p in changed if p.endswith(".md")):
        fenced = False
        for n, line in enumerate((read(root, rel) or "").splitlines(), 1):
            fenced ^= line.lstrip().startswith("```")
            for link in [] if fenced else MD_LINK.findall(line):
                target = link.split("#")[0]
                if target and "://" not in target and not target.startswith("mailto:"):
                    if not (root / rel).parent.joinpath(target).exists():
                        out.append(f"- `{rel}:{n}`: broken link `{link}`")
    for rel in (p for p in changed if p.rsplit("/", 1)[-1] == "CLAUDE.md"):
        for n, line in enumerate((read(root, rel) or "").splitlines(), 1):
            out += [
                f"- `{rel}:{n}`: `{m}` inlines a file into every session"
                for m in AT_PATH.findall(line)
            ]
    for rel in (p for p in changed if p.endswith(CODE)):
        for n, line in changed_lines(root, rel, diffs):
            comment = COMMENT.search(line)
            for cite in DOC_CITE.findall(comment[1]) if comment else []:
                # A bare file name like `summary.md` is usually data, not a doc reference.
                if ("/" in cite or cite in ("CLAUDE.md", "README.md")) and not (
                    root / resolve(root, rel, cite)
                ).exists():
                    out.append(f"- `{rel}:{n}`: cites missing doc `{cite}`")
    return out


def comment_blocks(text: str, rel: str) -> list[tuple[int, int, list[str]]]:
    """Each comment in a file as its first and last line and its non-empty text lines, markers stripped."""
    blocks: list[tuple[int, int, list[str]]] = []
    start, body, kind, close = 0, [], "", ""
    python, hashes = rel.endswith(".py"), rel.endswith((".py", ".sh"))

    def flush(end: int) -> None:
        nonlocal kind
        if kind:
            blocks.append((start, end, [b for b in body if b]))
        kind = ""

    for n, line in enumerate(text.splitlines(), 1):
        s = line.strip()
        if kind in ("block", "doc"):
            done = close in s
            body.append(
                s.split(close)[0].lstrip("*").strip() if done else s.lstrip("*").strip()
            )
            if done:
                flush(n)
            continue
        marker = next((m for m in ("#", "//") if s.startswith(m)), "")
        # `#` comments only in Python and shell; in JS it starts a private field.
        if marker == "//" or (marker and hashes and not s.startswith("#!")):
            if kind != marker:
                flush(n - 1)
                start, body, kind = n, [], marker
            body.append(s.lstrip(marker).strip())
            continue
        flush(n - 1)
        if s.startswith("/*") or (python and s.startswith(('"""', "'''"))):
            close = "*/" if s.startswith("/*") else s[:3]
            rest = s[2:] if close == "*/" else s[3:]
            start, body, kind = n, [], "block" if close == "*/" else "doc"
            body.append(rest.split(close)[0].lstrip("*").strip())
            if close in rest:
                flush(n)
    flush(len(text.splitlines()))
    return blocks


def multiline_comments(
    root: Path, diffs: dict[str, FileDiff], untracked: list[str]
) -> list[str]:
    """Comments of two or more text lines that touch a changed line; one-line comments never show."""
    out = []
    for rel in [*diffs, *untracked]:
        if not rel.endswith((*CODE, ".css", ".sh")) or not (root / rel).is_file():
            continue
        changed = {n for n, _ in changed_lines(root, rel, diffs)}
        for first, last, body in comment_blocks(read(root, rel) or "", rel):
            if len(body) >= 2 and changed.intersection(range(first, last + 1)):
                out.append(
                    f"- `{rel}:{first}-{last}` ({len(body)} lines): {short(body[0])}"
                )
    return out


def main() -> None:
    # The tree is the one this copy of the script lives in, so a worktree reviews itself from any cwd.
    top = git(
        "-C", str(Path(__file__).resolve().parent), "rev-parse", "--show-toplevel"
    ).strip()
    if not top:
        print("Not in a git repository.")
        return
    root = Path(top)
    os.chdir(root)
    spec = [
        os.path.relpath(Path(p).resolve(), root) if Path(p).is_absolute() else p
        for p in sys.argv[1:]
    ]
    diffs = parse_diff(
        git("diff", "-U0", "-M", "--no-color", "--no-ext-diff", base(), "--", *spec)
    )
    untracked = git(
        "ls-files", "--others", "--exclude-standard", "--", *spec
    ).splitlines()
    paths = list(dict.fromkeys([*diffs, *untracked]))
    if not paths:
        print("# Change preview\n\nNo uncommitted changes.")
        return
    out = [
        "# Change preview",
        "",
        "Flags are leads to confirm against the diff, not findings.",
        "",
    ]
    out += section("Change set", change_set(root, untracked, spec))
    scopes, packages = load_map(root / ".claude" / "ownership.json")
    out += section("Ownership", ownership(root, paths, scopes, packages))
    out += section("Stale references", stale_references(diffs))
    out += section("Changed values", changed_values(diffs))
    out += section("Contract surfaces", contract_surfaces(paths))
    out += section("Invariants trigger", invariants(root, diffs, untracked, packages))
    out += section("Doc hygiene", doc_hygiene(root, diffs, untracked))
    out += section("Multi-line comments", multiline_comments(root, diffs, untracked))
    print("\n".join(out).rstrip())


if __name__ == "__main__":
    main()
