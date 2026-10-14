# Chrome extension guide

The Downloads page's Extension tab (`features/extension/ExtensionGuide`, [DOWNLOADS.md](DOWNLOADS.md)
§Layout) walks the user once through loading the shipped Chrome extension unpacked: open
`chrome://extensions`, Developer mode, Load unpacked, pin, use.

- **Copy, not open** — `open.external` refuses `chrome://`, so step 1 copies the address instead.
- **The folder** — step 3 shows `window.faststudy.extension.path` with Copy and Open folder (`reveal()`).
  With no `extension` on the bridge (browser dev, an older launcher) both hide behind
  `.extension-note--no-bridge`; the steps still render. How the folder is kept is
  [electron/docs/EXTENSION.md](../../electron/docs/EXTENSION.md).
- **Screenshots** — `import.meta.glob` picks up `src/assets/extension-guide/<step>.png` by name
  (`1-open-extensions`, `2-developer-mode`, `3-load-unpacked`, `4-pin`, `5-use`), so adding or
  replacing one changes no code; a missing file renders `.extension-shot--placeholder`, a 16:10 box at
  column width. Each image keeps its own aspect ratio: shrunk to the step column (up to ~840px), never
  upscaled, never cropped. Capture from a Hebrew Chrome at 1x; a wider capture shows smaller text, so a
  small UI (a menu) is cropped tight and then shows at its own pixel size.
