from pipeline.pdf.tex_errors import format_tex_errors, parse_tex_errors

# ---------------------------------------------------------------------------
# XeLaTeX log classification
#
# pandoc relays hundreds of lines of font/package chatter around a handful of
# real `! …` errors. These cover the parse + the one-line message built from it.
# ---------------------------------------------------------------------------


MULTI_ERROR_LOG = r"""[Loading MPS to PDF converter (version 2006.09.02).]
(/usr/share/texlive/texmf-dist/tex/latex/polyglossia/polyglossia.sty
Package polyglossia Info: Loading Hebrew language on input line 12.
! Undefined control sequence.
l.417 \Pi
          (x) is the profit function
The control sequence at the end of the top line
of your error message was never \def'ed.

! Missing $ inserted.
<inserted text>
                $
l.502 \text{שלב}_
                 2
[3] [4] (./summary.aux)
"""


class TestParseTexErrors:
    def test_multi_error_log(self):
        errors = parse_tex_errors(MULTI_ERROR_LOG)
        assert len(errors) == 2
        assert errors[0].message == "Undefined control sequence"
        assert errors[0].line == 417
        assert errors[0].at == r"\Pi"
        assert errors[0].source == r"\Pi(x) is the profit function"
        assert errors[1].message == "Missing $ inserted"
        assert errors[1].line == 502
        # The `l.` marker sits past the <inserted text> context lines.
        assert errors[1].at == r"\text{שלב}_"

    def test_single_error(self):
        log = "! Undefined control sequence.\nl.12 \\foo\n         bar\n"
        errors = parse_tex_errors(log)
        assert len(errors) == 1
        assert (errors[0].message, errors[0].line) == ("Undefined control sequence", 12)
        assert errors[0].source == r"\foobar"

    def test_error_without_line_marker(self):
        log = "! LaTeX Error: File `bidi.sty' not found.\nType X to quit.\n"
        errors = parse_tex_errors(log)
        assert len(errors) == 1
        assert errors[0].line is None
        assert errors[0].at == "" and errors[0].source == ""
        assert errors[0].message == "LaTeX Error: File `bidi.sty' not found"

    def test_no_bang_lines_yields_nothing(self):
        log = "pandoc: unrecognized option `--nope'\nTry pandoc --help.\n"
        assert parse_tex_errors(log) == []

    def test_lone_bang_line_is_not_an_error(self):
        assert parse_tex_errors("!\n\n[1] [2]\n") == []

    def test_later_marker_is_not_adopted_by_a_markerless_error(self):
        log = "! Emergency stop.\n" + "\n" * 25 + "l.900 \\bar\n"
        assert parse_tex_errors(log)[0].line is None

    def test_source_line_without_continuation(self):
        log = "! Missing $ inserted.\nl.7 $x\n"
        assert parse_tex_errors(log)[0].source == "$x"


class TestFormatTexErrors:
    def test_first_error_plus_count(self):
        msg = format_tex_errors(parse_tex_errors(MULTI_ERROR_LOG))
        assert (
            msg == r"LaTeX error: Undefined control sequence (line 417: \Pi) and 1 more"
        )
        assert "\n" not in msg

    def test_single_error_has_no_count(self):
        msg = format_tex_errors(parse_tex_errors("! Missing $ inserted.\nl.7 $x\n"))
        assert msg == "LaTeX error: Missing $ inserted (line 7: $x)"

    def test_error_without_line_marker(self):
        msg = format_tex_errors(parse_tex_errors("! Emergency stop.\n"))
        assert msg == "LaTeX error: Emergency stop"

    def test_long_source_is_truncated_to_one_short_line(self):
        log = "! Undefined control sequence.\nl.9 \\foo " + "x" * 200 + "\n"
        msg = format_tex_errors(parse_tex_errors(log))
        assert len(msg) < 100

    def test_empty_list(self):
        assert format_tex_errors([]) == ""
