# PyInstaller spec for the one-dir bundle holding both Python services, selected by entry.py's
# argv[1]. Built from backend/'s environment:
#
#   cd backend && uv run --with pyinstaller pyinstaller ../delivery/services.spec
#
# That works because database/'s dependencies are a strict SUBSET of backend/'s, which is an
# invariant this build rests on rather than something it checks: a dependency added to database/
# alone would be absent from the bundle and fail at runtime on a clean machine, so it has to be
# added to backend/pyproject.toml too.
#
# Every path is derived from SPECPATH, so the build does not care what the working directory is.

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files

_REPO = Path(SPECPATH).parent  # noqa: F821 — SPECPATH is injected by PyInstaller
_BACKEND = _REPO / "backend"
_DATABASE = _REPO / "database"

# The read-only files backend/services/resources.py resolves at runtime: fonts, the pandoc filter
# and template, and the prompt instructions.
datas = [(str(_BACKEND / "assets"), "assets")]

# Conditional because it is the one build input that is not committed — it arrives as an Actions
# secret written to disk in the workflow, and a build without it must still produce a bundle.
_credentials = _BACKEND / "credentials.json"
if _credentials.exists():
    datas.append((str(_credentials), "."))

# Data files no import reaches: certifi's CA bundle, and googleapiclient's API discovery JSON, cut
# to the one document the app reads by the prune below.
datas += collect_data_files("certifi")
datas += collect_data_files("googleapiclient")

# uvicorn picks its protocol, lifespan and loop implementations by string at runtime, so the module
# graph never sees them. Each one fails only at startup, on a clean machine.
hiddenimports = [
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.loops.uvloop",
]

a = Analysis(  # noqa: F821
    [str(Path(SPECPATH) / "entry.py")],  # noqa: F821
    # The lib/ source dirs are listed explicitly: consumers depend on them as editable installs,
    # whose .pth import hook PyInstaller never runs, so `runtime`, `logging_setup` and `tools`
    # are otherwise unresolvable.
    pathex=[
        str(_BACKEND),
        str(_DATABASE),
        *(str(_REPO / "lib" / name / "py") for name in ("runtime", "logging", "tools")),
    ],
    datas=datas,
    hiddenimports=hiddenimports,
)

# The app builds one client — build("drive", "v3") in backend/pipeline/upload_to_drive.py, which
# reads its document off disk, not the network — so the other 581 are 97MB of the bundle for nothing.
_DOCUMENTS = "googleapiclient/discovery_cache/documents/"
_DRIVE_DOC = _DOCUMENTS + "drive.v3.json"


def _dest(entry):
    # A TOC entry's bundle-relative destination, slash-separated whatever the build host is.
    return entry[0].replace("\\", "/")


# Pruned on the finished TOC, not on `datas`: PyInstaller's own googleapiclient.model hook collects
# every document a second time, out of reach of the collect_data_files above.
a.datas = [
    entry
    for entry in a.datas
    if not _dest(entry).startswith(_DOCUMENTS) or _dest(entry) == _DRIVE_DOC
]

# A second build() call, or an upstream rename, would otherwise ship a bundle that imports fine and
# dies on a user's first upload — silently, and only on Windows.
if not any(_dest(entry) == _DRIVE_DOC for entry in a.datas):
    raise SystemExit(f"services.spec: nothing collects {_DRIVE_DOC}")

pyz = PYZ(a.pure)  # noqa: F821

# UTF-8 mode: piped stdio on Windows otherwise takes the ANSI codepage, so a Hebrew log line reaches
# launch.log as backslash escapes (stderr) or not at all (stdout).
options = [("X utf8=1", None, "OPTION")]

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    options,
    exclude_binaries=True,
    name="services",
    # Console, not windowed: the launcher reads the FASTSTUDY_PORT line off stdout, and tool spawns (no
    # CREATE_NO_WINDOW) stay hidden only by sharing this console, which windowsHide hides for console exes.
    console=True,
)

coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.datas,
    name="services",
)
