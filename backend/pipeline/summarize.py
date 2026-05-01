import subprocess
from pathlib import Path

from timing import timed_pipeline

PROMPT_FILE = Path(__file__).parent.parent / "assets" / "instructions" / "summarize.md"


@timed_pipeline("summarize")
def summarize(transcript_path: Path) -> str:
    prompt = PROMPT_FILE.read_text(encoding="utf-8")
    full_prompt = f"{prompt}\n\nThe transcript is in the file: {transcript_path}"

    result = subprocess.run(
        [
            "gemini",
            "--output-format", "text",
            "--include-directories", str(transcript_path.parent),
            "-p", full_prompt,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    if result.returncode != 0:
        raise RuntimeError(f"Gemini error:\n{result.stderr}")

    return result.stdout
