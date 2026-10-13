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

## How it works

- **Capture** (`background.js`): every request whose URL path ends in `.mp4` is stored as `{url, headers, capturedAt, pageUrl}`, `pageUrl` being its tab's URL (no tab URL, no capture). The store is one ring of 50 across all tabs, deduped by `url`; the badge is set per tab and counts only that page's captures.
- **Source** (popup, on open): clears the tab's badge and shows exactly one source — a YouTube page (`/download-youtube`), else this page's captures (`/download` with the raw URL + captured headers), else a `.pdf` tab (`/upload-pdf`).
- **Per-page isolation** is by exact `pageUrl === activeTab.url` (query and hash included), so captures from other tabs never leak in and navigating away hides earlier ones.
- **Sizes** come from the server's `POST /probe-size`, since `Cookie` is a forbidden `fetch` header; `[…]` while pending, `[?]` when unknown.
- **PDF** is fetched by the popup itself with `credentials: 'include'`, so the user's session cookies authenticate, then uploaded as bytes.

## MV3 rules this relies on

- Non-blocking `webRequest` with `extraHeaders` is allowed in MV3 (only `webRequestBlocking` is policy-only); `extraHeaders` is what exposes `Cookie`/`Referer`/`Origin` for the server's header replay.
- The listener is registered synchronously at top level, so Chrome re-wakes a suspended worker for it; all state is in `chrome.storage.local`. Captures are written through one promise chain so a burst can't lose an entry to a racing read-modify-write.
- The `<all_urls>` host permission exempts the popup's `fetch`es from CORS (server calls and the PDF fetch alike), so `DOWNLOADER_EXTENSION_ID` is not needed for it.

## Conventions

- No dependencies and no build step (MV3); plain classic scripts.
- Language follows Chrome's UI language (`chrome.i18n`), not the app's setting: `<html dir>` from `@@bidi_dir`, `lang` from `@@ui_locale`; static strings fill from `data-i18n` / `data-i18n-placeholder` at load. No user-facing literal in `popup.html`/`popup.js`; CSS uses logical properties only.
- A server failure shows a translated headline with the server's `error` prose verbatim beneath, never translated.
- Light theme only; `popup.css` copies the tokens it uses from `frontend/src/styles/tokens.css` and the `.btn--primary` rules from `button.css`.
- `suggestName` in `popup.js` is a port of `frontend/src/features/lectures/utils/nextName.ts` (prefix inferred from the course's own names; `next` for a video, `latest` for a PDF). The fallback prefix comes from `_locales` (`dirLecture`/`dirRecitation`). Change both together.
- A brand-new course needs nothing here: the server creates it before the job starts.
- `SERVER` is hardcoded to `http://localhost:3052` and calls carry no `X-FastStudy-Secret`: the extension can't learn an ephemeral port or receive `FASTSTUDY_SECRET`, which is why it isn't packaged.

## Testing

No suite. Load it into a Playwright persistent Chromium context (`--load-extension`, `--disable-extensions-except`, `--headless=new`) against a local server. Playwright can't attach to the toolbar popup, so open `popup.html` as a tab created with `active: false` in the lecture tab's window — its "active tab" is then still the lecture page. To aim at another server port, use a temp copy of this folder with `SERVER` rewritten.
