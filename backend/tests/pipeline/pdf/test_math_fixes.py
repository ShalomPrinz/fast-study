from pipeline.pdf.math_fixes import (
    close_unbalanced_display_math,
    demote_math_identifier,
    merge_ltr_math,
    merge_rtl_math_number,
    normalize_math_spans,
    normalize_math_text_spaces,
    unwrap_math_code,
    unwrap_math_text_macros,
    wrap_math_text_dir,
)

# ---------------------------------------------------------------------------
# close_unbalanced_display_math
# ---------------------------------------------------------------------------


class TestCloseUnbalancedDisplayMath:
    def test_lone_closing_dollar_is_doubled(self):
        # Regression: a block opened with $$ and closed with a single $ leaves a
        # stray delimiter that pairs with the NEXT $$, so every later math span
        # is mis-paired and its body escapes the protected region.
        text = r"$$W \sim \mathcal{N}\left(0, \frac{2}{n}\right)$"
        assert close_unbalanced_display_math(text) == text + "$"

    def test_later_math_stays_paired_after_fix(self):
        text = "$$a + b$\n\nטקסט\n\n$$\\frac{1}{2}$$\n"
        fixed = close_unbalanced_display_math(text)
        assert fixed.count("$") % 2 == 0
        assert "$$a + b$$" in fixed
        assert "$$\\frac{1}{2}$$" in fixed

    def test_trailing_whitespace_tolerated(self):
        assert close_unbalanced_display_math("$$x^2$   ") == "$$x^2$$"

    def test_indented_block_closed(self):
        assert close_unbalanced_display_math("  $$x^2$") == "  $$x^2$$"

    def test_balanced_display_math_untouched(self):
        text = r"$$\frac{1}{2}$$"
        assert close_unbalanced_display_math(text) == text

    def test_inline_math_untouched(self):
        text = "הערך $x$ גדול"
        assert close_unbalanced_display_math(text) == text

    def test_inline_math_alone_on_line_untouched(self):
        text = "$x + y$"
        assert close_unbalanced_display_math(text) == text

    def test_dollar_inside_code_span_untouched(self):
        text = "`$$x$`"
        assert close_unbalanced_display_math(text) == text

    def test_line_with_prose_after_closing_dollar_untouched(self):
        text = "$$x^2$ וטקסט"
        assert close_unbalanced_display_math(text) == text

    def test_empty_body_untouched(self):
        assert close_unbalanced_display_math("$$$") == "$$$"

    def test_multiline_display_block_untouched(self):
        text = "$$\na + b\n$$"
        assert close_unbalanced_display_math(text) == text

    def test_only_the_broken_line_changes(self):
        text = "שורה\n$$x^2$\n$$y^2$$\nסוף"
        assert close_unbalanced_display_math(text) == "שורה\n$$x^2$$\n$$y^2$$\nסוף"


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
        # between them, producing \(\LR{\textenglish{\texttt{...}}}\) -> "Missing $ inserted".
        text = "הסימן `$` לפני שמו. ללא הסימן `$`,"
        assert unwrap_math_code(text) == text


# ---------------------------------------------------------------------------
# demote_math_identifier
# ---------------------------------------------------------------------------


class TestDemoteMathIdentifier:
    def test_underscore_identifier_demoted_to_code(self):
        # Regression: $_exit$ makes the leading _ a subscript operator, so it
        # renders as a subscript "e" + "xit". It is a syscall name — route it
        # through inline code so it renders literally.
        assert demote_math_identifier("ש-$_exit$ היא") == "ש-`_exit` היא"

    def test_capitalized_identifier_demoted(self):
        assert demote_math_identifier("$_Exit$") == "`_Exit`"

    def test_multiple_identifiers_each_demoted(self):
        assert demote_math_identifier("$_exit$ ו-$_Exit$") == "`_exit` ו-`_Exit`"

    def test_real_subscript_untouched(self):
        # $x_i$ is real math (no leading _) — must not be demoted.
        assert demote_math_identifier("$x_i$") == "$x_i$"

    def test_leading_subscript_number_untouched(self):
        # $_2F_1$ — a digit right after the _, a real leading subscript.
        assert demote_math_identifier("$_2F_1$") == "$_2F_1$"

    def test_braced_subscript_untouched(self):
        assert demote_math_identifier("$a_{ij}$") == "$a_{ij}$"

    def test_single_char_after_underscore_untouched(self):
        # Narrow trigger: needs 2+ ident chars after _, so a lone $_x$ (an
        # empty-base subscript) is left as math.
        assert demote_math_identifier("$_x$") == "$_x$"

    def test_identifier_with_trailing_math_untouched(self):
        # Only fires when the WHOLE body is the identifier.
        assert demote_math_identifier("$_exit + 1$") == "$_exit + 1$"

    def test_display_math_delimiters_untouched(self):
        # The single-$ pattern must not split $$-display delimiters.
        text = "$$_exit + y$$"
        assert demote_math_identifier(text) == text

    def test_no_math_unchanged(self):
        text = "טקסט רגיל ללא מתמטיקה"
        assert demote_math_identifier(text) == text


