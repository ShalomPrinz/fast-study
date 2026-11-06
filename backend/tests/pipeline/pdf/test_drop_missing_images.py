"""drop_missing_images.lua through real pandoc: an image survives only if its file is in the build dir."""

import shutil
import subprocess
from pathlib import Path

import pytest
import to_pdf
from tools import tool_path

pytestmark = pytest.mark.skipif(
    shutil.which(tool_path("pandoc")) is None, reason="pandoc not installed"
)


def render(tmp_path: Path, markdown: str, staged=("figures/fig1.pdf",)) -> str:
    for name in staged:
        (tmp_path / name).parent.mkdir(exist_ok=True)
        (tmp_path / name).write_bytes(b"%PDF")
    result = subprocess.run(
        [
            tool_path("pandoc"),
            "--from=markdown-smart",
            "--to=latex-smart",
            f"--lua-filter={to_pdf.IMAGE_FILTER}",
        ],
        input=markdown,
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


def test_a_staged_figure_stays_with_its_caption(tmp_path):
    out = render(tmp_path, "![the cap](figures/fig1.pdf)\n")
    assert "figures/fig1.pdf" in out
    assert "the cap" in out


def test_an_unstaged_lone_image_leaves_no_figure(tmp_path):
    out = render(tmp_path, "before\n\n![cap](figures/gone.pdf)\n\nafter\n")
    assert "includegraphics" not in out
    assert "figure" not in out
    assert "cap" not in out
    assert "before" in out and "after" in out


def test_an_inline_unstaged_image_goes_and_the_text_stays(tmp_path):
    out = render(tmp_path, "a ![x](figures/gone.pdf) b and ![y](https://e.com/y.png)\n")
    assert "includegraphics" not in out
    assert "a" in out and "b and" in out


def test_nested_brackets_do_not_swallow_the_rest_of_the_line(tmp_path):
    md = "![a [b [c]] d](figures/fig1.pdf) see [ref](https://x.org)\n"
    out = render(tmp_path, md)
    assert "figures/fig1.pdf" in out
    assert "https://x.org" in out


def test_a_nested_bracket_unstaged_image_is_dropped_beside_a_staged_one(tmp_path):
    out = render(tmp_path, "![ok](figures/fig1.pdf) ![a [b [c]]](m.pdf)\n")
    assert "figures/fig1.pdf" in out
    assert "m.pdf" not in out


def test_a_nested_bracket_unstaged_line_goes(tmp_path):
    out = render(tmp_path, "x\n\n![x [a [b] c] y](m.pdf#page=2)\n\ny\n")
    assert "m.pdf" not in out
    assert "includegraphics" not in out


def test_an_image_in_a_code_block_is_untouched(tmp_path):
    out = render(tmp_path, "```\n![x](figures/gone.pdf)\n```\n")
    assert "![x](figures/gone.pdf)" in out


def test_a_path_leaving_the_build_dir_or_a_directory_is_dropped(tmp_path):
    (tmp_path / "figures").mkdir()
    out = render(tmp_path, "![a](../x.pdf) ![b](/etc/passwd) ![c](figures)\n", ())
    assert "includegraphics" not in out
