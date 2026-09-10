from .paths import check_safe_segment, lecture_dir


def file_path(course: str, lecture: str, file: str, kind: str):
    """Resolve the on-disk path for a single file inside a lecture or recitation directory."""

    # course/lecture are laundered by safe_name(), the file name is not — and its path reaches
    # shell.openPath, where a backslash or drive letter survives URL normalisation and escapes.
    check_safe_segment(file)
    return lecture_dir(course, lecture, kind) / file
