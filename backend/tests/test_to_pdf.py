import pytest
from to_pdf import (
    normalize_dashes,
    ensure_blank_before_lists,
    wrap_english_phrases,
    normalize_math_spans,
    force_ltr_inline_code,
    apply_outside_fences,
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

    def test_math_and_english_outside_wrapped(self):
        result = wrap_english_phrases("ראה $x \\times y$ ואז Pull Request")
        assert "$x \\times y$" in result
        assert r"\LR{Pull Request}" in result
        assert r"\LR{times}" not in result


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

