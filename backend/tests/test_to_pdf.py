import os
import shutil
import subprocess
import tempfile

import pytest
from to_pdf import (
    FONTS_DIR,
    LATEX_HEADER,
    LTR_CODE_FILTER,
    convert_to_pdf,
    normalize_dashes,
    ensure_blank_before_lists,
    wrap_english_phrases,
    normalize_math_spans,
    force_ltr_inline_code,
    apply_outside_fences,
    unwrap_math_code,
    unwrap_math_text_macros,
    normalize_math_text_spaces,
    wrap_math_text_ltr,
    merge_ltr_math,
)


# ---------------------------------------------------------------------------
# normalize_dashes
# ---------------------------------------------------------------------------

class TestNormalizeDashes:
    def test_em_dash_replaced_with_spaced_hyphen(self):
        assert normalize_dashes("לשמור — את") == "לשמור  -  את"

    def test_en_dash_replaced_with_hyphen(self):
        assert normalize_dashes("2010–2020") == "2010-2020"

    def test_no_dashes_unchanged(self):
        text = "plain text ללא מקפים"
        assert normalize_dashes(text) == text

    def test_multiple_em_dashes(self):
        result = normalize_dashes("א — ב — ג")
        assert "—" not in result

    def test_hyphen_minus_untouched(self):
        assert normalize_dashes("3-way") == "3-way"


# ---------------------------------------------------------------------------
# ensure_blank_before_lists
# ---------------------------------------------------------------------------

class TestEnsureBlankBeforeLists:
    def test_inserts_blank_before_dash_list_after_paragraph(self):
        text = "פסקה\n- פריט\n"
        result = ensure_blank_before_lists(text)
        assert "\n\n- פריט" in result

    def test_inserts_blank_before_numbered_list_after_paragraph(self):
        text = "פסקה\n1. פריט\n"
        result = ensure_blank_before_lists(text)
        assert "\n\n1. פריט" in result

    def test_no_extra_blank_when_already_blank(self):
        text = "פסקה\n\n- פריט\n"
        result = ensure_blank_before_lists(text)
        assert result.count("\n\n- פריט") == 1

    def test_consecutive_list_items_not_separated(self):
        text = "- אחד\n- שניים\n- שלוש\n"
        result = ensure_blank_before_lists(text)
        assert result == text

    def test_numbered_consecutive_items_not_separated(self):
        text = "1. ראשון\n2. שני\n"
        result = ensure_blank_before_lists(text)
        assert result == text

    def test_list_after_heading_not_separated(self):
        # Headings are not "content" that needs separation — already a blank line follows
        text = "## כותרת\n\n- פריט\n"
        result = ensure_blank_before_lists(text)
        assert result == text

    def test_inserts_blank_before_star_list_after_paragraph(self):
        text = "פסקה\n* פריט\n"
        result = ensure_blank_before_lists(text)
        assert "\n\n* פריט" in result

    def test_inserts_blank_before_plus_list_after_paragraph(self):
        text = "פסקה\n+ פריט\n"
        result = ensure_blank_before_lists(text)
        assert "\n\n+ פריט" in result

    def test_star_consecutive_items_not_separated(self):
        text = "* אחד\n* שניים\n"
        result = ensure_blank_before_lists(text)
        assert result == text

    def test_empty_text(self):
        assert ensure_blank_before_lists("") == ""


# ---------------------------------------------------------------------------
# wrap_english_phrases
# ---------------------------------------------------------------------------