# ---------------------------------------------------------------------------
# unwrap_math_text_macros
# ---------------------------------------------------------------------------


class TestUnwrapMathTextMacros:
    def test_lone_macro_unwrapped(self):
        # Regression: \text{\Pi}_k errors with "Missing $ inserted" because
        # \Pi is undefined in \text's text mode.
        assert (
            unwrap_math_text_macros(r"$\text{\Pi}_k = co\Sigma_k$")
            == r"$\Pi_k = co\Sigma_k$"
        )

    def test_multiple_occurrences_unwrapped(self):
        text = r"המחלקה $\text{\Pi}_k$ והמחלקה $\text{\Pi}_2$"
        assert unwrap_math_text_macros(text) == r"המחלקה $\Pi_k$ והמחלקה $\Pi_2$"

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
        assert normalize_math_text_spaces(r"t \text{ steps}") == r"t \ \text{steps}"

    def test_trailing_space_only_moved_out(self):
        # Only the trailing edge has a space — only a trailing \  is emitted,
        # the leading side stays fused as the source intended.
        assert normalize_math_text_spaces(r"\text{steps } b") == r"\text{steps}\  b"

    def test_leading_and_trailing_space_moved_out(self):
        assert (
            normalize_math_text_spaces(r"1 \text{ within } t")
            == r"1 \ \text{within}\  t"
        )

    def test_no_edge_space_left_untouched(self):
        text = r"V(x) = 1 \text{within} t"
        assert normalize_math_text_spaces(text) == text

    def test_inner_space_preserved(self):
        assert normalize_math_text_spaces(r"\text{ s.t. }") == r"\ \text{s.t.}\ "

    def test_whitespace_only_body_collapses_to_space(self):
        assert normalize_math_text_spaces(r"a \text{ } b") == r"a \  b"

    def test_full_issue_expression_renders_space(self):
        # The original bug report: both \text{} edge spaces must survive.
        text = r"$$V(x, y_1, y_2) = 1 \text{ within } t \text{ steps}$$"
        assert (
            normalize_math_text_spaces(text)
            == r"$$V(x, y_1, y_2) = 1 \ \text{within}\  t \ \text{steps}$$"
        )

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

    def test_reach_extends_to_a_bare_text_macro_in_prose(self):
        # Documents reach, not intent: the regex is region-wide, so a \text{} written
        # outside any $…$ is rewritten identically. Harmless — the chain only feeds it
        # prose regions, where a literal \text{} is not a real input.
        assert (
            normalize_math_text_spaces(r"טקסט \text{ prose } כאן")
            == r"טקסט \ \text{prose}\  כאן"
        )


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
# wrap_math_text_dir
# ---------------------------------------------------------------------------


