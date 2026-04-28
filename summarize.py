import sys
import subprocess
from pathlib import Path

PROMPT_FILE = Path(__file__).parent / "summarize.md"


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
        print(f"Gemini error:\n{result.stderr}")
        sys.exit(1)

    return result.stdout


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python summarize.py <transcript.txt>")
        sys.exit(1)

    transcript_path = Path(sys.argv[1])
    if not transcript_path.exists():
        print(f"File not found: {transcript_path}")
        sys.exit(1)

    if not PROMPT_FILE.exists():
        print(f"Prompt file not found: {PROMPT_FILE}")
        sys.exit(1)

    print("Summarizing with Gemini...")
    transcript = transcript_path.read_text(encoding="utf-8")
    summary = summarize(transcript)

    output_path = transcript_path.stem.replace("_transcript", "") + "_summary.md"
    Path(output_path).write_text(summary, encoding="utf-8")

    print(f"Summary saved to: {output_path}")
