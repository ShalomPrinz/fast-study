# Settings

Every user-facing setting the app has, the first-run wall that collects the required ones, and the
route that edits them all. The module behind it is
`services/settings.ts` (see `SERVICES.md`); this file covers the surface.

## The entries

| Setting           | Default                                   | Alternatives         | Owner       |
| ----------------- | ----------------------------------------- | -------------------- | ----------- |
| Gemini API key    | none                                      | user-supplied        | `backend/`  |
| Groq API key      | none                                      | user-supplied        | `backend/`  |
| Data folder       | prefilled, confirmed on first run         | any directory        | `database/` |
| UI language       | OS locale — Hebrew unless it says English | Hebrew, English      | frontend    |
| Drive upload      | off                                       | on                   | `backend/`  |
| Drive root folder | none — required once Drive is on          | any folder name      | `backend/`  |
| Summary model     | the first curated entry                   | the curated dropdown | `backend/`  |
| Runner controls   | hidden                                    | shown, hidden        | frontend    |

The model list comes from `GET /config/options`, so a model id that the free tier does not serve can
never be typed in — a wrong one surfaces minutes later as a pipeline failure.

## What is not a setting

The list above is closed on purpose. Each of these looks like a field and deliberately isn't one:

| Not a setting                                                                                           | Why                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| The Whisper model and the `he` transcript language (`backend/pipeline/transcribe.py`)                   | The corpus is Hebrew lectures; no user has a reason to change either                                                                |
| The summary length budget (`LENGTH_BUDGET_SUFFIX`, `backend/pipeline/summarize.py`)                     | A prompt-shaped tuning knob, not a preference                                                                                       |
| The Moodle site (`DEFAULT_SITE`, `downloader/auto/src/moodle/wsClient.js`)                              | One university, one site — and one field fewer on first run                                                                         |
| Service ports and the `VITE_API_URL` / `VITE_DATABASE_URL` and `BACKEND_URL` / `DATABASE_URL` overrides | Wiring, not preference: every default already matches, and a settings save leaves the keys in `.env` untouched                      |
| `DOWNLOADER_EXTENSION_ID`, `FRONTEND_URL`                                                               | CORS origins the download server defaults for itself; only a reloaded unpacked extension or a non-default dev origin ever sets them |
| The sidebar's lectures/courses mode and the search view's chosen course                                 | Per-view memory, kept in `localStorage` by the view that owns it — no other view and no service has to agree on it                  |
| Running unfinished lectures at app start                                                                | A pipeline sweep is a deliberate act; the runner button and `backend/`'s 03:00 cron already cover both the manual and the unattended case |

## `/settings`

`features/settings/SettingsView.tsx`, reachable from the sidebar's fifth nav row. It loads the store
and the backend's options once, edits a local form, and saves the changed fields in one
`saveSettings` call. The two UI preferences are written to `localStorage` first and unconditionally:
they need no request, so a downed service must not cost the user a toggle.

**Every save answers.** Success toasts, and so does failure — including a connection error, whose
own toast is deduped per service and reads as ambient noise. The store is written before the owning
services, so a failure after that point leaves the `.env` current and the running process behind
until a restart or a successful retry; the toast asks for the retry rather than naming the phase.

**The key fields are write-only.** A stored key never comes back from the store, so a set field shows
a "a key is saved" placeholder and typing replaces it; an untouched (blank) field is never sent,
because an empty value there would clear the stored key.

**The language applies the moment it is picked**, so the rest of the screen reads in the chosen
language while it is still being filled in. The save that follows only records the choice in the
store; the effective locale stays `localStorage['fast-study:locale']`, which `services/i18n.ts` owns.

**Only the data folder is guarded.** On save, `utils/dataRootGuard.ts` reads `RunnerStatusContext` —
already SSE-fed, so its view is current — and raises `ConfirmModal` naming the runs in flight, since
changing the root mid-run leaves one lecture split across two roots. The check is advisory: the user
is never blocked, and the route carries a standing note that a change re-points only and never moves
data. Every other setting applies immediately with no check, because a key or a model id cannot
corrupt anything.