class TestWrapMathTextDir:
    def test_text_body_wrapped_in_lr(self):
        # Regression: English inside \text{} in math renders RTL (words reversed)
        # because text mode inherits the document's RTL base direction.
        text = r"$$cyclic = \{G \mid G \text{is an undirected graph}\}$$"
        result = wrap_math_text_dir(text)
        assert r"\text{\LR{is an undirected graph}}" in result

    def test_short_text_wrapped(self):
        assert wrap_math_text_dir(r"\text{steps}") == r"\text{\LR{steps}}"

    def test_text_with_spaces_around_macro(self):
        # The space between \text and { is cosmetic in LaTeX; collapsing it is fine.
        assert wrap_math_text_dir(r"\text {within}") == r"\text{\LR{within}}"

    def test_multiple_text_macros_each_wrapped(self):
        result = wrap_math_text_dir(r"\text{from} a \text{to} b")
        assert result == r"\text{\LR{from}} a \text{\LR{to}} b"

    def test_whitespace_only_body_untouched(self):
        # normalize_math_text_spaces turns edge-only \text{} into \ ; a body that
        # is only whitespace must not be wrapped (an empty \LR is pointless).
        assert wrap_math_text_dir(r"\text{ }") == r"\text{ }"

    def test_no_text_macro_unchanged(self):
        text = "טקסט עברי $x^2 + 1$ רגיל"
        assert wrap_math_text_dir(text) == text

    def test_nested_braces_body_left_alone(self):
        # The regex deliberately excludes inner braces; a \text{} containing a
        # macro group is not a plain-text run and is left as-is.
        text = r"\text{\alpha{}}"
        assert wrap_math_text_dir(text) == text

    # --- Script-aware direction ---

    def test_hebrew_body_wrapped_in_rl(self):
        # Regression: a Hebrew body used to get \LR{}, forcing it into an LTR
        # island so it landed on the wrong side of the surrounding math.
        text = r"$$\alpha_i \ge 0 \quad \text{וכן} \quad \sum \alpha_i = 0$$"
        result = wrap_math_text_dir(text)
        assert r"\text{\RL{וכן}}" in result
        assert r"\LR{וכן}" not in result

    def test_hebrew_body_with_digit_wrapped_in_rl(self):
        assert wrap_math_text_dir(r"\text{שלב 2}") == r"\text{\RL{שלב 2}}"

    def test_mixed_body_takes_first_strong_char(self):
        # UAX#9 first-strong: the leading script sets the body's base direction.
        assert wrap_math_text_dir(r"\text{מטריצה A}") == r"\text{\RL{מטריצה A}}"
        assert wrap_math_text_dir(r"\text{matrix א}") == r"\text{\LR{matrix א}}"

    def test_no_strong_char_body_untouched(self):
        # Digits/punctuation only: nothing to reorder, and an island would just
        # give the neutrals a new bidi boundary to attach to.
        assert wrap_math_text_dir(r"\text{, }") == r"\text{, }"
        assert wrap_math_text_dir(r"\text{123}") == r"\text{123}"

    def test_abbreviation_body_still_ltr(self):
        assert wrap_math_text_dir(r"\text{s.t.}") == r"\text{\LR{s.t.}}"

    def test_reach_extends_to_a_bare_text_macro_in_prose(self):
        # Documents reach, not intent: same region-wide regex as
        # normalize_math_text_spaces — a prose \text{} gets the same direction wrapper.
        assert (
            wrap_math_text_dir(r"טקסט \text{prose} כאן")
            == r"טקסט \text{\LR{prose}} כאן"
        )


# ---------------------------------------------------------------------------
# merge_ltr_math
# ---------------------------------------------------------------------------


class TestMergeLtrMath:
    def test_code_then_math_merged(self):
        # Regression: \LR{\textenglish{\texttt{current}}} and $\leftarrow v$ are separate LTR
        # islands; RTL bidi reverses them to "← v current".
        text = r"\LR{\textenglish{\texttt{current}}} $\leftarrow v$"
        assert (
            merge_ltr_math(text)
            == r"\LR{\textenglish{\texttt{current}} $\leftarrow v$}"
        )

    def test_math_then_code_merged(self):
        text = r"$\leftarrow v$ \LR{\textenglish{\texttt{current}}}"
        assert (
            merge_ltr_math(text)
            == r"\LR{$\leftarrow v$ \textenglish{\texttt{current}}}"
        )

    def test_word_lr_then_math_merged(self):
        text = r"\LR{RDI} $\oplus$"
        assert merge_ltr_math(text) == r"\LR{RDI $\oplus$}"

    def test_no_space_between_still_merged(self):
        text = r"\LR{\textenglish{\texttt{x}}}$+1$"
        assert merge_ltr_math(text) == r"\LR{\textenglish{\texttt{x}} $+1$}"

    def test_lr_with_escaped_braces_matched(self):
        # _lr_block_end must count nested/escaped braces — \texttt body can hold
        # escaped braces so the matching close is the second-to-last brace.
        text = r"\LR{\textenglish{\texttt{a\{b\}}}} $x$"
        assert merge_ltr_math(text) == r"\LR{\textenglish{\texttt{a\{b\}}} $x$}"

    def test_lone_math_untouched(self):
        text = r"עברית $A$ עברית"
        assert merge_ltr_math(text) == text

    def test_lone_lr_untouched(self):
        text = r"עברית \LR{Word} עברית"
        assert merge_ltr_math(text) == text

    def test_display_math_not_descended_into(self):
        # $$...$$ holds its own \LR (from wrap_math_text_dir); merge must skip it
        # wholesale and never pull an adjacent inline $ into it.
        text = r"$$a \text{\LR{x}} b$$ $y$"
        assert merge_ltr_math(text) == text

    def test_lr_separated_by_hebrew_not_merged(self):
        text = r"\LR{Word} עברית $A$"
        assert merge_ltr_math(text) == text


