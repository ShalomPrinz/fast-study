# Settings

Every user-facing setting the app has, the first-run wall that collects the required ones, and the
route that edits them all. The module behind it is
`services/settings.ts` (see `SERVICES.md`); this file covers the surface.

## The entries

| Setting           | Default                                   | Alternatives          | Owner       |
| ----------------- | ----------------------------------------- | --------------------- | ----------- |
| Gemini API key    | none                                      | user-supplied         | `backend/`  |
| Groq API key      | none                                      | user-supplied         | `backend/`  |
| Data folder       | prefilled, confirmed on first run         | any directory         | `database/` |
| UI language       | OS locale — Hebrew unless it says English | Hebrew, English       | frontend    |
| Drive upload      | off                                       | on                    | `backend/`  |
| Drive root folder | none — required once Drive is on          | any folder name       | `backend/`  |
| Summary model     | the first curated entry                   | the curated dropdown  | `backend/`  |
| Auto-run          | the whole pipeline                        | audio only, off       | `backend/`  |
| Nightly catch-up  | on                                        | off                   | `backend/`  |
| Nightly hour      | 03:00                                     | any hour, 00:00-23:00 | `backend/`  |

The model list comes from `GET /config/options`, so a model id that the free tier does not serve can
never be typed in — a wrong one surfaces minutes later as a pipeline failure.

**Auto-run is a ceiling on unattended work, not a schedule.** It caps a video dropped on a lecture or
fetched by the downloader, and the backend's nightly catch-up pass, at the whole pipeline / the audio
step / nothing at all. It never caps a run the user starts: the `/running` page's button always runs
everything. Unset means the whole pipeline, the same fallback `settings.auto_run()` applies, so both
ends agree on a fresh install (`useAutoRun`, beside `useDriveEnabled`).

**The nightly pass has two independent gates.** Its own switch decides whether the cron is scheduled
at all and at which hour; auto-run still caps what that pass may do, so `off` there means nothing
runs unattended whatever the switch says. Unset means on — the cron ran before it was a setting, and
`settings.nightly_run()` keeps that — and the hour is a number on the wire, never the `<select>`'s
string, since the store rejects a string. An unset or out-of-range hour reads as 3 on both ends
(`toNightlyHour`), so the screen always shows the hour that will actually fire.

## What is not a setting

The list above is closed on purpose. Each of these looks like a field and deliberately isn't one:

| Not a setting                                                                         | Why                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The Whisper model and the `he` transcript language (`backend/pipeline/transcribe.py`) | The corpus is Hebrew lectures; no user has a reason to change either                                                                                   |
| The summary length budget (`LENGTH_BUDGET_SUFFIX`, `backend/pipeline/summarize.py`)   | A prompt-shaped tuning knob, not a preference                                                                                                          |
| The Moodle site (`DEFAULT_SITE`, `downloader/auto/src/moodle/wsClient.js`)            | One university, one site — and one field fewer on first run                                                                                            |
| Service ports and the `BACKEND_URL` / `DATABASE_URL` overrides                        | Wiring, not preference: the frontend takes its URLs from the runtime bridge, and a settings save leaves the keys in `.env` untouched                   |
| `FRONTEND_URL`                                                                        | A CORS origin the download server defaults for itself; only a non-default dev origin ever sets it                                                      |
| `DOWNLOADER_EXTENSION_ID`                                                             | No default: unset unless a dev loading the unpacked extension sets it, and the packaged app never talks to that dev-only surface                       |
| The sidebar's lectures/courses mode and the search view's chosen course               | Per-view memory, kept in `localStorage` by the view that owns it — no other view and no service has to agree on it                                     |
| Running unfinished lectures at app start                                              | A pipeline sweep is a deliberate act; the `/running` page's button and `backend/`'s nightly cron already cover both the manual and the unattended case |

## `/settings`

`features/settings/SettingsView.tsx`, reachable from the sidebar's fifth nav row. It loads the store
and the backend's options once, edits a local form, and saves the changed fields in one
`saveSettings` call.

**Every save answers.** Success toasts, and so does failure — including a connection error, whose
own toast is deduped per service and reads as ambient noise. The store is written before the owning
services, so a failure after that point leaves the `.env` current and the running process behind
until a restart or a successful retry; the toast asks for the retry rather than naming the phase.

**The key fields are write-only.** A stored key never comes back from the store, so a set field shows
a "a key is saved" placeholder and typing replaces it; an untouched (blank) field is never sent,
because an empty value there would clear the stored key.

**The language applies the moment it is picked**, so the rest of the screen reads in the chosen
language while it is still being filled in. It reaches no save at all: `localStorage['fast-study:locale']`
is the only place it lives, and `services/i18n.ts` owns it.

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
chosen — the keys only on a machine that can store one, see below. If the store cannot be reached at all the app is shown anyway — a downed service is not an
unconfigured install, and dropping a working app into onboarding over a transient outage is worse
than the connection toast the client already shows.

The wall shows more than it requires. The language picker is there so the rest of the screen reads in
the user's own language, and the Drive toggle so consent happens during onboarding rather than being
discovered later; neither blocks, and Drive's folder field is required only while the toggle is on.
Auto-run and the nightly pass are not asked about and keep their defaults — a first install has
nothing to run yet, and cron hours are not a first-run question.

The data folder is **prefilled but confirmed, never silently accepted** — a checkbox, not an
implicit acceptance. In browser dev the prefill is whatever the store already holds, so an
already-filled `.env` satisfies the wall and it passes instantly; exercising it means blanking the
values.

