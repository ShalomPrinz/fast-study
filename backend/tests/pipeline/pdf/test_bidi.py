from pipeline.pdf.bidi import force_ltr_inline_code, wrap_english_phrases

LRM = "‎"

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

    def test_possessive_before_space_keeps_one_run(self):
        # Regression: "Bayes' Rule" split into \LR{Bayes}' \LR{Rule} — two LTR
        # islands, which RTL orders right-to-left ("Rule' Bayes" in the PDF).
        result = wrap_english_phrases("חוק בייס (Bayes' Rule)")
        assert r"\LR{(Bayes' Rule)}" in result
        assert r"\LR{Bayes}" not in result

    def test_possessive_before_space_outside_parens(self):
        result = wrap_english_phrases("על students' work כאן")
        assert r"\LR{students' work}" in result

    def test_possessive_before_hebrew_still_excluded(self):
        # No Latin token follows, so the apostrophe stays out of the run —
        # the trailing-separator rule must not regress.
        result = wrap_english_phrases("על Bayes' משהו")
        assert r"\LR{Bayes}" in result
        assert r"\LR{Bayes'}" not in result

    def test_closing_quote_between_latin_words_not_swallowed(self):
        # A quote closing a quoted word is not a possessive; only a sibilant
        # before it makes the across-a-space glue fire.
        result = wrap_english_phrases("the ’word’ here")
        assert r"\LR{word}" in result
        assert r"\LR{word’ here}" not in result

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

    # --- Spaced hyphen / comma glue Latin tokens into one run ---

    def test_spaced_hyphen_and_comma_glue_parenthetical(self):
        # Regression: "(FIFO - First-In, First-Out)" split into three \LR runs;
        # the neutral parens/dash/comma reordered to "(First-Out, First-In - FIFO)".
        result = wrap_english_phrases("עקרון (FIFO - First-In, First-Out) כאן")
        assert r"\LR{(FIFO - First-In, First-Out)}" in result

    def test_comma_space_glues_bare_latin_tokens(self):
        result = wrap_english_phrases("המונח First-In, First-Out שם")
        assert r"\LR{First-In, First-Out}" in result

    def test_spaced_hyphen_before_hebrew_not_glued(self):
        # A spaced hyphen leading into Hebrew must NOT pull the dash into the run.
        result = wrap_english_phrases("ראה Foo - עברית")
        assert r"\LR{Foo}" in result
        assert r"\LR{Foo -" not in result

    def test_comma_before_hebrew_stays_rl(self):
        # A comma followed by Hebrew (not another Latin token) stays RTL.
        result = wrap_english_phrases("ראה Foo, עברית")
        assert r"\LR{Foo}" in result
        assert r"\RL{,}" in result

    # --- Number glued directly to a Latin unit (4KB) ---

    def test_number_glued_to_unit_wrapped(self):
        # Regression: "4KB" -> 4\LR{KB} left the neutral 4 to reorder -> "KB4".
        result = wrap_english_phrases("בין 4KB ל-64KB כאן")
        assert r"\LR{4KB}" in result
        assert r"\LR{64KB}" in result

    def test_spaced_number_before_hebrew_not_glued(self):
        # A number with a SPACE before the word stays RTL (not glued to a unit).
        result = wrap_english_phrases("עולה 4 שקלים")
        assert r"\LR" not in result

    def test_digit_hyphen_prefix_still_glued_after_change(self):
        # The optional-hyphen numeric prefix must still handle "3-way".
        result = wrap_english_phrases("מיזוג 3-way merge")
        assert r"\LR{3-way merge}" in result


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

    def test_number_list_comma_gets_lrm(self):
        # Regression: digits are bidi European Numbers; a comma between them is a
        # neutral that \LR doesn't anchor, so "98, 183" reordered to ",98 ,183".
        result = force_ltr_inline_code("בטראק `98, 183, 37`")
        assert "98," + LRM + " 183," + LRM + " 37" in result

    def test_comma_directly_before_digit_gets_lrm(self):
        # No space between comma and digit still triggers the anchor.
        result = force_ltr_inline_code("`1,2,3`")
        assert "1," + LRM + "2," + LRM + "3" in result

    def test_letter_list_comma_no_lrm(self):
        # Letters are strong L and render fine — comma not before a digit, no LRM.
        result = force_ltr_inline_code("`foo, bar`")
        assert LRM not in result
        assert r"\LR{\texttt{foo, bar}}" in result

    def test_trailing_comma_before_nondigit_no_lrm(self):
        result = force_ltr_inline_code("`a,`")
        assert LRM not in result


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
