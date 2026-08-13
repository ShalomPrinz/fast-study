import re

from pipeline.pdf.text import (
    _DOUBLE_CODE_BODY,
    _HEBREW,
    _INLINE_CODE_BODY,
    _LATIN,
    _PROTECTED_RE,
    _latex_escape,
)

_INLINE_CODE_RE = re.compile(
    r"``(" + _DOUBLE_CODE_BODY + r")``|`(" + _INLINE_CODE_BODY + r")`"
)

# A possessive apostrophe after a sibilant ("Bayes' Rule") glues across the space
# too, so the run isn't split into two islands. Restricting the lookbehind to s/x/z
# is what keeps a closing quote between Latin words ("’word’ here") outside the run.
_POSSESSIVE = r"(?<=[sxzSXZ])['’](?=[ \t]+[" + _LATIN + r"])"
# One Latin token: an optional numeric prefix and/or leading slash glued to a letter,
# then letters/digits/underscore with separators that are FOLLOWED by more of the same.
# See docs/PDF.md for why each piece is shaped this way.
_WORD = (
    r"(?:[0-9]+-?)?(?:(?<![" + _HEBREW + r"])/)?[" + _LATIN + r"]"
    r"(?:[" + _LATIN + r"0-9_]|[\-/.'’](?=[" + _LATIN + r"0-9])|" + _POSSESSIVE + r")*"
)
# A number joins a phrase as a CONTINUATION only, never an anchor — so a lone
# Hebrew-adjacent number ("5 שקלים") stays untouched in the RTL run.
_NUM = r"[0-9]+(?:[.,][0-9]+)*"
# Separators kept INSIDE one \LR run, but only when another Latin token follows —
# a sentence-final period/comma is left for the trailing \RL{} group.
_SEP = r"(?:[ \t]+-[ \t]+|,[ \t]+|[ \t]+|\.[ \t]+)"
# A quote may hug a group's tokens, so console.log('hi') stays one run.
_QUOTED = r"['’\"]?(?:" + _WORD + r"|" + _NUM + r")['’\"]?"
_GROUP_BODY = r"['’\"]?" + _WORD + r"['’\"]?(?:" + _SEP + _QUOTED + r")*"
# A balanced (…) or […] group joins the run whole, so its neutral delimiters can't
# reorder. Requiring the matching closer keeps a lone one on the Hebrew side out.
_GROUP = r"(?:\(" + _GROUP_BODY + r"\)|\[" + _GROUP_BODY + r"\])"
# A group directly after a word belongs to it — console.log('hi'), arr[i], grep [pattern].
_ITEM = r"(?:" + _WORD + r"(?:" + _GROUP + r")*|" + _GROUP + r")"
_CONT = r"(?:" + _ITEM + r"|" + _NUM + r")"
_MULTI_LATIN_RE = re.compile(r"(" + _ITEM + r"(?:" + _SEP + _CONT + r")*)([.,;:!?]*)")
_LEADING_PUNCT_RE = re.compile(r"^([.,;:!?]+)")
# A run ENDING in `<digit>)` mirrors that paren inside a bare \LR{} — the neutral sits
# on the run's RTL boundary. Mid-run it is safe: raise(SIGUSR1) needs no help.
_DIGIT_PAREN_END_RE = re.compile(r"[0-9]\)$")


def wrap_english_phrases(text: str) -> str:
    """Wrap Latin runs in \\LR{} so they don't reorder inside the RTL paragraph."""

    def replace(m: re.Match) -> str:
        phrase, punct = m.group(1), m.group(2)
        # Latin tokens carry LaTeX-special chars (the _ in x86_64 enters math mode unescaped).
        body = _latex_escape(phrase)
        # The language switch turns mirroring off, which \LR alone cannot do.
        if _DIGIT_PAREN_END_RE.search(phrase):
            result = r"\LR{\textenglish{" + body + "}}"
        else:
            result = r"\LR{" + body + "}"
        if punct:
            result += r"\RL{" + punct + "}"
        return result

    # Split on math/code spans so _MULTI_LATIN_RE never touches them: odd indices are
    # protected passthrough, even ones get substituted.
    parts = _PROTECTED_RE.split(text)
    out = []
    for i, part in enumerate(parts):
        if i % 2 == 1:
            out.append(part)
        else:
            # Punctuation right after a protected span would attach to the LTR island via
            # bidi. Force it RTL — after the Latin sub, else the regex matches the "RL".
            leading = ""
            if i > 0:
                m = _LEADING_PUNCT_RE.match(part)
                if m:
                    leading = r"\RL{" + m.group(1) + "}"
                    part = part[m.end() :]
            out.append(leading + _MULTI_LATIN_RE.sub(replace, part))
    return "".join(out)


def force_ltr_inline_code(text: str) -> str:
    """Render inline code as \\LR{\\textenglish{\\texttt{...}}} — the language switch makes the
    local base direction LTR (as text_direction.lua does for blocks), anchoring weak digits/neutrals."""

    def repl(m: re.Match) -> str:
        raw = m.group(1) if m.group(1) is not None else m.group(2)
        # Markdown strips one padding space from each end of a span that has both.
        if raw.startswith(" ") and raw.endswith(" ") and raw.strip():
            raw = raw[1:-1]
        return r"\LR{\textenglish{\texttt{" + _latex_escape(raw) + "}}}"

    # The shared splitter, but rewriting the protected halves rather than skipping them —
    # code spans are the subject. Math must still split, else a `$…$` inside a code span
    # cuts it in two and its orphaned backticks pair with the next span's.
    parts = _PROTECTED_RE.split(text)
    for i in range(1, len(parts), 2):
        m = _INLINE_CODE_RE.fullmatch(parts[i])
        if m:
            parts[i] = repl(m)
    return "".join(parts)