class TestWrapEnglishPhrases:

    # --- Multi-word wrapping ---

    def test_two_word_english_phrase_wrapped(self):
        result = wrap_english_phrases("ביצוע Pull Request")
        assert r"\LR{Pull Request}" in result

    def test_three_word_english_phrase_wrapped(self):
        result = wrap_english_phrases("עם Visual Studio Code")
        assert r"\LR{Visual Studio Code}" in result

    def test_single_english_word_wrapped(self):
        result = wrap_english_phrases("ביצוע Merge")
        assert r"\LR{Merge}" in result

    # --- Digit-hyphen prefix (3-way style) ---

    def test_digit_hyphen_prefix_included(self):
        result = wrap_english_phrases("מיזוג 3-way merge")
        assert r"\LR{3-way merge}" in result

    def test_digit_prefix_single_word(self):
        result = wrap_english_phrases("ביצוע 3-way")
        assert r"\LR{3-way}" in result

    # --- Trailing punctuation in \RL{} ---

    def test_trailing_period_wrapped_in_rl(self):
        result = wrap_english_phrases("Fast Forward.")
        assert r"\LR{Fast Forward}" in result
        assert r"\RL{.}" in result

    def test_trailing_comma_wrapped_in_rl(self):
        result = wrap_english_phrases("Pull Request,")
        assert r"\RL{,}" in result

    def test_trailing_colon_wrapped_in_rl(self):
        result = wrap_english_phrases("Working Directory:")
        assert r"\RL{:}" in result

    def test_no_trailing_punct_no_rl(self):
        result = wrap_english_phrases("git push")
        assert r"\RL{" not in result

    def test_single_word_trailing_period(self):
        result = wrap_english_phrases("Merge.")
        assert r"\LR{Merge}" in result
        assert r"\RL{.}" in result

    # --- LaTeX-special chars inside the phrase are escaped ---

    def test_underscore_in_word_escaped(self):
        # Regression: x86_64 -> \LR{x86_64} fed a bare _ into math mode →
        # "! Missing $ inserted". The _ must be escaped inside \LR{}.
        result = wrap_english_phrases("מעבד x86_64 הוא")
        assert r"\LR{x86\_64}" in result
        assert r"\LR{x86_64}" not in result

    def test_multiple_underscores_in_phrase_escaped(self):
        result = wrap_english_phrases("המשתנה my_var_name חשוב")
        assert r"\LR{my\_var\_name}" in result

    # --- Code spans left untouched ---

    def test_backtick_code_span_not_wrapped(self):
        result = wrap_english_phrases("הפקודה `git push` מעדכנת")
        assert "`git push`" in result
        assert r"\LR{git push}" not in result

    def test_code_span_with_surrounding_english_wrapped(self):
        # "then Pull Request" are consecutive Latin words after the code span — wrapped together
        text = "run `git push` then Pull Request"
        result = wrap_english_phrases(text)
        assert "`git push`" in result
        assert r"\LR{then Pull Request}" in result

    # --- Hebrew text untouched ---

    def test_pure_hebrew_unchanged(self):
        text = "זהו טקסט עברי בלבד ללא מילים באנגלית"
        result = wrap_english_phrases(text)
        assert result == text

    def test_hebrew_with_hyphen_prefix_english(self):
        # ב-Git: the hyphen prefix stays as-is, only "Git" gets wrapped
        result = wrap_english_phrases("ב-Git")
        assert r"\LR{Git}" in result
        assert "ב-" in result

    # --- Trailing hyphen/slash binds to following text, not the LTR run ---

    def test_trailing_hyphen_before_hebrew_excluded(self):
        # Regression: a hyphen between Latin and Hebrew used to be swallowed
        # into \LR{NP-}, so at render time it jumped to the left of NP and
        # collided with the preceding hyphen ("-NPשלמות"). It must stay outside.
        result = wrap_english_phrases("NP-שלמות")
        assert r"\LR{NP}" in result
        assert r"\LR{NP-}" not in result
        assert "}-שלמות" in result

    def test_hyphen_both_sides_binds_to_hebrew(self):
        # כ-NP-שלמה: only "NP" is wrapped; both hyphens stay as Hebrew-side text.
        result = wrap_english_phrases("כ-NP-שלמה")
        assert result == r"כ-\LR{NP}-שלמה"

    def test_internal_hyphen_kept(self):
        # NP-hard: hyphen between two Latin runs stays inside the LTR span.
        result = wrap_english_phrases("בעיית NP-hard קשה")
        assert r"\LR{NP-hard}" in result

    def test_trailing_slash_before_hebrew_excluded(self):
        # A trailing slash before Hebrew must not be pulled into the LTR run.
        result = wrap_english_phrases("ה-API/שלו")
        assert r"\LR{API}" in result
        assert r"\LR{API/}" not in result

    # --- Accented Latin letters stay inside the run ---

    def test_accented_letter_kept_in_run(self):
        # Regression: ASCII-only [A-Za-z] cut "Scheffé" -> \LR{Scheff}é, leaving
        # é in the RTL run so it rendered reordered as "éScheff".
        result = wrap_english_phrases("מבחן Scheffé כאן")
        assert r"\LR{Scheffé}" in result
        assert r"\LR{Scheff}é" not in result

    def test_accented_leading_letter_starts_run(self):
        # An accented letter must also be a valid run START, not just a body char.
        result = wrap_english_phrases("העיר Évian יפה")
        assert r"\LR{Évian}" in result

    def test_division_sign_not_treated_as_letter(self):
        # × (U+00D7) and ÷ (U+00F7) sit inside the Latin-1 block but are NOT
        # letters — they must not extend or start a run.
        result = wrap_english_phrases("ביטוי a÷b כאן")
        assert r"\LR{a÷b}" not in result

    # --- Apostrophe possessives/contractions kept as one run ---

    def test_curly_apostrophe_possessive_kept_in_run(self):
        # Regression: Tukey’s used to split into \LR{Tukey}’\LR{s}, leaving the
        # neutral ’ in RTL so it reordered ("s HSD'Tukey"). Must be one run.
        result = wrap_english_phrases("מבחן Tukey’s HSD כאן")
        assert r"\LR{Tukey’s HSD}" in result
        assert r"\LR{Tukey}’" not in result

    def test_straight_apostrophe_contraction_kept_in_run(self):
        result = wrap_english_phrases("the user can't do it")
        assert r"\LR{the user can't do it}" in result

    def test_trailing_apostrophe_before_hebrew_excluded(self):
        # An apostrophe NOT followed by a letter/digit (here a closing quote
        # before Hebrew) must stay outside the LTR run.
        result = wrap_english_phrases("ה-class’ שלו")
        assert r"\LR{class}" in result
        assert r"\LR{class’}" not in result

    # --- Markdown structure preserved ---

    def test_heading_marker_preserved(self):
        result = wrap_english_phrases("## Pull Request")
        assert result.startswith("##")

    def test_bold_english_phrase_wrapped_and_markers_preserved(self):
        result = wrap_english_phrases("**Pull Request:**")
        assert "**" in result
        assert r"\LR{Pull Request}" in result

    def test_multiline_text(self):
        text = "שורה ראשונה\nPull Request עם Merge\nשורה שלישית\n"
        result = wrap_english_phrases(text)
        assert r"\LR{Pull Request}" in result
        assert r"\LR{Merge}" in result
        assert "שורה ראשונה" in result
        assert "שורה שלישית" in result

    # --- Math spans left untouched ---

    def test_inline_math_not_wrapped(self):
        result = wrap_english_phrases("ערך $4 \\times 4 = 16$ נכון")
        assert "$4 \\times 4 = 16$" in result
        assert r"\LR{times}" not in result

    def test_display_math_not_wrapped(self):
        result = wrap_english_phrases("$$a \\times b = c$$")
        assert "$$a \\times b = c$$" in result
        assert r"\LR{times}" not in result

    def test_multiline_display_math_not_wrapped(self):
        # Regression: line-by-line splitting used to leak Latin tokens inside
        # multi-line $$...$$ blocks, producing \LR{W} inside math mode →
        # LaTeX "Missing $ inserted" via pandoc.
        block = (
            "טקסט\n"
            "$$\n"
            "W = (X^T X + \\lambda I)^{-1} X^T Y \\\\\n"
            "= V (D^2 + \\lambda I)^{-1} D U^T Y\n"
            "$$\n"
            "המשך"
        )
        result = wrap_english_phrases(block)
        assert r"\LR{W}" not in result
        assert r"\LR{V}" not in result
        assert r"\LR{D U" not in result
        assert "W = (X^T X" in result

    def test_math_and_english_outside_wrapped(self):
        result = wrap_english_phrases("ראה $x \\times y$ ואז Pull Request")
        assert "$x \\times y$" in result
        assert r"\LR{Pull Request}" in result
        assert r"\LR{times}" not in result

    def test_dollar_code_spans_protected_as_code_not_math(self):
        # Regression: the protection regex paired `$` across two code spans,
        # protecting the Hebrew between them as a fake math span. The backtick
        # code spans must survive so force_ltr_inline_code can escape them.
        result = wrap_english_phrases("הסימן `$` לפני שמו. ללא הסימן `$` סוף")
        assert "`$`" in result
        assert r"\LR{$" not in result

    # --- Abbreviation period kept inside the run ---

    def test_abbreviation_period_kept_in_run(self):
        # Regression: "vs." split into \LR{SMP vs}\RL{.} \LR{AMP}, leaving the
        # neutral period in RTL so it reordered. The whole phrase is one run.
        result = wrap_english_phrases("המושג SMP vs. AMP כאן")
        assert r"\LR{SMP vs. AMP}" in result
        assert r"\RL{.}" not in result

    def test_sentence_final_period_before_hebrew_stays_rl(self):
        # The abbreviation rule must NOT absorb a real sentence period that is
        # followed by Hebrew — it stays RTL so it renders in reading order.
        result = wrap_english_phrases("ראה Foo. עברית")
        assert r"\LR{Foo}" in result
        assert r"\RL{.}" in result

    # --- Parenthesized acronym kept inside the run ---

    def test_parenthesized_acronym_kept_in_run(self):
        # Regression: the parens fell outside the \LR runs, so the two LTR
        # islands and the neutral ( ) reordered to "Multiprocessing Symmetric) SMP".
        result = wrap_english_phrases('כגון "Symmetric Multiprocessing (SMP)" שם')
        assert r"\LR{Symmetric Multiprocessing (SMP)}" in result

    def test_leading_and_trailing_parens_group_wrapped(self):
        # A whole parenthetical English phrase (incl. an abbreviation period)
        # is wrapped as one group; the trailing colon stays in \RL{}.
        result = wrap_english_phrases("עבודה (SMP vs. AMP): המרצה")
        assert r"\LR{(SMP vs. AMP)}" in result
        assert r"\RL{:}" in result

    def test_unbalanced_close_paren_not_swallowed(self):
        # Edge: the ( belongs to the Hebrew side; the matching ) must NOT be
        # pulled into the LTR run (that would orphan a paren in the run).
        result = wrap_english_phrases("טקסט (ראה Pull Request) כאן")
        assert r"\LR{Pull Request}" in result
        assert r"\LR{Pull Request)}" not in result


