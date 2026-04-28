# Fast Study

Turns a Hebrew video lecture into a structured written summary.

**Pipeline:** video → audio → transcript → summary

## Requirements

- python 3.10+
- `ffmpeg` installed system-wide
- [Groq API key](https://console.groq.com) (free)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated

## Usage

```bash
python main.py lecture.mp4 gsk_your_key
```

Or set `GROQ_API_KEY` as an env var and omit it from the command.

**Outputs** (saved next to the script):
| File | Content |
|---|---|
| `lecture.mp3` | Extracted audio |
| `lecture_transcript.txt` | Raw Hebrew transcript |
| `lecture_summary.md` | Structured summary |

## Customizing the summary format

Edit `summarize.md` to change how the summary is structured — it's the prompt sent to Gemini. The default output includes a title, section-by-section content (nearly everything from the transcript, just cleaned up), key takeaways, and action items.
