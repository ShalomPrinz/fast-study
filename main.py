import os
import sys
from pathlib import Path

from strip_audio import strip_audio
from transcribe import transcribe_audio
from summarize import summarize


GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")


def main():
    if len(sys.argv) < 2:
        print("Usage: python main.py <video.mp4> [groq_api_key]")
        sys.exit(1)

    video_path = sys.argv[1]
    if not Path(video_path).exists():
        print(f"❌ File not found: {video_path}")
        sys.exit(1)

    api_key = sys.argv[2] if len(sys.argv) > 2 else GROQ_API_KEY
    if not api_key:
        print("❌ GROQ_API_KEY not set. Pass it as second argument or set the env var.")
        sys.exit(1)

    stem = Path(video_path).stem
    audio_path = stem + ".mp3"
    transcript_path = stem + "_transcript.txt"
    summary_path = stem + "_summary.md"

    # Step 1 — Strip audio
    print(f"\n🎬 Step 1/3 — Extracting audio from {video_path}...")
    strip_audio(video_path, audio_path)
    print(f"✅ Audio ready: {audio_path}")

    # Step 2 — Transcribe
    print(f"\n🎙️  Step 2/3 — Transcribing with Groq (whisper-large-v3, Hebrew)...")
    transcript = transcribe_audio(audio_path, api_key)
    Path(transcript_path).write_text(transcript, encoding="utf-8")
    print(f"✅ Transcript saved: {transcript_path}")

    # Step 3 — Summarize
    print(f"\n🤖 Step 3/3 — Summarizing with Gemini...")
    summary = summarize(transcript)
    Path(summary_path).write_text(summary, encoding="utf-8")
    print(f"✅ Summary saved: {summary_path}")

    print(f"\n🎉 Done! All outputs saved:")
    print(f"   🔊 Audio:      {audio_path}")
    print(f"   📝 Transcript: {transcript_path}")
    print(f"   📄 Summary:    {summary_path}")


if __name__ == "__main__":
    main()
