import io
import shutil
import subprocess
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pypdfium2 as pdfium
import pytest
import summarize as summarize_mod
import summary_figures as sf
from PIL import Image
from summary_figures import FigureSources
from tools import tool_path

FIXTURES = Path(__file__).parent.parent / "fixtures"
DECK_PDF = FIXTURES / "econ-slides.pdf"
DECK_PPTX = FIXTURES / "econ-slides.pptx"

# Normalized [ymin, xmin, ymax, xmax] on the fixture's pages: the graph with its labels, leaving the
# slide title above and the bullets and footer beside and below.
TIGHT = {1: [200, 60, 840, 520], 2: [200, 60, 840, 520]}


def _page(page_no: int):
    return sf._render_page(DECK_PDF, page_no)


def _text_in_crop(pdf_bytes: bytes) -> str:
    doc = pdfium.PdfDocument(pdf_bytes)
    page = doc[0]
    text = page.get_textpage().get_text_bounded(*page.get_cropbox())
    doc.close()
    return text


def _crop(page_no: int, box) -> bytes:
    img = _page(page_no)
    px = sf.box_to_pixels(box, *img.size)
    snapped = sf.snap_box(img.convert("L"), px)
    return sf._crop_pdf_page(DECK_PDF, page_no - 1, snapped, img.size)


# ---- links ----


class TestLinks:
    def test_only_standalone_image_lines_are_links(self):
        md = (
            "text ![inline](material.pdf#page=1) more\n"
            "\n"
            "![תרשים](material.pdf#page=3)\n"
            "  ![indented](material.2.pptx#image1.png)  \n"
        )
        links = sf.find_links(md)
        assert [
            (link.caption, link.material, link.page, link.picture) for link in links
        ] == [
            ("תרשים", "material.pdf", 3, None),
            ("indented", "material.2.pptx", None, "material.2.pptx#image1.png"),
        ]

    @pytest.mark.parametrize(
        "target, parsed",
        [
            ("material.pdf#page=12", ("material.pdf", 12, None)),
            ("<material.pdf#page=2>", ("material.pdf", 2, None)),
            ("m.pptx#image3.png", ("m.pptx", None, "m.pptx#image3.png")),
            ("material.pdf", None),
            ("#page=2", None),
            ("material.pdf#", None),
            ("https://example.com/a.png", None),
        ],
    )
    def test_parse_target(self, target, parsed):
        assert sf.parse_target(target) == parsed

    def test_a_caption_may_hold_balanced_brackets(self):
        (link,) = sf.find_links("![a [b] c](m.pdf#page=3)\n")
        assert (link.caption, link.material, link.page) == ("a [b] c", "m.pdf", 3)

    def test_an_unparseable_target_is_still_found_so_it_can_be_dropped(self):
        (link,) = sf.find_links("![x](https://example.com/a.png)\n")
        assert link.material is None


# ---- box -> pixels ----


class TestBoxToPixels:
    def test_maps_ymin_xmin_ymax_xmax_to_pixels(self):
        assert sf.box_to_pixels([100, 200, 600, 800], 1000, 500) == (200, 50, 800, 300)

    def test_a_box_past_the_page_is_clamped(self):
        assert sf.box_to_pixels([-50, -10, 1200, 1000], 100, 100) == (0, 0, 100, 100)

    @pytest.mark.parametrize(
        "box",
        [
            None,
            [1, 2, 3],
            ["a", 1, 2, 3],
            [500, 100, 500, 900],  # no height
            [600, 100, 500, 900],  # inverted
            [100, 100, 900, 105],  # under 1% wide
            [1100, 0, 1200, 1000],  # entirely off the page
            [0, 0, 0, 0],
        ],
    )
    def test_invalid_or_degenerate_boxes_are_refused(self, box):
        assert sf.box_to_pixels(box, 1000, 1000) is None


# ---- snap and crop, pinned on the fixture's renders ----