For a non-technical user this is the hardest moment in the product, so each provider carries a short
how-to-generate-a-key guide beside its console link. That prose is frontend content and lives in the
Lingui catalogs, keyed by provider id; a provider with no entry simply shows the link alone. A save
failure is shown in place rather than toasted — a rejected data folder is the one thing standing in
the way.

Key validation is the same component as the route's, below, and so are the browser prerequisite and
the BIU account — the two things on the wall that report a state without standing in the way.

## When the computer can't store a key

The packaged app keeps the two API keys encrypted by the operating system, and a machine with no
keystore to encrypt against — a Linux box with no keyring — cannot store them at all. The launcher
reports that on the runtime bridge, `services/runtime.ts` resolves it once as `canStoreApiKeys`, and
the frontend treats it as degraded rather than fatal: no bridge at all means browser dev, where keys
go into `database/`'s `.env` and secure storage never enters into it, so a missing answer means a
machine that is fine.

Both screens treat it the same way: the key fields are not rendered at all, and the note
(`components/SecureStorageNotice.tsx`, the single source of that copy) stands where they would have
been, under the section's own heading. A field that can never be filled is noise, and a disabled one
invites a user to try. The summary model goes with them on `/settings`, since a model no key can
reach is one more pointless pick, so on both screens that section is its heading and the note alone.

A save therefore carries no key field at all: nothing can type into one, and `buildPatch` omits a
blank key anyway — the same rule that stops an untouched write-only field clearing a stored key. The
model cannot be blanked either, though for a narrower reason: an unrendered select still holds what
the form loaded, which is the stored model where there is one and otherwise the first curated id, so
a save either omits the model or writes the default the backend would have applied anyway. Every
other setting — data folder, Drive, auto-run, language — saves as usual, which is the whole of what
"degraded" means.

The keys also stop counting as required, in `missingEntries` and `isInitialized` alike: an entry
that can never be filled would leave the wall with no way past it and the app unreachable, while the
data folder (and Drive's folder when Drive is on) still blocks as always. Both functions take the
flag as an argument rather than reading the module, which keeps them pure and unit-tested.

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

## The browser prerequisite — `components/BrowserPrereqField.tsx`

The second prerequisite both screens carry, in the same field vocabulary as an API key: a status
slot, a console-style link, and a way to re-run the check. `GET /prereqs/browser` on the
auto-downloader answers `{ available, channel, browser, detail }` and always `200` — "no browser" is
an answer, not a failure — so the field renders `browser`, the display name, and can say _Microsoft
Edge_ rather than _a browser_.

**It never blocks.** A missing Chromium browser costs auto-download and Zoom capture and nothing
else, so it reaches neither `missingEntries` nor `isInitialized`, and the copy says plainly what is
lost and that a video added by hand still becomes a summary. That is the whole difference from the
two keys.

| State       | Shows                                                                            |
| ----------- | -------------------------------------------------------------------------------- |
| `available` | the browser that was found, by name                                              |
| `missing`   | the consequence, Chrome's download page, the service's diagnostic line, re-check |
| `unknown`   | the service was unreachable — **not** that no browser exists — and re-check      |

Only a success is cached server-side, so **Check again** after installing a browser genuinely
re-probes. Edge has no install link on purpose: it ships with Windows, so the only machine that ever
sees the link is one missing both, where Chrome is the fix. `detail` is one English diagnostic line
naming every channel tried and the path it looked at; it renders as fine print under the note,
`dir="ltr"`, and is never the primary message.

The state is on the field as `browser-prereq--{available,missing,unknown,checking}` beside
`#browser-prereq`, and the status line is `#browser-prereq-status`.

## The BIU account — `components/MoodleAccountField.tsx`

The downloads page's own `AccountStatus` — one chip and the single button that can move it — wrapped
in the field vocabulary above and sitting beside the browser check on both screens. It is never a
requirement in any sense: it reaches neither `missingEntries` nor `isInitialized`, and an
unconnected account costs only `/downloads`, which already disables itself. So the `chip--danger`
tone the downloads header uses is retoned to neutral here — red belongs on the page the missing
session actually blocks, not on a screen offering an optional connection.

`AuthStatusContext` probes nothing on mount and `AccountStatus` asks wherever it renders, so this
field is what makes a settings screen call `/auth/status` at all. `/settings` takes the provider
`Layout` already wraps every route in; the wall renders outside `Layout` and brings its own
instance. Neither adds a toast when the auto-downloader is down: the browser check beside it calls
the same service and the connection toast is deduped per base URL, and the wall renders outside the
`ToastContainer` entirely, so it cannot toast at all.

The field is `#moodle-account`; its state is `AccountStatus`'s own chip variant.

## Settings the rest of the app reads — `shared/contexts/SettingsContext.tsx`

Some settings decide what other screens render, so the store's answer is held in a context wrapping
the whole app. It fetches nothing itself: `app/InitGate` pushes the read it already makes at boot,
the wall pushes what it saved, and `/settings` pushes each save — so a change reaches every screen
without a reload, and the settings screen stays the only place that talks to the store.

`useDriveEnabled` and `useAutoRun` are its consumers. Nothing stored means Drive off, the same default the
backend's `settings.drive_enabled()` gives a missing `DRIVE_ENABLED`, so both ends agree on a fresh
install; it drives the pipeline's Drive stage and the definition of a complete lecture (see
[LECTURES.md](LECTURES.md)).
