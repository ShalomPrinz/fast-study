from .paths import data_root, lecture_dir, RECITATIONS_DIR, PREDEFINED_FILES


def create_course(name: str) -> None:
    (data_root() / name).mkdir(parents=True, exist_ok=True)


def rename_course(old: str, new: str) -> None:
    (data_root() / old).rename(data_root() / new)


def create_lecture(course: str, name: str, kind: str) -> None:
    if kind == "recitation":
        parent = data_root() / course / RECITATIONS_DIR
        parent.mkdir(parents=True, exist_ok=True)
        (parent / name).mkdir(parents=True, exist_ok=True)
    else:
        (data_root() / course / name).mkdir(parents=True, exist_ok=True)


def rename_lecture(course: str, old: str, new: str, kind: str) -> None:
    lecture_dir(course, old, kind).rename(lecture_dir(course, new, kind))


def write_video(course: str, lecture: str, kind: str, data: bytes) -> None:
    d = lecture_dir(course, lecture, kind)
    # Wipe everything from the previous video before writing the new one
    for f in (*PREDEFINED_FILES, "transcript.partial.meta.json"):
        p = d / f
        if p.exists():
            p.unlink()
    (d / "video.mp4").write_bytes(data)


def delete_file(course: str, lecture: str, file: str, kind: str) -> None:
    p = lecture_dir(course, lecture, kind) / file
    if p.exists():
        p.unlink()