class TestSnap:
    @pytest.mark.parametrize("page_no", [1, 2, 3])
    def test_a_tight_box_keeps_the_whole_graph_and_no_slide_text(self, page_no):
        text = _text_in_crop(_crop(page_no, TIGHT[1]))
        assert "Good X" in text or "Apples" in text or "Utility of consumer A" in text
        assert "Microeconomics" not in text  # the footer
        assert "consumers" not in text and "Higher curves" not in text  # the bullets
        assert (
            "Edgeworth box" not in text and "Utility possibility" not in text
        )  # the title

    def test_a_short_box_grows_to_the_axis_labels_and_right_edge(self):
        # Ends 4% above the x-axis labels and 6% short of the legend's right edge.
        text = _text_in_crop(_crop(1, [200, 60, 800, 470]))
        assert "Good X" in text and "Good Y" in text and "contract curve" in text
        assert "10" in text  # the last x tick label

    def test_a_loose_box_is_trimmed_to_the_ink(self):
        img = _page(2)
        tight = sf.snap_box(img.convert("L"), sf.box_to_pixels(TIGHT[2], *img.size))
        loose = sf.snap_box(
            img.convert("L"), sf.box_to_pixels([150, 20, 900, 530], *img.size)
        )
        # The title and bullets are over 12 white lines away, so growth never reaches them.
        assert all(
            abs(a - b) <= sf.MARGIN_PX * 2 for a, b in zip(tight, loose, strict=True)
        )

    def test_the_margin_is_white_and_inside_the_page(self):
        img = _page(1).convert("L")
        x0, y0, x1, y1 = sf.snap_box(img, sf.box_to_pixels(TIGHT[1], *img.size))
        assert 0 <= x0 < x1 <= img.width and 0 <= y0 < y1 <= img.height
        assert img.crop((x0, y0, x1, y0 + 1)).getextrema()[0] >= sf.INK_BELOW

    def test_growth_is_capped_at_six_percent_of_the_page(self):
        img = Image.new("L", (1000, 1000), 255)
        img.paste(0, (100, 100, 900, 900))  # ink all the way down: one solid block
        assert sf.snap_box(img, (100, 100, 900, 200)) == (89, 89, 911, 271)

    def test_a_box_over_a_blank_region_is_refused(self):
        assert (
            sf.snap_box(Image.new("L", (500, 500), 255), (100, 100, 300, 300)) is None
        )

    def test_the_crop_stays_a_vector_one_page_pdf_with_both_boxes_set(self):
        doc = pdfium.PdfDocument(_crop(1, TIGHT[1]))
        page = doc[0]
        assert len(doc) == 1
        assert page.get_mediabox() == page.get_cropbox()
        w, h = page.get_size()
        assert 0 < w < 960 and 0 < h < 540
        assert (
            page.get_textpage().count_chars() > 0
        )  # text survived, so it was not rasterized
        doc.close()


# ---- the step ----


def _sources(tmp_path, with_pptx=True) -> FigureSources:
    src = FigureSources()
    src.pdfs["material.pdf"] = DECK_PDF
    if with_pptx:
        for pic in sf.extract_pptx_pictures(DECK_PPTX, "material.2.pptx", tmp_path):
            src.pictures[pic.ref] = pic
    return src


def _boxes(**by_id):
    """A request_boxes stand-in answering each figure id from `by_id` (`i1=…`), None otherwise."""

    def fake(wanted):
        return {i: by_id.get(f"i{i}") for i, _, _ in wanted}

    return fake


GOOD = "![גרף טוב](material.pdf#page=1)"