# ---------------------------------------------------------------------------
# unwrap_math_code
# ---------------------------------------------------------------------------

class TestUnwrapMathCode:
    def test_backtick_math_unwrapped(self):
        # Regression: the LLM wraps math in backticks, so force_ltr_inline_code
        # escaped the $ into literal \texttt text instead of rendering math.
        assert unwrap_math_code(r"`$RDI \leftarrow RSI$`") == r"$RDI \leftarrow RSI$"

    def test_list_item_with_backtick_math(self):
        text = r"1. `$A \oplus B = C$`"
        assert unwrap_math_code(text) == r"1. $A \oplus B = C$"

    def test_real_register_code_left_untouched(self):
        # A code span that is NOT pure math (a register name) stays as code.
        text = "את הערך של `RSI` כאן"
        assert unwrap_math_code(text) == text

    def test_mixed_line_only_math_span_unwrapped(self):
        # On a line with both math-in-code and real code, only the math is
        # unwrapped; the register backticks survive.
        text = r"`$A \oplus B$` ואז `RSI`"
        assert unwrap_math_code(text) == r"$A \oplus B$ ואז `RSI`"

    def test_display_math_in_code_unwrapped(self):
        assert unwrap_math_code(r"`$$a + b$$`") == r"$$a + b$$"

    def test_surrounding_whitespace_in_code_stripped(self):
        assert unwrap_math_code(r"` $x^2$ `") == r"$x^2$"

    def test_code_with_text_after_math_not_unwrapped(self):
        # The closing backtick must follow the closing $ — code that mixes a
        # math span with trailing prose is left as a real code span.
        text = r"`$x$ and more`"
        assert unwrap_math_code(text) == text

    def test_plain_code_without_dollar_unchanged(self):
        text = "`git push` כאן"
        assert unwrap_math_code(text) == text

    def test_no_backticks_unchanged(self):
        text = "טקסט רגיל ללא קוד"
        assert unwrap_math_code(text) == text

    def test_multiple_math_code_spans_each_unwrapped(self):
        text = r"`$a$` ו-`$b$`"
        assert unwrap_math_code(text) == r"$a$ ו-$b$"

    def test_literal_dollar_code_spans_not_fused_across_backticks(self):
        # Regression: two separate inline-code spans each holding a literal `$`
        # were fused into one fake `$...$` math span swallowing the Hebrew
        # between them, producing \(\LR{\texttt{...}}\) -> "Missing $ inserted".
        text = "הסימן `$` לפני שמו. ללא הסימן `$`,"
        assert unwrap_math_code(text) == text


# ---------------------------------------------------------------------------
# unwrap_math_text_macros
# ---------------------------------------------------------------------------

