import pytest
from to_pdf import normalize_dashes, ensure_blank_before_lists, wrap_english_phrases


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

    def test_bold_markers_preserved(self):
        result = wrap_english_phrases("**Pull Request:**")
        assert "**" in result

    def test_multiline_text(self):
        text = "שורה ראשונה\nPull Request עם Merge\nשורה שלישית\n"
        result = wrap_english_phrases(text)
        assert r"\LR{Pull Request}" in result
        assert r"\LR{Merge}" in result
        assert "שורה ראשונה" in result
        assert "שורה שלישית" in result