class TestResolve:
    def test_a_good_link_becomes_a_numbered_vector_figure(self, tmp_path):
        src = _sources(tmp_path)
        with patch.object(sf, "request_boxes", _boxes(i1=TIGHT[1], i2=TIGHT[2])):
            out = sf.resolve_figures(
                f"# t\n\npara\n\n{GOOD}\n\nnext\n\n![עקומות](material.pdf#page=2)\n",
                src,
            )
        assert "![גרף טוב](figures/fig1.pdf)" in out
        assert "![עקומות](figures/fig2.pdf)" in out
        assert sorted(src.files) == ["fig1.pdf", "fig2.pdf"]
        assert src.files["fig1.pdf"].startswith(b"%PDF")

    def test_an_unreadable_pdf_drops_only_its_figures(self, tmp_path):
        bad = tmp_path / "bad.pdf"
        bad.write_bytes(b"not a pdf")
        src = _sources(tmp_path)
        src.pdfs["bad.pdf"] = bad
        with patch.object(sf, "request_boxes", _boxes(i2=TIGHT[1])):
            out = sf.resolve_figures(
                "![x](bad.pdf#page=1)\n\n![ok](material.pdf#page=1)\n", src
            )
        assert "bad.pdf" not in out and "![ok](figures/fig1.pdf)" in out
        assert sorted(src.files) == ["fig1.pdf"]

    def test_a_pptx_picture_is_copied_as_is_with_no_box_call(self, tmp_path):
        src = _sources(tmp_path)
        original = src.pictures["material.2.pptx#image1.png"].original
        with patch.object(
            sf, "request_boxes", side_effect=AssertionError("no box call")
        ):
            out = sf.resolve_figures("![תמונה](material.2.pptx#image1.png)\n", src)
        assert out == "![תמונה](figures/fig1.png)\n"
        assert src.files == {"fig1.png": original}

    def test_the_box_call_gets_one_page_image_and_caption_per_pdf_figure(
        self, tmp_path
    ):
        src = _sources(tmp_path)
        seen = []

        def fake(wanted):
            seen.extend(wanted)
            return {}

        with patch.object(sf, "request_boxes", fake):
            sf.resolve_figures(f"{GOLDEN_LINES}\n", src)
        assert [(i, c) for i, c, _ in seen] == [(1, "גרף טוב"), (2, "עקומות")]
        assert all(png.startswith(b"\x89PNG") for _, _, png in seen)

    @pytest.mark.parametrize(
        "bad",
        [
            "![x](other.pdf#page=1)",  # unknown material
            "![x](material.pdf#page=99)",  # page out of range
            "![x](material.pdf#page=0)",
            "![x](material.2.pptx#nope.png)",  # unknown picture
            "![x](https://example.com/a.png)",
            "![x](material.pdf#page=3)",  # box reply says not found
            "![x](material.pdf#page=4)",  # invalid box
        ],
    )
    def test_a_bad_link_drops_only_its_own_line(self, tmp_path, bad):
        src = _sources(tmp_path)
        replies = _boxes(i1=TIGHT[1], i2=None, i3=[10, 10, 10, 10])
        md = f"a\n\n{GOOD}\n\n{bad}\n\nb\n"
        with patch.object(sf, "request_boxes", replies):
            out = sf.resolve_figures(md, src)
        assert "![x]" not in out
        assert "![גרף טוב](figures/fig1.pdf)" in out
        assert out.startswith("a\n\n") and out.rstrip().endswith("b")
        assert list(src.files) == ["fig1.pdf"]

    def test_a_failed_box_call_drops_every_pdf_figure_but_keeps_pictures(
        self, tmp_path
    ):
        src = _sources(tmp_path)
        md = f"{GOLDEN_LINES}\n![תמונה](material.2.pptx#image3.png)\n"
        with patch.object(sf, "request_boxes", side_effect=RuntimeError("503")):
            out = sf.resolve_figures(md, src)
        assert out.strip() == "![תמונה](figures/fig1.png)"
        assert list(src.files) == ["fig1.png"]

    def test_a_malformed_box_reply_drops_the_pdf_figures(self, tmp_path):
        src = _sources(tmp_path)
        with patch.object(sf, "request_boxes", side_effect=KeyError("figures")):
            assert sf.resolve_figures(f"{GOOD}\n", src) == ""
        assert src.files == {}

    def test_no_more_than_eight_figures_survive(self, tmp_path):
        src = _sources(tmp_path)
        md = (
            "\n\n".join(f"![p{i}](material.2.pptx#image1.png)" for i in range(10))
            + "\n"
        )
        out = sf.resolve_figures(md, src)
        assert len(src.files) == 8
        assert out.count("![p") == 8 and "![p8]" not in out and "![p9]" not in out

    def test_a_summary_with_no_links_comes_back_unchanged(self, tmp_path):
        src = _sources(tmp_path)
        assert sf.resolve_figures("# t\n\ntext\n", src) == "# t\n\ntext\n"
        assert src.files == {}

    def test_a_rotated_page_is_dropped(self, tmp_path):
        rotated = tmp_path / "r.pdf"
        doc = pdfium.PdfDocument(str(DECK_PDF))
        doc[0].set_rotation(90)
        doc.save(str(rotated))
        doc.close()
        src = FigureSources(pdfs={"material.pdf": rotated})
        with patch.object(sf, "request_boxes", _boxes(i1=TIGHT[1])):
            assert sf.resolve_figures(f"{GOOD}\n", src) == ""