class TestUnwrapMathTextMacros:
    def test_lone_macro_unwrapped(self):
        # Regression: \text{\Pi}_k errors with "Missing $ inserted" because
        # \Pi is undefined in \text's text mode.
        assert unwrap_math_text_macros(r"$\text{\Pi}_k = co\Sigma_k$") == \
            r"$\Pi_k = co\Sigma_k$"

    def test_multiple_occurrences_unwrapped(self):
        text = r"המחלקה $\text{\Pi}_k$ והמחלקה $\text{\Pi}_2$"
        assert unwrap_math_text_macros(text) == \
            r"המחלקה $\Pi_k$ והמחלקה $\Pi_2$"

    def test_real_text_left_untouched(self):
        # \text wrapping actual prose must survive — only lone macros are unwrapped.
        text = r"$\dots Q_k y_k \text{ s.t. } V(x) = 1$"
        assert unwrap_math_text_macros(text) == text

    def test_whitespace_inside_braces_tolerated(self):
        assert unwrap_math_text_macros(r"$\text{ \Pi }_k$") == r"$\Pi_k$"

    def test_no_text_macro_is_noop(self):
        text = r"$\Sigma_k = co\Pi_k$"
        assert unwrap_math_text_macros(text) == text


# ---------------------------------------------------------------------------
# normalize_math_text_spaces
# ---------------------------------------------------------------------------

class TestNormalizeMathTextSpaces:
    def test_leading_space_moved_out(self):
        # Regression: \text{ steps}'s leading space is trimmed at the bidi
        # boundary, fusing onto the preceding token -> "tsteps".
        assert normalize_math_text_spaces(r"t \text{ steps}") == \
            r"t \ \text{steps}"

    def test_trailing_space_only_moved_out(self):
        # Only the trailing edge has a space — only a trailing \  is emitted,
        # the leading side stays fused as the source intended.
        assert normalize_math_text_spaces(r"\text{steps } b") == \
            r"\text{steps}\  b"

    def test_leading_and_trailing_space_moved_out(self):
        assert normalize_math_text_spaces(r"1 \text{ within } t") == \
            r"1 \ \text{within}\  t"

    def test_no_edge_space_left_untouched(self):
        text = r"V(x) = 1 \text{within} t"
        assert normalize_math_text_spaces(text) == text

    def test_inner_space_preserved(self):
        assert normalize_math_text_spaces(r"\text{ s.t. }") == \
            r"\ \text{s.t.}\ "

    def test_whitespace_only_body_collapses_to_space(self):
        assert normalize_math_text_spaces(r"a \text{ } b") == r"a \  b"

    def test_full_issue_expression_renders_space(self):
        # The original bug report: both \text{} edge spaces must survive.
        text = r"$$V(x, y_1, y_2) = 1 \text{ within } t \text{ steps}$$"
        assert normalize_math_text_spaces(text) == \
            r"$$V(x, y_1, y_2) = 1 \ \text{within}\  t \ \text{steps}$$"

    # --- false positives: don't inject spaces where none are needed ---

    def test_no_edge_space_multiword_untouched(self):
        # A \text{} with no leading/trailing space already renders fine — must
        # NOT gain spurious \  around it just because it sits between tokens.
        text = r"a \text{if and only if} b"
        assert normalize_math_text_spaces(text) == text

    def test_sibling_text_macros_untouched(self):
        # \textbf / \texttt / \textit are NOT \text — the regex must not match
        # them and strip their formatting.
        for macro in (r"\textbf", r"\texttt", r"\textit", r"\textrm", r"\textsf"):
            text = macro + r"{ x }"
            assert normalize_math_text_spaces(text) == text

    def test_idempotent(self):
        # Running twice must not pile on more control spaces.
        once = normalize_math_text_spaces(r"1 \text{ within } t \text{ steps}")
        assert normalize_math_text_spaces(once) == once

    def test_no_text_macro_is_noop(self):
        text = r"המחלקה $\Sigma_k = co\Pi_k$ סגורה"
        assert normalize_math_text_spaces(text) == text


# ---------------------------------------------------------------------------
# normalize_math_spans
# ---------------------------------------------------------------------------

class TestNormalizeMathSpans:
    def test_leading_space_inside_inline_math_stripped(self):
        # The bug: pandoc requires no space after the opening $.
        assert normalize_math_spans("($ \\geq 0$)") == "($\\geq 0$)"

    def test_trailing_space_inside_inline_math_stripped(self):
        assert normalize_math_spans("$x + 1 $") == "$x + 1$"

    def test_both_sides_padded_inline_math_stripped(self):
        assert normalize_math_spans("$ a + b $") == "$a + b$"

    def test_clean_inline_math_unchanged(self):
        assert normalize_math_spans("$x^2$") == "$x^2$"

    def test_inner_spaces_preserved(self):
        # Only edge whitespace is trimmed; internal spacing must survive.
        assert normalize_math_spans("$ a + b + c $") == "$a + b + c$"

    def test_display_math_with_inner_padding_unchanged(self):
        # $$...$$ has different parsing rules; don't touch it.
        text = "$$ a + b $$"
        assert normalize_math_spans(text) == text

    def test_display_math_multiline_unchanged(self):
        text = "$$\na + b = c\n$$"
        assert normalize_math_spans(text) == text

    def test_multiple_inline_math_spans(self):
        result = normalize_math_spans("$ a $ ו-$ b $")
        assert result == "$a$ ו-$b$"

    def test_hebrew_text_with_math_real_example(self):
        # The actual failing snippet from the issue.
        text = "אם התוצאה יכולה להיות גם אפס ($ \\geq 0$), המטריצה"
        result = normalize_math_spans(text)
        assert "($\\geq 0$)" in result
        assert "$ \\geq" not in result

    def test_no_math_unchanged(self):
        text = "טקסט ללא מתמטיקה"
        assert normalize_math_spans(text) == text

    def test_lone_dollar_unchanged(self):
        # A single $ with no closing partner is not a math span.
        text = "price is $5 today"
        assert normalize_math_spans(text) == text

    def test_dollars_in_separate_code_spans_not_paired(self):
        # A `$` inside inline code is a literal dollar, not a math delimiter:
        # the inline-math pattern must not pair `$` across a backtick boundary.
        text = "הסימן `$` לפני שמו. ללא הסימן `$`,"
        assert normalize_math_spans(text) == text