# ---------------------------------------------------------------------------
# merge_rtl_math_number
# ---------------------------------------------------------------------------


class TestMergeRtlMathNumber:
    def test_number_after_hebrew_text_merged(self):
        # Regression: the 1 stays in LTR math flow and renders right of תיוג.
        text = r"$0.98 \to \text{\RL{תיוג}}\  1$"
        assert (
            merge_rtl_math_number(text) == r"$0.98 \to \text{\RL{תיוג \ensuremath{1}}}$"
        )

    def test_number_before_hebrew_text_merged(self):
        # Mirror regression: 240 renders left of תאים.
        text = r"$$x = 240 \ \text{\RL{תאים}}$$"
        assert (
            merge_rtl_math_number(text) == r"$$x = \text{\RL{\ensuremath{240} תאים}}$$"
        )

    def test_absorbed_number_keeps_math_typesetting(self):
        # It was math before the move, so it must still be math after it.
        assert r"\ensuremath{240}" in merge_rtl_math_number(r"240 \ \text{\RL{תאים}}")

    def test_number_already_inside_body_stays_text(self):
        # This 2 was never math — wrapping it would change its font.
        text = r"$$A = \text{\RL{שלב 2 ואילך}}$$"
        assert merge_rtl_math_number(text) == text

    def test_operator_stays_outside_the_run(self):
        assert r"= \text" in merge_rtl_math_number(r"= 240 \ \text{\RL{תאים}}")

    def test_latin_body_with_adjacent_number_untouched(self):
        for text in (r"= 240 \ \text{\LR{(cells)}}", r"2 \ \text{\LR{mod}}\  n"):
            assert merge_rtl_math_number(text) == text

    def test_intervening_operator_disqualifies(self):
        text = r"240 + \text{\RL{תאים}}"
        assert merge_rtl_math_number(text) == text

    def test_decimal_number_merged(self):
        text = r"3.5 \ \text{\RL{שעות}}"
        assert merge_rtl_math_number(text) == r"\text{\RL{\ensuremath{3.5} שעות}}"

    def test_zero_gap_number_before_text_gets_a_space(self):
        # Regression: with no source gap the merged run rendered "240תאים".
        text = r"240\text{\RL{תאים}}"
        assert merge_rtl_math_number(text) == r"\text{\RL{\ensuremath{240} תאים}}"

    def test_zero_gap_number_after_text_gets_a_space(self):
        text = r"\text{\RL{תאים}}240"
        assert merge_rtl_math_number(text) == r"\text{\RL{תאים \ensuremath{240}}}"

    def test_hebrew_text_without_adjacent_number_untouched(self):
        text = r"$$A = \text{\RL{שלב ואילך}}$$"
        assert merge_rtl_math_number(text) == text

    def test_exponent_digit_not_absorbed(self):
        # The 2 belongs to x^2, not to the Hebrew word.
        text = r"x^2 \ \text{\RL{תאים}}"
        assert merge_rtl_math_number(text) == text

    def test_only_one_number_absorbed(self):
        text = r"3 \ \text{\RL{תאים}}\  5"
        assert merge_rtl_math_number(text) == r"\text{\RL{\ensuremath{3} תאים}}\  5"
