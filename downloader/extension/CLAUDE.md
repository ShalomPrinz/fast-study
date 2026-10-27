# extension/

## Status

Maintained. The capture path for users whose university keeps the Moodle web service closed (so `auto/`'s WS-token flow can't reach it). Loaded unpacked in `chrome://extensions` (Developer mode): packaged users load the copy the app ships, devs load `downloader/extension`.

Extension ID: **`hknnjgdhokbapjodjklfodhobjekjlnn`**, pinned by the public `key` in `manifest.json` (its private half was discarded; load-unpacked never needs it). `server/src/config.js` and `electron/`'s native host `allowed_origins` spell this ID; regenerating the key changes it in both.

## Files

| File                          | What it is                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `manifest.json`               | MV3; `webRequest` + `storage` + `nativeMessaging`, host `<all_urls>`, pinned `key`; name/description from `_locales` |
| `bridge.js`                   | server discovery through the native host; loaded by the popup and `importScripts`ed by the worker |
| `background.js`               | service worker: observational `webRequest.onSendHeaders` capture of `.mp4` and `.m3u8` requests; the `onStartup` version check |
| `popup.html` / `.css` / `.js` | the toolbar popup: mode switch, source, then course/kind/name or file name/folder, Download      |
| `_locales/{en,he}/`           | every user-facing string; Hebrew wording copied from `frontend/src/locales/he/messages.po`       |
| `icons/`                      | 16/32/48/128 PNGs extracted from `electron/assets/icon.ico`                                      |
| `fonts/`                      | Heebo 400/500/600 woff2, hebrew + latin subsets, from `@fontsource/heebo` (OFL, `fonts/OFL.txt`) |

## How it works

- **Server discovery** (`bridge.js`, popup open): `chrome.runtime.sendNativeMessage('com.faststudy.bridge', {})`. A `{port, secret}` reply means `http://127.0.0.1:<port>` with `X-FastStudy-Secret` on every server call; `{running: false}` shows "Open the FastStudy app" and calls nothing; no host registered (dev, WSL) falls back to `http://localhost:3052` with no secret. The host and its registration are `electron/`'s.
- **Self-update**: a reply's `extensionVersion` that differs from the manifest's triggers `chrome.runtime.reload()`, from the popup and from the worker's `onStartup`, at most once per shipped version (`reloadedFor` in storage), so a folder the app never refreshes cannot reload on every open.
- **Capture** (`background.js`): every request whose URL path ends in `.mp4` or `.m3u8` is stored as `{url, headers, capturedAt, pageUrl}`, `pageUrl` being its tab's URL (no tab URL, no capture). The store is one ring of 50 across all tabs, deduped by `url`; the badge is set per tab and counts only that page's captures, all its `.m3u8` ones as a single video (a player loads one playlist per variant).
- **Source** (popup, on open): clears the tab's badge and shows exactly one source — a YouTube page (`/download-youtube`), else this page's captures (`/download` with the raw URL + captured headers). When they include `.m3u8`, the popup sends them (newest 30) to `POST /hls-streams` and lists only the returned streams, best first with `streams[0]` preselected, labelled `[size · duration · no audio]` (the marker only when `hasAudio === false`) and the last two path segments, plus any `.mp4` captures; no stream with every failed playlist refused (`HTTP 401`/`HTTP 403`) means the page's session expired ("reload the page" headline), any other failure shows the generic streams headline; the first `detail` shows beneath either, else a `.pdf` tab (`/upload-pdf`).
- **Per-page isolation** is by exact `pageUrl === activeTab.url` (query and hash included), so captures from other tabs never leak in and navigating away hides earlier ones.
- **Sizes** of `.mp4` captures come from the server's `POST /probe-size` (an HLS stream's from `/hls-streams`' `estimatedBytes`), since `Cookie` is a forbidden `fetch` header; `[…]` while pending, `[?]` when unknown.
- **PDF** is fetched by the popup itself with `credentials: 'include'`, so the user's session cookies authenticate, then uploaded as bytes.
- **Lectures-only course**: a listed course's `lectures_only` flag, or for a typed-in course the server's `GET /course-structure` being `lectures_all` (fetched once per open; a failure keeps the choice), hides the kind choice and sends `kind=lecture` — except a name already among its recitations, which keeps `recitation`. Re-evaluated on every course edit.
- **Mode** (`popupMode` in storage): "App lecture" sends course/kind/name; "General video" sends `dest:'folder'` + a file name prefilled from the tab title, and shows the server's folder read-only. "Choose folder…" asks the server to have the app window open its picker (the popup can't host one); the new folder shows on the next open ([DOWNLOAD.md](../server/docs/DOWNLOAD.md)).

## MV3 rules this relies on

- Non-blocking `webRequest` with `extraHeaders` is allowed in MV3 (only `webRequestBlocking` is policy-only); `extraHeaders` is what exposes `Cookie`/`Referer`/`Origin` for the server's header replay.
- The listener is registered synchronously at top level, so Chrome re-wakes a suspended worker for it; all state is in `chrome.storage.local`. Captures are written through one promise chain so a burst can't lose an entry to a racing read-modify-write.
- The `<all_urls>` host permission exempts the popup's `fetch`es from CORS (server calls and the PDF fetch alike): measured, a POST with `X-FastStudy-Secret` to a server sending no CORS headers succeeds with no preflight. The server's allowlisted extension origin is only a backstop.

## Conventions

- No dependencies and no build step (MV3); plain classic scripts.
- Language follows Chrome's UI language (`chrome.i18n`), not the app's setting: `<html dir>` from `@@bidi_dir`, `lang` from `@@ui_locale`; static strings fill from `data-i18n` / `data-i18n-placeholder` at load. No user-facing literal in `popup.html`/`popup.js`; CSS uses logical properties only.
- A server failure shows a translated headline with the server's `error` prose verbatim beneath, never translated.
- Light theme only; `popup.css` copies the tokens it uses from `frontend/src/styles/tokens.css` and the `.btn--primary` rules from `button.css`.
- `suggestName` in `popup.js` is a port of `frontend/src/features/lectures/utils/nextName.ts` (prefix inferred from the course's own names; `next` for a video, `latest` for a PDF; a lectures-only course takes the number over lectures + recitations, a recitation after a lecture on the same number, and the prefix from its lectures). The fallback prefix comes from `_locales` (`dirLecture`/`dirRecitation`). Change both together.
- A brand-new course needs nothing here: the server creates it before the job starts.

## Testing

No suite. Load it into a Playwright persistent Chromium context (`--load-extension`, `--disable-extensions-except`, `--headless=new`) against a local server. Playwright can't attach to the toolbar popup, so open `popup.html` as a tab created with `active: false` in the lecture tab's window — its "active tab" is then still the lecture page. Chromium reads native hosts from `<user-data-dir>/NativeMessagingHosts/com.faststudy.bridge.json`, so a fake host there (any executable speaking the 4-byte length framing) drives the bridge paths. Headless Chromium never fires `onStartup` and doesn't bring a command-line extension back after `chrome.runtime.reload()`; call the handler from `sw.evaluate` instead.
