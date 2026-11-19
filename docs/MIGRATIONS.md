# Migrations

Code that exists only to bring data written by an older version into line with the current one. Each
entry is temporary by design: it names the code, what old state it handles, and the signal that
makes it safe to delete. When an entry's removal condition holds, delete the code, its tests and its
row here in one change.

A migration patch is added here in the same change that introduces it, and its code carries a
one-line comment pointing at this file.

## Material source adoption

- **Code:** `database/fs/materials.py`, the adoption step of `write_material`.
- **Old state:** material PDFs saved before materials recorded their download source have no entry
  in the lecture's `.materials.json`, so no discovery row can match them and the downloads page
  offers them again.
- **What it does:** a `POST …/materials?source=` whose source the lecture doesn't hold yet is
  compared byte for byte with the lecture's source-less materials of equal size. On an identical
  match the source is recorded on that file and nothing new is written, instead of a duplicate
  `material.N.pdf`.
- **Remove when:** users' source-less materials have been re-downloaded once (each re-download
  adopts them). After removal, a re-download of a still-unadopted old material lands as one
  duplicate. PDFs saved by the Chrome extension never carry a
  source, so they never adopt either way. They are not a reason to keep this.

## Bare-string material source

- **Code:** `database/fs/material_meta.py`, the `isinstance(v, str)` branch of `read_meta`.
- **Old state:** a lecture's `.materials.json` written before material meta holds `{name: "<source>"}`
  instead of `{name: {"source": …}}`.
- **What it does:** reads a bare string as `{"source": value}`; every write produces the new shape.
- **Remove when:** every install has rewritten its sidecars. A sidecar is rewritten on any material
  write, delete or toggle in that lecture, so one that never sees such a change stays in the old shape
  and, after removal, loses its sources: a still-unadopted old material is offered again as one duplicate.

## Plaintext Moodle token

- **Code:** `downloader/auto/src/auth/tokenStore.js`, the plaintext branch of `readTokenFile`.
- **Old state:** a Moodle token file written before the launcher passed `FASTSTUDY_TOKEN_KEY` is
  plain JSON.
- **What it does:** reads it and, when a key is set, rewrites it encrypted.
- **Remove when:** every install has launched once under a release that sets the key. After
  removal, a still-plaintext file reads as absent, so the user reconnects once.

## Assignment file manifest seed

- **Code:** `database/fs/assignments.py`, the seed branch of `_load_manifest` (after the `v` 2 check)
  and `_is_junk_name`.
- **Old state:** an assignment folder written by app 0.2.15 or earlier has no `.assignment_files.json`
  or a flat `{filename: source}` one that lists only downloaded files, while the file list now shows
  only manifest entries.
- **What it does:** on the folder's first read or upload, records every regular file in it (keeping
  known sources, dropping junk names: dotfiles, `~$*`, `*.tmp`, `Thumbs.db`, `desktop.ini`) and
  writes the manifest as `{"v": 2, "files": {…}}`.
- **Remove when:** no install can still hold an unseeded folder, i.e. upgrading straight from 0.2.15
  or earlier is no longer supported. After removal, an unseeded folder lists no files until
  something is uploaded to it, and even then only that upload.

## Extension version without a recorded asset

- **Code:** `delivery/extension-version.mjs`, the `manifestAt(tag).version` fallback in
  `extensionVersion`.
- **Old state:** Releases published before `publish.yml` uploaded `extension-version.txt` carry no
  record of the extension version they shipped.
- **What it does:** reads the version from `downloader/extension/manifest.json` at that Release's
  tag, which is what it shipped unstamped.
- **Remove when:** the newest non-draft Release carries `extension-version.txt`, which every
  publish uploads. After removal, a missing asset should fail the build instead.

## Leftover .archived marker

- **Code:** `database/fs/tree.py`, `_drop_archived_marker`, called from `read_course`.
- **Old state:** a course the user archived in an older version holds an empty `.archived` file in
  its course dir. Nothing reads it any more.
- **What it does:** every tree read deletes the file from each course dir it lists; a delete that
  fails is ignored and retried on the next read.
- **Remove when:** every install has listed its courses once on a version that carries this code.
  After removal, a still-present `.archived` file is an inert hidden file: it never becomes a tree
  row and changes no behaviour.

## Gemini hydrogen prompt

- **Code:** `frontend/` — the one-time hydrogen confirm modal — and the `hydrogen_prompted` field
  in `electron/store.js`.
- **Old state:** an install set up before `gemini-4-hydrogen` became the first listed model saved
  an older model (usually `gemini-3.8-flash`) at the init wall, so it keeps using that model.
- **What it does:** once per user, when the saved model is not `gemini-4-hydrogen` and
  `hydrogen_prompted` is unset, a confirm modal offers the switch. Yes moves `gemini-4-hydrogen` to
  the top of the summary model order and keeps the rest of it;
  No, Esc or a click outside keeps the model. Any answer sets `hydrogen_prompted`, so it never asks
  again. The init wall sets it too, so a new install never sees the offer.
- **Remove when:** most installs have launched once on a version that carries this code. After
  removal, an install that never answered keeps its older model until the user changes it in
  Settings. Remove `hydrogen_prompted` from the store's field list in the same change; a key left
  in a user's settings.json is then ignored and needs no cleanup.

## Derived summary model fallback list

- **Code:** the derivation in `backend/services/settings.py` `gemini_fallback_models()` (the
  `GEMINI_AUTO_FALLBACK` branch and the wrap-round default), and its frontend twin that builds the
  Settings form's model order when `geminiFallbackModels` is `null`.
- **Old state:** an install that never saved `gemini_fallback_models` has only `gemini_model` and
  possibly `gemini_auto_fallback`.
- **What it does:** an absent list becomes every other curated model in `GEMINI_MODELS` order after
  the main model, wrapping round — or `[]` when `gemini_auto_fallback` is false. The first Save in
  Settings or a Hydrogen prompt answer writes the list explicitly, and the derivation stops applying.
- **Remove when:** most installs have launched once on a version that carries this code and saved
  Settings since, plus one release of grace. After removal an absent list means `[]`; drop
  `gemini_auto_fallback` from every store's field list, `_ENV_KEYS` and `ConfigUpdate` in the same change.

## Mac-less release gate

- **Code:** `site/stamp.sh`, the gate block before the release checks; the `<!--mac-only-->`
  markers, `<!--win-only:…:win-only-->` comments and `data-win-content` attributes in
  `site/index.html` and `site/code-signing.html`; the gate section of `site/CLAUDE.md`.
- **Old state:** the latest GitHub Release predates the macOS build and has no
  `FastStudy-mac-arm64.dmg`, so a Mac download link on the page would 404.
- **What it does:** at deploy, a latest release without the dmg (or no release) strips every Mac
  button, link, section and claim and swaps in the Windows-only copy; with the dmg the markers are
  just removed.
- **Remove when:** the latest release carries `FastStudy-mac-arm64.dmg` — `publish.yml` requires it
  on every release, so the first macOS release makes the gate permanently idle. Delete the gate and
  the markers, keep the dmg size read in `stamp.sh`, and re-run prettier on both pages.
