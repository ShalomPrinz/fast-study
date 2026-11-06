from pathlib import Path

from services.errors import CodedError
from services.llm_client import LLMClient
from services.resources import resource_path
from timing import timed_pipeline

from pipeline.material_types import gemini_mime
from pipeline.summary_figures import (
    FigureSources,
    figures_prompt,
    picture_label,
    resolve_figures,
)

PROMPT_FILE = resource_path("assets", "instructions", "summarize.md")
MATERIALS_PROMPT_FILE = resource_path(
    "assets", "instructions", "summarize_materials.md"
)

# Appended to every request — keeps the page budget tunable without editing the prompt file.
LENGTH_BUDGET_SUFFIX = (
    "\n\nLENGTH BUDGET: aim for 2-4 PDF pages."
    "Never exceed 5 pages, and only approach 5 for unusually dense lectures."
    "If a draft is running long, tighten phrasing and drop filler before adding more content."
)

# Appended to the base prompt when one or more supplementary files are attached.
PDF_INSTRUCTION_SUFFIX = (
    "\n\nOne or more supplementary files, which may be PDFs, images, or text extracted from slides and documents, "
    "have been attached alongside the transcript. "
    "Cross-reference their contents with the transcript and incorporate relevant insights into the final summary."
)

TRANSCRIPT_MARKER = "--- MAIN TRANSCRIPT DOCUMENT ---"
SUPPLEMENTARY_MARKER = "--- SUPPLEMENTARY DOCUMENTS ---"
LECTURE_MATERIALS_MARKER = "--- LECTURE MATERIAL DOCUMENTS ---"
ASSIGNMENT_FILES_MARKER = "--- ASSIGNMENT DOCUMENTS ---"
COURSE_SUMMARIES_MARKER = "--- COURSE LECTURE SUMMARIES ---"
INSTRUCTIONS_MARKER = "--- INSTRUCTIONS ---"


def _generate(
    prompt: str,
    groups: list[tuple[str, list[tuple]]],
    *,
    code: str = "summarization_failed",
    inline: list[tuple[str, list[str]]] | None = None,
) -> str:
    """Upload each (marker, [(path, mime[, label])]) group under its marker, a label going before its
    file as a text part, add any inline text groups, then the prompt last; uploads are always
    deleted. `code` names an unexpected failure."""

    client = LLMClient()
    uploaded = []
    try:
        contents: list = []
        for marker, files in groups:
            contents.append(marker)
            for path, mime_type, *label in files:
                contents += label
                handle = client.upload_file(path, mime_type)
                uploaded.append(handle)
                contents.append(handle)
        for marker, texts in inline or []:
            contents.append(marker)
            contents += texts
        contents += [INSTRUCTIONS_MARKER, prompt]
        return client.generate(contents)
    except CodedError:
        raise  # a quota hit or a missing key already names itself
    except Exception as e:
        raise CodedError(str(e), code, detail=str(e)) from e
    finally:
        for handle in uploaded:
            client.delete_file(handle.name)


def _figure_parts(parts: list[tuple[Path, str]], figures: FigureSources) -> list[tuple]:
    """The material parts with each file's name as a label, then every PPTX picture as its own
    labelled image part — what Gemini needs to name a source in a link."""

    labelled: list[tuple] = []
    for path, mime in parts:
        label = figures.labels.get(path.name)
        labelled.append((path, mime, label) if label else (path, mime))
    pictures = [
        (pic.path, pic.mime, picture_label(pic)) for pic in figures.pictures.values()
    ]
    return labelled + pictures


def _finish(summary: str, figures: FigureSources | None) -> str:
    """The summary with its figure links resolved; `figures.files` then holds what to store."""

    return (
        resolve_figures(summary, figures)
        if figures is not None and summary
        else summary
    )


@timed_pipeline("summarize")
def summarize(
    transcript_path: Path,
    material_paths: list[Path] | None = None,
    figures: FigureSources | None = None,
) -> str:
    """Summarize a transcript (plus any number of material files) with Gemini. With `figures`, its
    slides' graphs are linked, boxed and cropped into `figures.files` inside this timed call."""

    prompt = PROMPT_FILE.read_text(encoding="utf-8")
    groups = [(TRANSCRIPT_MARKER, [(transcript_path, "text/plain")])]
    if material_paths:
        parts = [(p, gemini_mime(p.name)) for p in material_paths]
        if figures is not None and figures.has_sources():
            parts = _figure_parts(parts, figures)
            prompt += PDF_INSTRUCTION_SUFFIX + figures_prompt()
        else:
            prompt += PDF_INSTRUCTION_SUFFIX
        groups.append((SUPPLEMENTARY_MARKER, parts))
    return _finish(_generate(prompt + LENGTH_BUDGET_SUFFIX, groups), figures)


@timed_pipeline("summarize_materials")
def summarize_materials(
    material_paths: list[Path], figures: FigureSources | None = None
) -> str:
    """Summarize a lecture from its material files alone, for one that has no recording."""

    prompt = MATERIALS_PROMPT_FILE.read_text(encoding="utf-8")
    parts = [(p, gemini_mime(p.name)) for p in material_paths]
    if figures is not None and figures.has_sources():
        parts = _figure_parts(parts, figures)
        prompt += figures_prompt()
    summary = _generate(
        prompt + LENGTH_BUDGET_SUFFIX, [(LECTURE_MATERIALS_MARKER, parts)]
    )
    return _finish(summary, figures)


def generate_assignment_doc(
    doc: str,
    file_paths: list[tuple[Path, str]],
    summaries: list[tuple[str, str, str]],
) -> str:
    """Write an assignment's `doc` (intuition or solution) from its files, as (path, mime), and the
    chosen lectures' summaries, as (kind, name, text), each sent as one inline text part."""

    prompt = resource_path("assets", "instructions", f"assignment_{doc}.md").read_text(
        encoding="utf-8"
    )
    parts = [
        f'<lecture kind="{kind}" title="{name}">{text}</lecture>'
        for kind, name, text in summaries
    ]
    groups = [(ASSIGNMENT_FILES_MARKER, file_paths)] if file_paths else []
    inline = [(COURSE_SUMMARIES_MARKER, parts)] if parts else []
    size = sum(p.stat().st_size for p, _ in file_paths) + sum(
        len(text.encode("utf-8")) for _, _, text in summaries
    )
    # Sized by the inputs' bytes, not a path, so the decorator wraps the call here.
    timed = timed_pipeline(f"assignment_{doc}")(_generate_sized)
    return timed(size, prompt, groups, inline)


def _generate_sized(
    _size: int,
    prompt: str,
    groups: list[tuple[str, list[tuple[Path, str]]]],
    inline: list[tuple[str, list[str]]],
) -> str:
    return _generate(prompt, groups, code="assignment_generation_failed", inline=inline)
