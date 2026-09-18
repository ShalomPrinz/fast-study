"""Prime tectonic's LaTeX package cache for the packaged build: render kitchen-sink.md, add
cache-supplement.txt by name, keep only `bundles/` under <out-dir> — see docs/LATEX.md."""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

_DELIVERY = Path(__file__).resolve().parent
_REPO = _DELIVERY.parent

# backend/ is a plain source tree rather than an installed package, so it goes on sys.path the same
# way services.spec puts it on `pathex`.
sys.path.insert(0, str(_REPO / "backend"))

from pipeline.to_pdf import BUILD_STEM, build_tex  # noqa: E402
from tools import tool_path  # noqa: E402

SINK = _DELIVERY / "kitchen-sink.md"
SUPPLEMENT = _DELIVERY / "cache-supplement.txt"
# The sink's one image. graphicx loads only if the file is really beside the .tex.
IMAGE = _DELIVERY / "probe.png"

# A cold prime fetches every package over the network one at a time, which is minutes.
_RENDER_TIMEOUT_SECONDS = 1800
_FETCH_TIMEOUT_SECONDS = 120


def _supplement_names() -> list[str]:
    """The names in cache-supplement.txt, comments and blanks dropped."""

    lines = SUPPLEMENT.read_text(encoding="utf-8").splitlines()
    return [s for s in (line.split("#", 1)[0].strip() for line in lines) if s]


def _tectonic(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(
        [tool_path("tectonic"), *args],
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        **kwargs,
    )


def _render(build: Path) -> None:
    """Render the sink strictly — no `-Z continue-on-errors`, unlike the app, under whose flags a
    package missing from the cache exits 0 with a plausible PDF."""

    run = _tectonic(
        ["--keep-logs", f"{BUILD_STEM}.tex"],
        cwd=build,
        stdout=subprocess.DEVNULL,
        timeout=_RENDER_TIMEOUT_SECONDS,
    )
    if run.returncode != 0:
        sys.exit(f"strict render of the sink failed:\n{run.stderr}")


def _fetch(name: str) -> None:
    """Pull one named file into the cache under the render's bundle hash; stdout is the file itself."""

    run = _tectonic(
        ["-X", "bundle", "cat", name],
        stdout=subprocess.DEVNULL,
        timeout=_FETCH_TIMEOUT_SECONDS,
    )
    if run.returncode != 0:
        sys.exit(f"could not fetch {name}:\n{run.stderr}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "out_dir",
        type=Path,
        help="cache root to prime; `bundles/` under it is what ships",
    )
    parser.add_argument(
        "--filelist",
        type=Path,
        help="write the primed file list here, to diff against tectonic-cache-filelist-linux.txt",
    )
    args = parser.parse_args()

    out = args.out_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    # to_pdf reads this as "the cache is frozen" and adds `--only-cached`, which is why this script
    # drives tectonic itself rather than convert_to_pdf.
    os.environ["TECTONIC_CACHE_DIR"] = str(out)

    with tempfile.TemporaryDirectory() as build_dir:
        build = Path(build_dir)
        shutil.copy2(IMAGE, build / IMAGE.name)
        # Raw, not preprocessed: the bidi pass rewrites the sink's markdown image into text, and
        # graphicx would never be pulled.
        build_tex(SINK.read_text(encoding="utf-8"), build)
        _render(build)

    for name in _supplement_names():
        _fetch(name)

    # `formats/` is per-machine — the app builds its own .fmt on the first render — so only
    # `bundles/` ships.
    shutil.rmtree(out / "formats", ignore_errors=True)

    files = sorted(
        p.relative_to(out).as_posix()
        for p in (out / "bundles").rglob("*")
        if p.is_file()
    )
    if args.filelist:
        args.filelist.write_text("\n".join(files) + "\n", encoding="utf-8")
    size = sum((out / f).stat().st_size for f in files)
    print(
        f"primed {len(files)} files, {size / 1024 / 1024:.1f}MB, in {out / 'bundles'}"
    )


if __name__ == "__main__":
    main()
