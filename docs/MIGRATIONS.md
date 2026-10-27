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
