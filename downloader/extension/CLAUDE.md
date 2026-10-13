# extension/

## Status

Maintained. The capture path for users whose university keeps the Moodle web service closed (so `auto/`'s WS-token flow can't reach it). Dev-only and unpackaged: load `downloader/extension` unpacked in `chrome://extensions` (Developer mode), with `downloader/server` running on `localhost:3052`.

## Files

| File                          | What it is                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `manifest.json`               | MV3; `webRequest` + `storage`, host `<all_urls>`; name/description from `_locales`               |
| `background.js`               | service worker: observational `webRequest.onSendHeaders` capture of `.mp4` requests              |
| `popup.html` / `.css` / `.js` | the toolbar popup: source, course, kind, name, Download                                          |
| `_locales/{en,he}/`           | every user-facing string; Hebrew wording copied from `frontend/src/locales/he/messages.po`       |
| `icons/`                      | 16/32/48/128 PNGs extracted from `electron/assets/icon.ico`                                      |
| `fonts/`                      | Heebo 400/500/600 woff2, hebrew + latin subsets, from `@fontsource/heebo` (OFL, `fonts/OFL.txt`) |

## MV3 rules this relies on

- Non-blocking `webRequest` with `extraHeaders` is allowed in MV3 (only `webRequestBlocking` is policy-only); `extraHeaders` is what exposes `Cookie`/`Referer`/`Origin` for the server's header replay.
- The listener is registered synchronously at top level, so Chrome re-wakes a suspended worker for it; all state is in `chrome.storage.local`. Captures are written through one promise chain so a burst can't lose an entry to a racing read-modify-write.
- The `<all_urls>` host permission exempts the popup's `fetch`es from CORS — the server's calls and the PDF fetch with the user's cookies alike — so `DOWNLOADER_EXTENSION_ID` is not needed for the popup to work.

## Conventions

- No dependencies and no build step; plain classic scripts.
- Language follows Chrome's UI language (`chrome.i18n`), not the app's setting: `<html dir>` from `@@bidi_dir`, `lang` from `@@ui_locale`; static strings fill from `data-i18n` / `data-i18n-placeholder` at load. No user-facing literal in `popup.html`/`popup.js`; CSS uses logical properties only.
- A server failure shows a translated headline with the server's `error` prose verbatim beneath, never translated.
- Light theme only; `popup.css` copies the tokens it uses from `frontend/src/styles/tokens.css` and the `.btn--primary` rules from `button.css`.
- `suggestName` in `popup.js` is a port of `frontend/src/features/lectures/utils/nextName.ts` (prefix inferred from the course's own names; `next` for a video, `latest` for a PDF). The fallback prefix comes from `_locales` (`dirLecture`/`dirRecitation`). Change both together.
- A brand-new course needs nothing here: the server creates it before the job starts.
- `SERVER` is hardcoded to `http://localhost:3052`; the extension can't learn an ephemeral port or receive `FASTSTUDY_SECRET`, which is why it isn't packaged.

## Testing

No suite. Load it into a Playwright persistent Chromium context (`--load-extension`, `--disable-extensions-except`, `--headless=new`) against a local server. Playwright can't attach to the toolbar popup, so open `popup.html` as a tab created with `active: false` in the lecture tab's window — its "active tab" is then still the lecture page. To aim at another server port, use a temp copy of this folder with `SERVER` rewritten.