# ---------------------------------------------------------------------------
# wrap_math_text_ltr
# ---------------------------------------------------------------------------

class TestWrapMathTextLtr:
    def test_text_body_wrapped_in_lr(self):
        # Regression: English inside \text{} in math renders RTL (words reversed)
        # because text mode inherits the document's RTL base direction.
        text = r"$$cyclic = \{G \mid G \text{is an undirected graph}\}$$"
        result = wrap_math_text_ltr(text)
        assert r"\text{\LR{is an undirected graph}}" in result

    def test_short_text_wrapped(self):
        assert wrap_math_text_ltr(r"\text{steps}") == r"\text{\LR{steps}}"

    def test_text_with_spaces_around_macro(self):
        # The space between \text and { is cosmetic in LaTeX; collapsing it is fine.
        assert wrap_math_text_ltr(r"\text {within}") == r"\text{\LR{within}}"

    def test_multiple_text_macros_each_wrapped(self):
        result = wrap_math_text_ltr(r"\text{from} a \text{to} b")
        assert result == r"\text{\LR{from}} a \text{\LR{to}} b"

    def test_whitespace_only_body_untouched(self):
        # normalize_math_text_spaces turns edge-only \text{} into \ ; a body that
        # is only whitespace must not be wrapped (an empty \LR is pointless).
        assert wrap_math_text_ltr(r"\text{ }") == r"\text{ }"

    def test_no_text_macro_unchanged(self):
        text = "טקסט עברי $x^2 + 1$ רגיל"
        assert wrap_math_text_ltr(text) == text

    def test_nested_braces_body_left_alone(self):
        # The regex deliberately excludes inner braces; a \text{} containing a
        # macro group is not a plain-text run and is left as-is.
        text = r"\text{\alpha{}}"
        assert wrap_math_text_ltr(text) == text


# ---------------------------------------------------------------------------
# merge_ltr_math
# ---------------------------------------------------------------------------

class TestMergeLtrMath:
    def test_code_then_math_merged(self):
        # Regression: \LR{\texttt{current}} and $\leftarrow v$ are separate LTR
        # islands; RTL bidi reverses them to "← v current".
        text = r"\LR{\texttt{current}} $\leftarrow v$"
        assert merge_ltr_math(text) == r"\LR{\texttt{current} $\leftarrow v$}"

    def test_math_then_code_merged(self):
        text = r"$\leftarrow v$ \LR{\texttt{current}}"
        assert merge_ltr_math(text) == r"\LR{$\leftarrow v$ \texttt{current}}"

    def test_word_lr_then_math_merged(self):
        text = r"\LR{RDI} $\oplus$"
        assert merge_ltr_math(text) == r"\LR{RDI $\oplus$}"

    def test_no_space_between_still_merged(self):
        text = r"\LR{\texttt{x}}$+1$"
        assert merge_ltr_math(text) == r"\LR{\texttt{x} $+1$}"

    def test_lr_with_escaped_braces_matched(self):
        # _lr_block_end must count nested/escaped braces — \texttt body can hold
        # escaped braces so the matching close is the second-to-last brace.
        text = r"\LR{\texttt{a\{b\}}} $x$"
        assert merge_ltr_math(text) == r"\LR{\texttt{a\{b\}} $x$}"

    def test_lone_math_untouched(self):
        text = r"עברית $A$ עברית"
        assert merge_ltr_math(text) == text

    def test_lone_lr_untouched(self):
        text = r"עברית \LR{Word} עברית"
        assert merge_ltr_math(text) == text

    def test_display_math_not_descended_into(self):
        # $$...$$ holds its own \LR (from wrap_math_text_ltr); merge must skip it
        # wholesale and never pull an adjacent inline $ into it.
        text = r"$$a \text{\LR{x}} b$$ $y$"
        assert merge_ltr_math(text) == text

    def test_lr_separated_by_hebrew_not_merged(self):
        text = r"\LR{Word} עברית $A$"
        assert merge_ltr_math(text) == text


# ---------------------------------------------------------------------------
# force_ltr_inline_code
# ---------------------------------------------------------------------------

class TestForceLtrInlineCode:
    def test_two_word_code_wrapped_in_lr_texttt(self):
        # The bug: "void execute" rendered as "execute void" in RTL paragraphs.
        result = force_ltr_inline_code("הפקודה `void execute` מבצעת")
        assert r"\LR{\texttt{void execute}}" in result
        assert "`void execute`" not in result

    def test_single_word_code_wrapped(self):
        result = force_ltr_inline_code("פקודה `push` כאן")
        assert r"\LR{\texttt{push}}" in result

    def test_multiple_code_spans_each_wrapped(self):
        result = force_ltr_inline_code("`git push` ואז `git pull`")
        assert r"\LR{\texttt{git push}}" in result
        assert r"\LR{\texttt{git pull}}" in result

    def test_latex_special_underscore_escaped(self):
        result = force_ltr_inline_code("`my_var`")
        assert r"\LR{\texttt{my\_var}}" in result

    def test_latex_special_hash_escaped(self):
        result = force_ltr_inline_code("`#include`")
        assert r"\LR{\texttt{\#include}}" in result

    def test_latex_special_dollar_escaped(self):
        result = force_ltr_inline_code("`$var`")
        assert r"\LR{\texttt{\$var}}" in result

    def test_latex_special_backslash_escaped(self):
        result = force_ltr_inline_code("`a\\b`")
        assert r"\LR{\texttt{a\textbackslash{}b}}" in result

    def test_latex_special_braces_escaped(self):
        result = force_ltr_inline_code("`{x}`")
        assert r"\LR{\texttt{\{x\}}}" in result

    def test_latex_special_caret_and_tilde_escaped(self):
        result = force_ltr_inline_code("`a^b~c`")
        assert r"\textasciicircum{}" in result
        assert r"\textasciitilde{}" in result

    def test_no_backticks_unchanged(self):
        text = "טקסט ללא קוד"
        assert force_ltr_inline_code(text) == text

    def test_fenced_code_block_not_touched(self):
        # Triple-backtick fences span newlines; the regex only matches inline.
        text = "```\nvoid execute\n```\n"
        assert force_ltr_inline_code(text) == text

    def test_empty_backticks_unchanged(self):
        # An empty `` is not a code span (needs at least one char).
        text = "before `` after"
        assert force_ltr_inline_code(text) == text

    def test_backslash_does_not_re_escape_inserted_underscore(self):
        # If escape order is wrong, `\\` -> `\textbackslash{}` -> the `_`
        # inside that replacement gets escaped again. Guard against that.
        result = force_ltr_inline_code("`\\`")
        assert result == r"\LR{\texttt{\textbackslash{}}}"


