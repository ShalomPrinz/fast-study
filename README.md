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
| `audio.mp3` | Extracted audio |
| `transcript.txt` | Raw Hebrew transcript |
| `summary.md` | Structured summary |

## Converting the summary to PDF

```bash
python3 to_pdf.py summary.md
```

Produces `summary.pdf` alongside the input file, with Hebrew/RTL layout and math expressions rendered. The Hebrew font (Noto Serif Hebrew) is bundled in `fonts/` — no system font installation needed.

**Additional requirements for PDF export:**
- `pandoc` — `sudo apt install pandoc`
- XeLaTeX — `sudo apt install texlive-xetex texlive-lang-arabic`

Math expressions in the summary (`$...$` inline, `$$...$$` block) are rendered as proper formulas in the PDF.

## Customizing the summary format

Edit `summarize.md` to change how the summary is structured — it's the prompt sent to Gemini. The default output includes a title, section-by-section content (nearly everything from the transcript, just cleaned up), key takeaways, and action items.
