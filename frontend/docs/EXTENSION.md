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
- **Zoom** — a note above step 1 says so; clicking a screenshot opens it over a `.modal-overlay` dimmed
  darker than other modals, fit with a labelled Close pill below it (never upscaled, clear of the
  corner toasts); any click, Close or Esc closes it and returns focus to that screenshot. Close has its
  own msgid context, since the shared "Close" is "סגירה" and this one is "סגור".
- **General video** — the tab lists folder downloads above the guide ([JOBS.md](JOBS.md) §Folder jobs).
  The popup's "Choose folder…" arrives as `folder:pick {folder}` on a dedicated `/events?picker=1` stream;
  `useGeneralFolderPicker`, mounted in `Layout` so any page answers, opens `pickFolder` at that folder and
  `POST /general-folder`s the choice (cancel saves nothing, a request while the dialog is up is dropped,
  a refusal toasts). With no `pickFolder` it opens no picker stream, so the server answers the popup
  409 `folder_picker_unavailable`.