# ---------------------------------------------------------------------------
# apply_outside_fences
# ---------------------------------------------------------------------------

class TestApplyOutsideFences:
    def test_transform_runs_outside_fence(self):
        text = "hello\n```\nworld\n```\n"
        # Transform that uppercases — easy to assert "what ran where".
        result = apply_outside_fences(text, str.upper)
        assert result == "HELLO\n```\nworld\n```\n"

    def test_fence_content_untouched(self):
        text = "```\nimport socket\n```\n"
        result = apply_outside_fences(text, str.upper)
        # Fence content preserved exactly.
        assert "import socket" in result
        assert "IMPORT SOCKET" not in result

    def test_language_tag_fence_recognized(self):
        text = "before\n```python\nimport socket\n```\nafter\n"
        result = apply_outside_fences(text, str.upper)
        assert "import socket" in result
        assert "BEFORE" in result
        assert "AFTER" in result

    def test_tilde_fence_recognized(self):
        text = "before\n~~~\nimport socket\n~~~\nafter\n"
        result = apply_outside_fences(text, str.upper)
        assert "import socket" in result
        assert "BEFORE" in result

    def test_multiple_fences(self):
        text = "a\n```\nx\n```\nb\n```\ny\n```\nc\n"
        result = apply_outside_fences(text, str.upper)
        assert result == "A\n```\nx\n```\nB\n```\ny\n```\nC\n"

    def test_no_fence_full_transform(self):
        text = "plain prose"
        assert apply_outside_fences(text, str.upper) == "PLAIN PROSE"

    def test_unterminated_fence_keeps_tail_untouched(self):
        # If the closing fence is missing, treat the tail as inside-fence
        # rather than leaking the transform into code.
        text = "before\n```\nimport socket\n"
        result = apply_outside_fences(text, str.upper)
        assert "import socket" in result
        assert "BEFORE" in result

    def test_full_pipeline_does_not_mangle_python_block(self):
        # Regression for the actual bug: \LR{...}, \texttt{...}, dash/math
        # normalization all leaked into fenced code. Compose the real pipeline
        # exactly as convert_to_pdf does.
        md = (
            "מימוש בסיסי של שרת UDP ב-Python נראה כך:\n"
            "```python\n"
            "from socket import socket, AF_INET, SOCK_DGRAM\n"
            "\n"
            "s = socket(AF_INET, SOCK_DGRAM)\n"
            "s.bind(('', 19345))\n"
            "```\n"
        )

        def pipeline(t):
            return force_ltr_inline_code(
                wrap_english_phrases(
                    ensure_blank_before_lists(
                        normalize_math_spans(normalize_dashes(t))
                    )
                )
            )

        result = apply_outside_fences(md, pipeline)
        # Code-block contents stay verbatim.
        assert "from socket import socket, AF_INET, SOCK_DGRAM" in result
        assert "s = socket(AF_INET, SOCK_DGRAM)" in result
        assert "s.bind(('', 19345))" in result
        # No LaTeX wrappers leaked into the code block.
        fence_start = result.index("```python")
        fence_end = result.index("```", fence_start + 3)
        code_section = result[fence_start:fence_end]
        assert r"\LR{" not in code_section
        assert r"\texttt{" not in code_section
        # But the surrounding Hebrew prose still got Python wrapped LTR.
        assert r"\LR{Python}" in result


# ---------------------------------------------------------------------------
# wrap_english_phrases — extended token coverage (paths, versions, filenames)
# ---------------------------------------------------------------------------