GOLDEN_LINES = f"{GOOD}\n\n![עקומות](material.pdf#page=2)"


# ---- PPTX pictures ----


def _noise_png(w, h) -> bytes:
    img = Image.frombytes("RGB", (w, h), __import__("os").urandom(w * h * 3))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _flat_png(w, h) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(buf, "PNG")
    return buf.getvalue()


def _deck(
    path: Path, media: dict[str, bytes], slides: dict[int, list[str]], layout=()
) -> Path:
    rel = (
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        "{}</Relationships>"
    )
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in media.items():
            zf.writestr(f"ppt/media/{name}", data)
        for n, names in slides.items():
            zf.writestr(
                f"ppt/slides/_rels/slide{n}.xml.rels",
                rel.format(
                    "".join(
                        f'<Relationship Id="r{i}" Type="http://schemas.openxmlformats.org/'
                        f'officeDocument/2006/relationships/image" Target="../media/{m}"/>'
                        for i, m in enumerate(names)
                    )
                ),
            )
        zf.writestr(
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            rel.format(
                "".join(
                    f'<Relationship Id="r{i}" Type="http://schemas.openxmlformats.org/'
                    f'officeDocument/2006/relationships/image" Target="../media/{m}"/>'
                    for i, m in enumerate(layout)
                )
            ),
        )
    return path


class TestPptxPictures:
    def test_the_fixture_deck_yields_its_graphs_and_not_the_logo(self, tmp_path):
        pics = sf.extract_pptx_pictures(DECK_PPTX, "material.2.pptx", tmp_path)
        assert [(p.ref, p.slide) for p in pics] == [
            ("material.2.pptx#image1.png", 1),
            ("material.2.pptx#image3.png", 2),
            ("material.2.pptx#image4.png", 3),
        ]
        assert all(p.path.exists() and p.mime == "image/png" for p in pics)

    def test_filters(self, tmp_path):
        deck = _deck(
            tmp_path / "d.pptx",
            {
                "ok.png": _noise_png(210, 210),
                "ok2.jpeg": _noise_png(210, 210),
                "narrow.png": _noise_png(150, 400),
                "flat.png": _flat_png(400, 400),  # over 200px but under 10 KB
                "vector.emf": b"x" * 20000,
                "vector.wmf": b"x" * 20000,
                "only_layout.png": _noise_png(210, 210),
                "broken.png": b"x" * 20000,
                "huge.png": _noise_png(400, 400),
            },
            {
                1: ["ok.png", "narrow.png", "flat.png", "vector.emf", "broken.png"],
                3: ["ok2.jpeg", "ok.png", "huge.png", "vector.wmf"],
            },
            layout=["only_layout.png"],
        )
        with patch.object(sf, "MAX_GEMINI_FILE_BYTES", 250_000):
            # huge.png is ~480 KB of noise, over the patched per-file cap
            pics = sf.extract_pptx_pictures(deck, "m.pptx", tmp_path)
        assert [(p.ref, p.slide) for p in pics] == [
            ("m.pptx#ok.png", 1),
            ("m.pptx#ok2.jpeg", 3),
        ]

    def test_a_gif_is_sent_and_stored_as_png(self, tmp_path):
        buf = io.BytesIO()
        Image.frombytes("RGB", (300, 300), __import__("os").urandom(270000)).convert(
            "P"
        ).save(buf, "GIF")
        deck = _deck(tmp_path / "d.pptx", {"a.gif": buf.getvalue()}, {2: ["a.gif"]})
        (pic,) = sf.extract_pptx_pictures(deck, "m.pptx", tmp_path)
        assert pic.mime == "image/png" and pic.path.read_bytes().startswith(b"\x89PNG")
        assert pic.original == buf.getvalue()
        src = FigureSources(pictures={pic.ref: pic})
        out = sf.resolve_figures("![g](m.pptx#a.gif)\n", src)
        assert (
            out == "![g](figures/fig1.png)\n"
            and src.files["fig1.png"] == pic.path.read_bytes()
            and "fig1.gif" not in src.files
        )

    def test_a_corrupt_deck_yields_nothing(self, tmp_path):
        bad = tmp_path / "bad.pptx"
        bad.write_bytes(b"not a zip")
        assert sf.extract_pptx_pictures(bad, "m.pptx", tmp_path) == []

    def test_add_materials_labels_files_and_collects_sources(self, tmp_path):
        shutil.copy(DECK_PPTX, tmp_path / "material.2.pptx")
        (tmp_path / "material.2.pptx.txt").write_text("Slide 1")
        shutil.copy(DECK_PDF, tmp_path / "material.pdf")
        src = FigureSources()
        src.add_materials(
            [
                ("material.pdf", tmp_path / "material.pdf"),
                ("material.2.pptx", tmp_path / "material.2.pptx.txt"),
            ],
            {"material.pdf": "Week 3.pdf", "material.2.pptx": "material.2.pptx"},
            tmp_path,
        )
        assert src.labels == {
            "material.pdf": "FILE material.pdf (original file name: Week 3.pdf)",
            "material.2.pptx.txt": "FILE material.2.pptx",
        }
        assert list(src.pdfs) == ["material.pdf"] and len(src.pictures) == 3


