from pipeline.pdf.bidi import force_ltr_inline_code, wrap_english_phrases
from pipeline.pdf.math_fixes import normalize_math_spans
from pipeline.pdf.text import (
    apply_outside_fences,
    ensure_blank_before_lists,
    normalize_dashes,
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

    def test_em_dash_inside_inline_code_untouched(self):
        assert normalize_dashes("use `a—b` here") == "use `a—b` here"

    def test_en_dash_inside_inline_code_untouched(self):
        assert normalize_dashes("use `a–b` here") == "use `a–b` here"

    def test_em_dash_inside_inline_math_untouched(self):
        assert normalize_dashes("נוסחה $a—b$ סוף") == "נוסחה $a—b$ סוף"

    def test_dash_outside_protected_span_still_converted(self):
        result = normalize_dashes("לפני — `a—b` — אחרי")
        assert result == "לפני  -  `a—b`  -  אחרי"

    def test_em_dash_inside_display_math_untouched(self):
        assert normalize_dashes("$$\na—b\n$$") == "$$\na—b\n$$"


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

    def test_no_blank_inserted_inside_display_math(self):
        # A blank line inside $$…$$ ends the paragraph for pandoc and splits the block.
        text = "טקסט\n$$\nx = a\n- b\n$$\n"
        assert ensure_blank_before_lists(text) == text

    def test_list_after_display_math_still_separated(self):
        text = "$$\nx = a\n$$\nפסקה\n- פריט\n"
        assert "\n\n- פריט" in ensure_blank_before_lists(text)


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
                    ensure_blank_before_lists(normalize_math_spans(normalize_dashes(t)))
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
