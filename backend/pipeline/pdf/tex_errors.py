import re
from dataclasses import dataclass


@dataclass(frozen=True)
class TexError:
    """One `! …` error from a TeX run. `line` numbers the GENERATED .tex — kept as
    `.pdf_build.tex` on a hard failure, so it is lookup-able there, never in summary.md."""

    message: str
    line: int | None
    at: str  # the part TeX had read when it failed — the error point


_TEX_LINE_RE = re.compile(r"^l\.(\d+)(.*)$")
# TeX puts the `l.<N>` marker a few lines after the `!`, past any <recently read> /
# <argument> context lines; bounded so a `!` with no marker can't adopt a later one.
_TEX_LINE_LOOKAHEAD = 20
_AT_MAX_CHARS = 40


def parse_tex_errors(log: str) -> list[TexError]:
    """Extract the `! message` / `l.<N>` error-point pairs from a XeLaTeX log.
    Tolerant: an error with no `l.<N>` marker is still returned, with no line number."""

    lines = log.splitlines()
    errors: list[TexError] = []
    for i, line in enumerate(lines):
        if not line.startswith("!") or not line[1:].strip():
            continue
        num, at = None, ""
        for j in range(i + 1, min(i + 1 + _TEX_LINE_LOOKAHEAD, len(lines))):
            if lines[j].startswith("!"):
                break
            m = _TEX_LINE_RE.match(lines[j])
            if not m:
                continue
            num = int(m.group(1))
            at = m.group(2).strip()
            break
        errors.append(TexError(line[1:].strip().rstrip("."), num, at))
    return errors


def format_tex_errors(errors: list[TexError]) -> str:
    """Render parsed TeX errors as ONE short line — it lands in a toast and in /status,
    so it reports the first error plus a count of the rest, never the whole log."""

    if not errors:
        return ""
    first = errors[0]
    where = ""
    if first.line is not None:
        at = first.at[:_AT_MAX_CHARS]
        where = f" (line {first.line}: {at})" if at else f" (line {first.line})"
    more = f" and {len(errors) - 1} more" if len(errors) > 1 else ""
    return f"LaTeX error: {first.message}{where}{more}"


def classify(log: str, fallback: str) -> str:
    """One-line classification of a TeX/pandoc log; the raw fallback when it has no `! …`."""

    errors = parse_tex_errors(log)
    return format_tex_errors(errors) if errors else fallback
