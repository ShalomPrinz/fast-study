"""Pure helper for snapshotting a course-overview source set's lecture/recitation number
range at generation time. Numbers are the first dotted-number token of each source name."""

import re

# First dotted-number token: "Lecture 2.2" -> "2.2", "Recitation 10" -> "10".
_NUM_RE = re.compile(r"(\d+(?:\.\d+)*)")


def _numeric_key(token: str) -> list[int]:
    """Natural sort key over a dotted-number token: [2, 2] < [10, 1], and [2] < [2, 2]."""

    return [int(part) for part in token.split(".")]


def name_range(names: list[str]) -> dict[str, str] | None:
    """Each name's first dotted-number token, natural-sorted into {"start", "end"}. Plain
    min-max with no contiguity check; None when no name carries a number."""

    tokens = [m.group(1) for name in names if (m := _NUM_RE.search(name))]
    if not tokens:
        return None
    tokens.sort(key=_numeric_key)
    return {"start": tokens[0], "end": tokens[-1]}
