# Chrome extension guide

`/extension` (`features/extension/ExtensionView`) walks the user once through loading the shipped Chrome
extension unpacked: open `chrome://extensions`, Developer mode, Load unpacked, pin, use. The sidebar row sits
below Downloads.

- **Copy, not open** — `open.external` refuses `chrome://`, so step 1 copies the address instead.
- **The folder** — step 3 shows `window.faststudy.extension.path` with Copy and Open folder (`reveal()`).
  With no `extension` on the bridge (browser dev, an older launcher) both hide behind
  `.extension-note--no-bridge`; the steps still render. How the folder is kept is
  [electron/docs/EXTENSION.md](../../electron/docs/EXTENSION.md).
- **Screenshots** — `import.meta.glob` picks up `src/assets/extension-guide/<step>.png` by name
  (`1-open-extensions`, `2-developer-mode`, `3-load-unpacked`, `4-pin`, `5-use`). A missing file renders
  `.extension-shot--placeholder`, the same 16:10 box, so adding a file changes no code. Capture at
  1280x800 from a Hebrew Chrome; the page shows it at up to 640px wide.