# ---- the summarize call ----


def _client(text):
    client = MagicMock()
    client.upload_file.side_effect = lambda path, mime: MagicMock(
        _path=path, _mime=mime, name=f"files/{Path(path).name}"
    )
    client.generate.return_value = text
    return client


def _fixture_sources(tmp_path) -> FigureSources:
    pdf = tmp_path / "material.pdf"
    shutil.copy(DECK_PDF, pdf)
    pptx = tmp_path / "material.2.pptx"
    shutil.copy(DECK_PPTX, pptx)
    txt = tmp_path / "material.2.pptx.txt"
    txt.write_text("Slide 1\nx")
    src = FigureSources()
    src.add_materials(
        [("material.pdf", pdf), ("material.2.pptx", txt)],
        {"material.pdf": "Week 3.pdf", "material.2.pptx": "Slides.pptx"},
        tmp_path,
    )
    return src


class TestSummarizeCall:
    def test_labels_pictures_and_prompt_go_out_when_figures_are_on(self, tmp_path):
        transcript = tmp_path / "transcript.txt"
        transcript.write_text("hi")
        src = _fixture_sources(tmp_path)
        client = _client("# t\n\n![תמונה](material.2.pptx#image3.png)\n")
        with patch.object(summarize_mod, "LLMClient", return_value=client):
            out = summarize_mod.summarize(
                transcript,
                [src.pdfs["material.pdf"], tmp_path / "material.2.pptx.txt"],
                src,
            )
        contents = client.generate.call_args.args[0]
        labels = [
            c
            for c in contents
            if isinstance(c, str) and c.startswith(("FILE ", "PICTURE "))
        ]
        assert labels == [
            "FILE material.pdf (original file name: Week 3.pdf)",
            "FILE material.2.pptx (original file name: Slides.pptx)",
            "PICTURE material.2.pptx#image1.png (on slide 1)",
            "PICTURE material.2.pptx#image3.png (on slide 2)",
            "PICTURE material.2.pptx#image4.png (on slide 3)",
        ]
        # Each label is the part immediately before its file.
        first = contents.index(labels[0])
        assert getattr(contents[first + 1], "_mime", None) == "application/pdf"
        pic = contents.index(labels[3])
        assert getattr(contents[pic + 1], "_mime", None) == "image/png"
        assert summarize_mod.figures_prompt() in contents[-1]
        assert out.endswith("![תמונה](figures/fig1.png)\n") and list(src.files) == [
            "fig1.png"
        ]

    def test_no_figures_means_the_request_is_unchanged(self, tmp_path):
        transcript = tmp_path / "transcript.txt"
        transcript.write_text("hi")
        client = _client("# t")
        with patch.object(summarize_mod, "LLMClient", return_value=client):
            summarize_mod.summarize(transcript, [tmp_path / "transcript.txt"])
        contents = client.generate.call_args.args[0]
        assert not [c for c in contents if isinstance(c, str) and c.startswith("FILE ")]
        assert "FIGURES:" not in contents[-1]

    def test_figures_on_with_no_pdf_or_pptx_adds_no_prompt_but_still_drops_strays(
        self, tmp_path
    ):
        transcript = tmp_path / "transcript.txt"
        transcript.write_text("hi")
        src = FigureSources()
        client = _client("# t\n\n![x](material.pdf#page=1)\n\nend\n")
        with patch.object(summarize_mod, "LLMClient", return_value=client):
            out = summarize_mod.summarize(transcript, [transcript], src)
        assert "FIGURES:" not in client.generate.call_args.args[0][-1]
        assert "![x]" not in out

    def test_materials_only_path_gets_the_same_labels_and_prompt(self, tmp_path):
        src = _fixture_sources(tmp_path)
        client = _client("# t\n")
        with patch.object(summarize_mod, "LLMClient", return_value=client):
            summarize_mod.summarize_materials(
                [src.pdfs["material.pdf"], tmp_path / "material.2.pptx.txt"], src
            )
        contents = client.generate.call_args.args[0]
        assert "FILE material.pdf (original file name: Week 3.pdf)" in contents
        assert summarize_mod.figures_prompt() in contents[-1]


