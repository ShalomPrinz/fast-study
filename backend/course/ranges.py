"""Pure helper for snapshotting a course-overview source set's lecture/recitation number
range at generation time. Numbers are the first dotted-number token of each source name."""

import re

# First dotted-number token: "Lecture 2.2" -> "2.2", "Recitation 10" -> "10".
_NUM_RE = re.compile(r"(\d+(?:\.\d+)*)")


def _numeric_key(token: str) -> list[int]:
    """Natural sort key over a dotted-number token as a tuple of ints.
    Without: str compare  -> "2.2" > "10.1" ("2" > "1") and "2" vs "2.2" ambiguous
    With it:  [2, 2] < [10, 1], and [2] < [2, 2] — so "2" sorts before "2.2"."""
    return [int(part) for part in token.split(".")]


def name_range(names: list[str]) -> dict[str, str] | None:
    """Extract each name's first dotted-number token, drop names with no number, natural-sort
    by tuple-of-ints, and return {"start": min, "end": max} — plain min–max, no contiguity
    check (non-contiguous 2,3,7 -> {"2","7"}). None when no name carries a number."""
    tokens = [m.group(1) for name in names if (m := _NUM_RE.search(name))]
    if not tokens:
        return None
    tokens.sort(key=_numeric_key)
    return {"start": tokens[0], "end": tokens[-1]}