class TestWrapEnglishPhrasesExtended:

    # --- URL-style paths ---

    def test_url_path_single_segment_wrapped(self):
        # /index.html starts with '/' so the old regex skipped it entirely.
        result = wrap_english_phrases("קרא /index.html")
        assert r"\LR{/index.html}" in result

    def test_url_path_multi_segment_wrapped(self):
        result = wrap_english_phrases("נתיב /api/v2/users")
        assert r"\LR{/api/v2/users}" in result

    def test_http_request_line_wrapped_as_single_phrase(self):
        # The whole line must be one \LR group, not three separate ones,
        # so the BiDi algorithm can't reverse the token order.
        result = wrap_english_phrases("GET /index.html HTTP/1.1")
        assert r"\LR{GET /index.html HTTP/1.1}" in result

    # --- Protocol/version tokens with slashes ---

    def test_protocol_version_wrapped(self):
        result = wrap_english_phrases("פרוטוקול HTTP/1.1")
        assert r"\LR{HTTP/1.1}" in result

    def test_version_string_wrapped(self):
        result = wrap_english_phrases("גרסה v1.0.0")
        assert r"\LR{v1.0.0}" in result

    # --- Dotted names (filenames, package names) ---

    def test_filename_with_extension_wrapped(self):
        result = wrap_english_phrases("קובץ index.html")
        assert r"\LR{index.html}" in result

    def test_nodejs_package_name_wrapped(self):
        result = wrap_english_phrases("ספריית Node.js")
        assert r"\LR{Node.js}" in result

    # --- Underscore identifiers ---

    def test_underscore_identifier_wrapped(self):
        # The _ must be escaped — a bare _ inside \LR{} enters math mode and
        # XeLaTeX fails with "! Missing $ inserted".
        result = wrap_english_phrases("משתנה my_variable")
        assert r"\LR{my\_variable}" in result

    # --- Trailing-dot still ends up in \\RL{} ---

    def test_http_version_trailing_period_in_rl(self):
        # The sentence dot after "HTTP/1.1" must NOT be consumed as part of
        # the token — it should still land in the punctuation \RL{} group.
        result = wrap_english_phrases("פרוטוקול HTTP/1.1.")
        assert r"\LR{HTTP/1.1}" in result
        assert r"\RL{.}" in result

    def test_dotted_filename_trailing_period_in_rl(self):
        result = wrap_english_phrases("קובץ index.html.")
        assert r"\LR{index.html}" in result
        assert r"\RL{.}" in result

    # --- Existing behaviour is preserved ---

    def test_plain_multi_word_still_wrapped(self):
        result = wrap_english_phrases("ביצוע Pull Request")
        assert r"\LR{Pull Request}" in result

    def test_digit_hyphen_prefix_still_works(self):
        result = wrap_english_phrases("מיזוג 3-way merge")
        assert r"\LR{3-way merge}" in result

    def test_hebrew_prefix_hyphen_word_still_works(self):
        result = wrap_english_phrases("ב-Git")
        assert r"\LR{Git}" in result
        assert "ב-" in result

    # --- Numbers joining a phrase (Software 1.0) ---

    def test_word_then_number_wrapped_together(self):
        # Regression: a lone "1.0" stays a neutral and RTL bidi reorders
        # "Software 1.0" to "1.0 Software".
        result = wrap_english_phrases("גרסת Software 1.0 חדשה")
        assert r"\LR{Software 1.0}" in result

    def test_lone_number_after_hebrew_not_wrapped(self):
        # A number that is not preceded by a Latin word must stay in the RTL run.
        result = wrap_english_phrases("יש 5 סטודנטים")
        assert r"\LR" not in result

    def test_digit_paren_group_keeps_parens_outside_run(self):
        # A ) right after a digit mirrors to ( inside \LR{} in an RTL doc, so a
        # digit-terminated parenthetical keeps its parens OUTSIDE the run.
        result = wrap_english_phrases("תוכנה (Software 1.0): טקסט")
        assert r"(\LR{Software 1.0})" in result
        assert r"\LR{(Software 1.0)}" not in result
        assert r"\RL{:}" in result

    def test_letter_paren_group_keeps_parens_inside_run(self):
        # Letter-terminated groups don't mirror — parens stay inside as before.
        result = wrap_english_phrases("עבודה (SMP vs. AMP): המרצה")
        assert r"\LR{(SMP vs. AMP)}" in result

    def test_number_inside_paren_group_with_preceding_word(self):
        result = wrap_english_phrases("המודל (test 1.0) שלנו")
        assert r"(\LR{test 1.0})" in result

    # --- Slash bridging Hebrew and English is a separator, not glued ---

    def test_hebrew_slash_english_keeps_slash_in_rtl(self):
        # Regression: \LR{/kernels} put the slash on the run's far edge so it
        # read "גרעינים kernels/". The slash must stay outside the run.
        result = wrap_english_phrases("גרעינים/kernels")
        assert r"/\LR{kernels}" in result
        assert r"\LR{/kernels}" not in result

    def test_space_separated_leading_slash_still_glued(self):
        # A real path slash is preceded by a space, not a Hebrew letter.
        result = wrap_english_phrases("נתיב /kernels")
        assert r"\LR{/kernels}" in result


# ---------------------------------------------------------------------------
# Lua filter — integration test via `pandoc --to=latex`
# ---------------------------------------------------------------------------

def _pandoc_available():
    return shutil.which("pandoc") is not None


