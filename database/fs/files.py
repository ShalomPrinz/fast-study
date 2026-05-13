from .paths import lecture_dir


def file_path(course: str, lecture: str, file: str, kind: str):
    """Resolve the on-disk path for a single file inside a lecture or recitation directory."""

    return lecture_dir(course, lecture, kind) / file