class TestBoxCall:
    def test_request_shape_and_reply_parsing(self):
        client = MagicMock()
        client.generate.return_value = (
            '{"figures": [{"id": 1, "found": true, "box_2d": [1, 2, 3, 4]},'
            ' {"id": 2, "found": false, "box_2d": [0, 0, 0, 0]}]}'
        )
        with patch.object(sf, "LLMClient", return_value=client):
            boxes = sf.request_boxes([(1, "a", b"\x89PNG1"), (2, "b", b"\x89PNG2")])
        assert boxes == {1: [1, 2, 3, 4], 2: None}
        contents = client.generate.call_args.args[0]
        assert [c for c in contents if isinstance(c, str)][1:] == [
            "Figure 1: a",
            "Figure 2: b",
        ]
        assert client.generate.call_args.kwargs["response_schema"] is sf.BOX_SCHEMA
        part = contents[2]
        assert (
            part.inline_data.mime_type == "image/png"
            and part.inline_data.data == b"\x89PNG1"
        )


# ---- a render with a figure ----


def _pandoc_new_enough() -> bool:
    exe = shutil.which(tool_path("pandoc"))
    if exe is None:
        return False
    out = subprocess.run([exe, "--version"], capture_output=True, text=True).stdout
    version = out.split()[1].split(".")
    return tuple(int(v) for v in version[:2]) >= (3, 13)


@pytest.mark.skipif(
    not _pandoc_new_enough() or shutil.which(tool_path("tectonic")) is None,
    reason="needs pandoc >= 3.13 (the filter's pin) and tectonic",
)
class TestRenderWithFigure:
    def test_a_figure_renders_with_its_numbered_caption_and_a_dangling_link_is_harmless(
        self, tmp_path
    ):
        import fitz  # pymupdf, a test dependency
        from to_pdf import convert_to_pdf

        (tmp_path / "figures").mkdir()
        (tmp_path / "figures" / "fig1.pdf").write_bytes(_crop(1, TIGHT[1]))
        (tmp_path / "figures" / "fig9.pdf").write_bytes(
            _crop(2, TIGHT[2])
        )  # never linked
        md = tmp_path / "summary.md"
        md.write_text(
            "# כותרת\n\nפסקה.\n\n![תיבת Edgeworth](figures/fig1.pdf)\n\nעוד.\n\n"
            "![נעלם](figures/fig2.pdf)\n",
            encoding="utf-8",
        )
        pdf, warning = convert_to_pdf(str(md))
        assert warning is None
        text = "".join(page.get_text() for page in fitz.open(pdf))
        assert "Good X" in text  # the vector figure is on the page
        assert "איור" in text and "Edgeworth" in text  # "Figure 1: <caption>"
        assert (
            "נעלם" not in text
        )  # the dangling link vanished instead of failing the render
