import subprocess
from pathlib import Path

from timing import timed_pipeline

PROMPT_FILE = Path(__file__).parent.parent / "assets" / "instructions" / "summarize.md"


@timed_pipeline("summarize")
def summarize(transcript: str) -> str:
    prompt = PROMPT_FILE.read_text(encoding="utf-8")

    result = subprocess.run(
        ["gemini", "--output-format", "text", "-p", prompt],
        input=transcript,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )

    if result.returncode != 0:
        raise RuntimeError(f"Gemini error:\n{result.stderr}")

    return result.stdout