## The first-run wall

`app/InitGate.tsx` reads the store once at boot and decides between `features/settings/InitWall.tsx`
and the app. The wall is **not a page inside the app**: while it is up there is no sidebar, no route
and no way past it, and finishing it routes to the app's home.

`isInitialized` (`utils/required.ts`) is the whole gate: both API keys stored and a data folder
chosen. If the store cannot be reached at all the app is shown anyway — a downed service is not an
unconfigured install, and dropping a working app into onboarding over a transient outage is worse
than the connection toast the client already shows.

The wall shows more than it requires. The language picker is there so the rest of the screen reads in
the user's own language, and the Drive toggle so consent happens during onboarding rather than being
discovered later; neither blocks, and Drive's folder field is required only while the toggle is on.
The two UI preferences are not asked about at all and keep their first-boot defaults.

The data folder is **prefilled but confirmed, never silently accepted** — a checkbox, not an
implicit acceptance. In browser dev the prefill is whatever the store already holds, so an
already-filled `.env` satisfies the wall and it passes instantly; exercising it means blanking the
values.

For a non-technical user this is the hardest moment in the product, so each provider carries a short
how-to-generate-a-key guide beside its console link. That prose is frontend content and lives in the
Lingui catalogs, keyed by provider id; a provider with no entry simply shows the link alone. A save
failure is shown in place rather than toasted — a rejected data folder is the one thing standing in
the way.

Key validation is the same component as the route's, below.

## Key validation — `components/ApiKeyField.tsx`

One write-only field, one status slot, three outcomes. It probes through `probeKey` on blur and on
paste, and only when the value actually changed and is non-empty (`utils/keyStatus.ts`), so cycling
focus costs the provider nothing.

**An edit resets the field's probe memory** — the sequence number, so a probe still in flight for the
old text cannot land its verdict on the new one, and the last-probed value, so typing back to a key
the provider already rejected asks again rather than showing an empty slot. Only an untouched field
keeps its verdict for free.

| Outcome      | Fills the slot with                                 |
| ------------ | --------------------------------------------------- |
| `valid`      | verified, nothing further to do                     |
| `rejected`   | the key is wrong, and the console link is beside it |
| `unverified` | we could not check it — **not** that the key is bad |

The key-prefix mismatch is an instant offline warning that fills the same slot and is **overwritten**
by any probe result, so a key the provider accepts shows no stale prefix warning: there is nowhere
for one to survive. Prefixes are provider convention rather than contract, so a mismatch never blocks.

**Save is always permitted.** An unreachable provider must never reject a valid key, so `unverified`
is not a failure state.

## The UI preference — `shared/utils/uiPreferences.ts`

Runner-control visibility is the user's own preference, so it lives in `localStorage`; its first-boot
default comes from the settings store, which `app/InitGate` seeds from on the read it already makes at
boot — so a fresh browser profile and a packaged install agree without a rebuild, and a later store
change never flips a profile that has already been seeded. `resolvePreference` is the whole rule: a
stored choice wins, then the store's value, then the shipped default — controls **hidden**.
`usePreference` re-renders on every write, so toggling it here reaches the sidebar without a reload.

Its one consumer is `RunnerPipelineRow`, which renders nothing — button and in-flight panel alike —
while the controls are hidden.

## Settings the rest of the app reads — `shared/contexts/SettingsContext.tsx`

Some settings decide what other screens render, so the store's answer is held in a context wrapping
the whole app. It fetches nothing itself: `app/InitGate` pushes the read it already makes at boot,
the wall pushes what it saved, and `/settings` pushes each save — so a change reaches every screen
without a reload, and the settings screen stays the only place that talks to the store.

`useDriveEnabled` is its one consumer so far. Nothing stored means off, the same default the
backend's `settings.drive_enabled()` gives a missing `DRIVE_ENABLED`, so both ends agree on a fresh
install; it drives the pipeline's Drive stage and the definition of a complete lecture (see
[LECTURES.md](LECTURES.md)).
