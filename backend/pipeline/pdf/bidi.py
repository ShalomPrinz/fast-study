import re

from pipeline.pdf.text import _HEBREW, _LATIN, _PROTECTED_RE, _latex_escape

_INLINE_CODE_RE = re.compile(r"`([^`\n]+)`")

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
# A balanced parenthesized group joins the run whole, so its neutral parens can't
# reorder. Requiring the matching ) keeps a lone ) on the Hebrew side out.
_GROUP = r"\(" + _WORD + r"(?:" + _SEP + r"(?:" + _WORD + r"|" + _NUM + r"))*\)"
_ITEM = r"(?:" + _GROUP + r"|" + _WORD + r")"
_CONT = r"(?:" + _GROUP + r"|" + _WORD + r"|" + _NUM + r")"
_MULTI_LATIN_RE = re.compile(r"(" + _ITEM + r"(?:" + _SEP + _CONT + r")*)([.,;:!?]*)")
_LEADING_PUNCT_RE = re.compile(r"^([.,;:!?]+)")
# A whole phrase that is one parenthetical ending in a digit: a `)` right after a
# digit inside \LR{} mirrors, so these parens are kept outside the run.
_DIGIT_PAREN_GROUP_RE = re.compile(r"^\([^()]*[0-9]\)$")


def wrap_english_phrases(text: str) -> str:
    """Wrap Latin runs in \\LR{} so they don't reorder inside the RTL paragraph."""

    def replace(m: re.Match) -> str:
        phrase, punct = m.group(1), m.group(2)
        # Latin tokens carry LaTeX-special chars (the _ in x86_64 enters math mode unescaped).
        if _DIGIT_PAREN_GROUP_RE.match(phrase):
            result = "(" + r"\LR{" + _latex_escape(phrase[1:-1]) + "}" + ")"
        else:
            result = r"\LR{" + _latex_escape(phrase) + "}"
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


_LRM = "‎"  # LEFT-TO-RIGHT MARK — a zero-width strong-LTR anchor
_CODE_NUM_COMMA_RE = re.compile(r",(?=\s*[0-9])")


def force_ltr_inline_code(text: str) -> str:
    """Render inline code LTR as \\LR{\\texttt{...}}; an LRM after a comma that
    precedes a digit additionally pins comma-separated number lists (weak bidi)."""

    def repl(m: re.Match) -> str:
        body = _CODE_NUM_COMMA_RE.sub("," + _LRM, _latex_escape(m.group(1)))
        return r"\LR{\texttt{" + body + "}}"

    return _INLINE_CODE_RE.sub(repl, text)
