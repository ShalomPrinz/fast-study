from .paths import lecture_dir


def file_path(course: str, lecture: str, file: str, kind: str):
    return lecture_dir(course, lecture, kind) / file