@pytest.mark.skipif(not _pandoc_available(), reason="pandoc not installed")
class TestLuaFilterLtrCodeBlock:

    def _run_pandoc_latex(self, md: str) -> str:
        """Run pandoc with ltr_code.lua and return the LaTeX body."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as f:
            f.write(md)
            md_path = f.name
        try:
            result = subprocess.run(
                [
                    "pandoc", md_path,
                    "--to=latex",
                    f"--lua-filter={LTR_CODE_FILTER}",
                ],
                capture_output=True, text=True,
            )
            assert result.returncode == 0, f"pandoc failed:\n{result.stderr}"
            return result.stdout
        finally:
            os.unlink(md_path)

    def test_code_block_wrapped_in_english(self):
        # Core structure: every code block must be wrapped in
        # \begin{english}...\end{english} (polyglossia language switch).
        # This sets the LOCAL base direction to LTR, which both fixes word
        # order AND disables character mirroring inside fancyvrb's Verbatim.
        # \begin{LTR} (bidi run direction) alone fixes word order but NOT
        # mirroring — see ltr_code.lua for the full rationale.
        latex = self._run_pandoc_latex("```\nGET /index.html HTTP/1.1\n```\n")
        assert r"\begin{english}" in latex
        assert r"\end{english}" in latex

    def test_english_wraps_verbatim_for_plain_blocks(self):
        # Plain code block (no language tag) → verbatim is inside english.
        latex = self._run_pandoc_latex("```\nsome code\n```\n")
        assert latex.index(r"\begin{english}") < latex.index(r"\begin{verbatim}")
        assert latex.index(r"\end{verbatim}") < latex.index(r"\end{english}")

    def test_english_wraps_shaded_for_highlighted_blocks(self):
        # Syntax-highlighted block (language tag) → Shaded/Highlighting inside
        # english. Highlighting is preserved (colours still work); english
        # wraps the whole thing.
        latex = self._run_pandoc_latex("```python\nimport os\n```\n")
        assert r"\begin{Shaded}" in latex
        assert latex.index(r"\begin{english}") < latex.index(r"\begin{Shaded}")
        assert latex.index(r"\end{Shaded}") < latex.index(r"\end{english}")

    def test_code_block_content_preserved(self):
        latex = self._run_pandoc_latex("```\nGET /index.html HTTP/1.1\n```\n")
        assert "GET /index.html HTTP/1.1" in latex

    def test_brackets_in_source_unmangled(self):
        # The literal bracket characters must appear in the LaTeX source.
        # The polyglossia english environment around them disables XeTeX
        # character mirroring at render time.
        latex = self._run_pandoc_latex(
            "```javascript\napp.get('/', (req, res) => {\n```\n"
        )
        assert "(" in latex
        assert "{" in latex
        # The earlier \LTRverbatim attempt caused "undefined" errors — guard.
        assert r"\begin{LTRverbatim}" not in latex

    def test_json_block_syntax_highlighted(self):
        # JSON block must use Shaded/Highlighting (colours preserved).
        md = '```json\n{\n  "method": "GET",\n  "url": "/index.html"\n}\n```\n'
        latex = self._run_pandoc_latex(md)
        assert r"\begin{english}" in latex
        assert r"\begin{Shaded}" in latex
        # Content appears in tokenised form (e.g. \StringTok, \DataTypeTok)
        assert '"method"' in latex
        assert '"GET"' in latex

    def test_multiple_code_blocks_each_wrapped(self):
        md = "```\nblock one\n```\n\nsome prose\n\n```\nblock two\n```\n"
        latex = self._run_pandoc_latex(md)
        assert latex.count(r"\begin{english}") == 2
        assert latex.count(r"\end{english}") == 2

    def test_prose_without_code_block_not_wrapped(self):
        # Plain paragraphs must not get spurious english-env wrapping.
        latex = self._run_pandoc_latex("Just a paragraph with no code.\n")
        assert r"\begin{english}" not in latex

    def test_filter_file_exists(self):
        assert LTR_CODE_FILTER.exists(), f"filter missing: {LTR_CODE_FILTER}"


# ---------------------------------------------------------------------------
# Mono font for code blocks — must cover Hebrew
#
# Code blocks are wrapped in \begin{english} (ltr_code.lua), and fancyvrb's
# Verbatim uses the GLOBAL \ttfamily — NOT polyglossia's \englishfonttt gloss.
# A Latin-only mono (Noto Sans Mono / Latin Modern Mono) makes Hebrew comments
# render as notdef boxes. The fix bundles the dual-script monospace Miriam Mono
# CLM and points \setmonofont at it. These guard against a silent regression to
# a Hebrew-less mono.
# ---------------------------------------------------------------------------

class TestMonoFontWiring:
    def test_miriam_mono_files_bundled(self):
        for name in ("MiriamMonoCLM-Book.ttf", "MiriamMonoCLM-Bold.ttf"):
            assert (FONTS_DIR / name).exists(), f"missing bundled mono font: {name}"

    def test_setmonofont_points_at_miriam(self):
        # Verbatim picks up the global mono font, so it must be set explicitly.
        assert r"\setmonofont{MiriamMonoCLM-Book}" in LATEX_HEADER

    def test_no_hebrewless_system_mono(self):
        # Noto Sans Mono has no Hebrew glyphs — must not be the code font.
        assert "Noto Sans Mono" not in LATEX_HEADER


# ---------------------------------------------------------------------------
# Full PDF render — the canonical bidi/font verification (see docs/PDF.md).
# Glyph fallback happens at XeLaTeX render time; string-level tests cannot catch
# a missing-Hebrew mono. Gated on the real toolchain (xelatex + pandoc + fitz).
# ---------------------------------------------------------------------------

def _xelatex_available():
    return shutil.which("xelatex") is not None


def _pymupdf_available():
    try:
        import fitz  # noqa: F401
        return True
    except ImportError:
        return False


@pytest.mark.skipif(
    not (_xelatex_available() and _pandoc_available() and _pymupdf_available()),
    reason="needs xelatex + pandoc + pymupdf to render and inspect a real PDF",
)
class TestHebrewInCodeBlockRenders:
    # Hebrew comment inside an assembly block — the exact regression report.
    MD = (
        "הפרולוג מייצר את מסגרת המחסנית החדשה עם כניסתנו לפונקציה:\n"
        "```assembly\n"
        "pushq %rbp          # שמירת בסיס המחסנית הישן של הפונקציה הקוראת\n"
        "movq %rsp, %rbp     # הגדרת בסיס המחסנית החדש במיקום הנוכחי של RSP\n"
        "```\n"
    )

    def _render_text(self) -> str:
        import fitz
        with tempfile.TemporaryDirectory() as d:
            md_path = os.path.join(d, "snippet.md")
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(self.MD)
            pdf_path = convert_to_pdf(md_path)
            try:
                return fitz.open(pdf_path).load_page(0).get_text()
            finally:
                os.unlink(pdf_path)

    def test_no_notdef_glyphs_in_code_block(self):
        # ￿ is what pymupdf emits for a notdef (missing) glyph — the bug.
        assert "￿" not in self._render_text()

    def test_hebrew_comment_words_rendered(self):
        text = self._render_text()
        # Words from the Hebrew comments must be present (PDF text order is
        # visual, so check membership of whole words, not the full line).
        for word in ("שמירת", "בסיס", "המחסנית", "הגדרת"):
            assert word in text, f"Hebrew word {word!r} missing from rendered code block"

