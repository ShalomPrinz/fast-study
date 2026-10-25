"""Which lecture-material file types reach Gemini, as what, and which are selected for a summary."""

MAX_GEMINI_FILE_BYTES = 10 * 1024 * 1024

# Extension → mime sent to Gemini; the docx/pptx/xlsx text is extracted first, then sent as text/plain.
_MIME = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "heic": "image/heic",
    "heif": "image/heif",
    "txt": "text/plain",
    "md": "text/plain",
    "csv": "text/plain",
    "docx": "text/plain",
    "pptx": "text/plain",
    "xlsx": "text/plain",
}
_EXTRACTED = {"docx", "pptx", "xlsx"}


def _ext(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def supported_extensions() -> list[str]:
    return list(_MIME)


def gemini_mime(name: str) -> str | None:
    """The mime type Gemini receives this file as, or None for an unsupported type."""

    return _MIME.get(_ext(name))


def needs_extraction(name: str) -> bool:
    """True for an Office file whose text is extracted rather than sent as is."""

    return _ext(name) in _EXTRACTED


def attached_materials(entries: list[dict]) -> list[dict]:
    """The listing entries a summary uses: a supported type the user has not switched off."""

    return [e for e in entries if gemini_mime(e["name"]) and e.get("attach", True)]
