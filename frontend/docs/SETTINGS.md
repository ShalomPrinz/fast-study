# Settings

Every user-facing setting, the first-run wall that collects the required ones, the `/settings` route that
edits them all, and the prerequisites and accounts both screens show.

## The entries

| Setting           | Default                                   | Alternatives          | Owner             |
| ----------------- | ----------------------------------------- | --------------------- | ----------------- |
| Gemini API key    | none                                      | user-supplied         | `backend/`        |
| Groq API key      | none                                      | user-supplied         | `backend/`        |
| Data folder       | prefilled, probed on first run            | any directory         | `database/`       |
| University        | none — optional, nothing preselected      | a preset, or any URL  | `downloader/auto` |
| UI language       | OS locale — Hebrew unless it says English | Hebrew, English       | frontend          |
| Drive upload      | off                                       | on                    | `backend/`        |
| Drive root folder | `FastStudy`, sent only once Drive is on  | any folder name       | `backend/`        |
| Summary model     | the first curated entry                   | the curated dropdown  | `backend/`        |
| Auto-run          | the whole pipeline                        | audio only, off       | `backend/`        |
| Daily run         | on                                        | off                   | `backend/`        |
| Daily run time    | 03:00                                     | any hour, 00:00-23:00 | `backend/`        |
| Error reports     | off until answered; the wall starts it on | on                    | `electron/`, live    |

The model list comes from `GET /config/options`, so a model the free tier does not serve can never be
typed in and fail minutes later mid-pipeline.

**Auto-run is a ceiling on unattended work, not a schedule.** It caps a dropped or downloaded video and
the nightly pass; it never caps a run the user starts. **The nightly pass has two gates**: its own switch
decides whether the cron runs and when, auto-run still caps what it does. Every unset value reads as the
backend's own fallback (`useAutoRun`, `useNightlyRun`, `toNightlyHour`), so both ends agree on a fresh install; the hour is
a number on the wire, never the `<select>`'s string, which the store rejects.

**Error reports apply live, and unset means off** — nothing is sent before an explicit yes. The launcher
owns the switch and pushes each saved value to every service itself, so the frontend posts it to no
`/config`; `saveSettings` only re-gates the renderer's own reports (`applyErrorReports`). A service the push
misses takes it at the next launch: the write answers `errorReportsRestartNeeded`, and `/settings` then
says so under the switch (`restartNotice`). The switch is Electron-only (`canSetErrorReports`): browser
dev's `.env` store has no such field and reports nothing anyway, so both screens hide it.

**The privacy policy** opens from a link under the switch (`PrivacyPolicyModal`); Confirm unlocks only
once its text is scrolled to the end (`readToEnd`), Confirm turns the switch on and Decline off, and both
set the launcher-only `privacyConfirmed`, shown as the box's mark. Esc or a click outside answers nothing.
On `/settings` an answer is a form edit that Save stores. The wall stores `errorReports` explicitly
on every save, and while the policy is unanswered its Start opens the modal instead, whose answer saves
and starts in one go (`wallMustAskPrivacy`); closing it saves nothing.

## What is not a setting

The list is closed on purpose; each of these looks like a field and deliberately isn't one.

| Not a setting                                             | Why                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Whisper model, `he` transcript language                   | The corpus is Hebrew lectures; no user has a reason to change either                        |
| The summary length budget                                 | A prompt-shaped tuning knob, not a preference                                               |
| Service ports, `BACKEND_URL` / `DATABASE_URL`             | Wiring: the frontend takes its URLs from the runtime bridge                                 |
| `FRONTEND_URL`, `DOWNLOADER_EXTENSION_ID`                 | Dev-only CORS and extension wiring the packaged app never uses                              |
| The last opened lecture, the search view's course         | Per-view memory in `localStorage`; nothing else has to agree on it                          |
| The Google Drive account                                  | A consent flow and a token, connected or not — see below                                    |
| Running unfinished lectures at app start                  | A sweep is a deliberate act; `/running`'s button and the nightly pass cover both cases      |

## The store — `services/settings.ts`

`Settings` is the read view, `null` for anything unstored — the client owns every default.
`SettingsPatch` is partial; omitted fields are left alone. **The API keys are write-only**: the patch
carries them, the read view only reports `…ApiKeySet`, so a stored key never reaches the renderer.

`pickBacking()` is the one place the store's backing is chosen: the preload bridge's
`window.faststudy.settings` packaged, the database service's `/settings` in browser dev. Same interface,
no adapter, and both stay permanent so browser-only dev remains a first-class loop.

`saveSettings` is **two phases, in order**: the store first (it is what a fresh boot reads), then each
changed field to its owner's `POST /config` — backend, database, or the auto-downloader for the university
(`ownerBodies`). Nothing restarts. The UI language has no owner: it lives only
in `localStorage` ([I18N.md](I18N.md)).

## `/settings`

Loads the store and options once, edits a local form, saves changed fields in one `saveSettings` call.
The form is read from the store (`formFromStore`) on load and again from each save's answer, so a later
save never reverts another writer's change; a stored model the options no longer list reads as the first.
**Every save answers**, failure included — a connection error's own toast is deduped and reads as noise.
A failure after the store write leaves the service behind until a retry, so the toast asks for one.

A saved key shows an "a key is saved" placeholder; a blank key field is never sent, since empty would
clear the stored key. The language applies the moment it is picked and reaches no save.

**The data folder and the university are guarded** (the university below). For the folder,
`utils/dataRootGuard.ts` reads the SSE-fed `RunnerStatusContext` and raises a `ConfirmModal` naming runs in flight, since a mid-run change splits a lecture across two roots.
Advisory only; the route also warns that a change re-points and never moves data. A key or a model cannot
corrupt anything, so nothing else is checked.

## The first-run wall

`app/InitGate.tsx` reads the store once at boot and shows either `features/settings/InitWall.tsx` or the
app — no sidebar, no route, no way past. `isInitialized` (`utils/required.ts`) is the whole gate: both keys
stored (where they can be, below) and a data folder. The university is asked but optional, so a user
without a Moodle account still gets in; the downloads page nudges toward it instead ([DOWNLOADS.md](DOWNLOADS.md)).
Nothing is preselected, since a wrong guess would sign a student in to someone else's Moodle. An
unreachable store shows the app anyway: a downed service is not an unconfigured install.

The wall also offers the language (so the rest reads in it) and the Drive toggle (so the account is
connected now, not mid-run); neither blocks, and Drive's folder is required only while it is on. Auto-run
and the nightly pass keep their defaults. The data folder is **prefilled and taken as is** — the stored one, else the bridge's `defaultDataRoot`,
else empty, which in browser dev reads red — but
probed as it is typed (`probeDataRoot`, the database's read-only `POST /settings/data-root/probe`, debounced
and latest-wins): an unusable verdict renders its coded reason under the field and blocks the wall, while an
unreachable probe is unknown and blocks nothing, since the save validates again. Packaged, the field is read-only and
a click, Enter/Space or its folder button opens the bridge's native `pickFolder` dialog (one at a time;
cancel keeps the value), so a non-technical user never types a path; browser dev keeps the typed input. In
browser dev an already-filled `.env` passes the wall instantly; blank the values to exercise it.

Each section heading but the language's carries a mark at its inline end, derived from `missingEntries`
(`sectionMark`): the keys and the data folder read red `Required` until complete, then green `Done`; the
university, Drive, downloading and error reports read gray `Optional`.

Each provider's key field, here and on `/settings`, carries a short how-to-get-a-key guide, always open
and keyed by provider id; its first step is the console link itself. A step may have a collapsed screenshot,
`src/assets/key-steps/{provider}-{step}.png` (step numbers 1-based), imported
through Vite and listed in `SHOTS`, so replacing a file is the whole update; a real key in one must be
blurred out before it is committed. A save failure shows in place — a rejected data folder is the one thing in the way.

## When the computer can't store a key

The packaged app keeps the keys encrypted by the OS keystore; a machine with none (Linux without a
keyring) cannot store them. `runtime.ts` resolves the launcher's report once as `canStoreApiKeys`;
no bridge means browser dev, where keys go to `.env`, so a missing answer means a machine that is fine.

Degraded, not fatal: a field that can never be filled invites a user to try, so the wall drops the whole
keys section, and `/settings` drops the key fields and the summary model, leaving `SecureStorageNotice`
under the section heading. The keys stop counting in `missingEntries` and `isInitialized` (which take the flag as an argument,
staying pure), or the wall would have no way past. A save stays safe: a blank key is never sent, and an
unrendered model select still holds the stored or default id.

## Key validation — `components/ApiKeyField.tsx`

Probes through `probeKey` on blur and paste, only when the value changed and is non-empty
(`utils/keyStatus.ts`). An edit resets the probe memory — the sequence number, so an old probe cannot land
on new text, and the last-probed value, so retyping a rejected key asks again.

`probeKey` answers `valid`, `rejected` or `unverified`, and every failure short of a verdict is
`unverified`, since an unreachable provider must never call a good key bad. **Save is always permitted.**
The key-prefix mismatch is an instant offline warning in the same slot, overwritten by any probe result;
prefixes are convention, not contract, so it never blocks.

## The university — `components/MoodleSiteField.tsx`

A `<select>` of presets (`utils/moodleSites.ts`, frontend-only) plus "Other…", which reveals a URL input.
Picking a preset or blurring the input calls `probeMoodleSite` (`POST /site/probe` on the auto-downloader),
with `ApiKeyField`'s sequence-number and last-probed-value discipline (`utils/siteStatus.ts`). The status
slot reads `supported` (the canonical site), `unsupported` (the `moodle_site_unsupported` sentence for its
`reason`) or `unverified` ("couldn't check").

**The save rule is the opposite of a key's.** A key the provider rejects might still be right; a site that
definitively isn't a usable Moodle can never work. So `unsupported` saves nothing — the field hands the form
`null`, which `buildPatch` never sends, so the stored site stays. A probe in flight holds Save on both screens
(`onChecking`), so a click can't outrun the answer and drop the choice; a blank site never blocks. `unverified` saves, since a
bot wall or a dropped connection says nothing about the site; the post-login check in the auto-downloader
is the backstop. What is saved is always the probe's canonical root, never the typed text.

**No university is a choice too.** The "Choose your university…" entry, or "Other…" with no address
(`choosesNoSite`), hands the form `''`, which `buildPatch` sends and every store and auto's `/config`
read as cleared — the wall at once, `/settings` on Save behind the same confirm as a switch.

**The wall saves a confirmed site at once**: a `supported` answer, or no university, writes `moodle_site` alone through
`saveSettings` (store, then auto's `/config`), chained so a quicker second pick never lands first, which
makes Connect live on the wall; the rest of the form saves on submit as before.

**Switching sites drops the account.** The auto-downloader resets auth on a new site, so `/settings` raises
an advisory `ConfirmModal` first while an account is connected, and re-probes the chip after the save.

## Prerequisites and accounts

Three controls share one field vocabulary (a chip or status slot, a link, one action), and **none
blocks**: they reach neither `missingEntries` nor `isInitialized`.

- **Browser** (`BrowserPrereqField`) — `fetchBrowserPrereq()`, `GET /prereqs/browser` on the
  auto-downloader, always `200` with `{ available, channel, browser, detail }`, since "no browser" is an
  answer. States `available` / `missing` / `unknown` (unreachable, **not** missing). A missing browser
  costs auto-download and Zoom capture only, and the copy says a hand-added video still becomes a summary.
  Only success is cached server-side, so **Check again** re-probes. The link is Chrome's: Edge ships with
  Windows, so only a machine missing both sees it. `detail` is English fine print, `dir="ltr"`.
  The check lives in `hooks/useBrowserPrereq.ts`, so the wall can show its section only once a check
  says missing (then keeps it, so **Check again** answers in place); `/settings` always shows it.
- **University account** (`MoodleAccountField`) — the downloads page's `AccountStatus`
  ([DOWNLOADS.md](DOWNLOADS.md)), with `--danger` retoned to neutral: red belongs on the page the session
  actually blocks. The hint names the saved site's host. It belongs to the saved site only, so with none
  saved — or another one chosen but unsaved — it shows a "save first" hint instead of a Connect that would
  sign in to the wrong site; the chip is keyed on the site, so a new one re-probes. It is what makes a settings screen call `/auth/status`; the wall shows it
  under the university picker and, outside `Layout`, brings its own `AuthStatusProvider`. A down auto-downloader shows one toast, deduped with the
  browser check's.
- **Google account** (`DriveConnection`, over `services/drive.ts`) — rendered only while Drive is on.
  States `unknown` / `disconnected` / `pending` / `connected`. `POST /config/drive/connect` opens the
  browser on the backend's side and answers the URL, so **Connect** opens nothing itself; the pending
  state's reopen link connects again (same URL, no rival flow) and hands it to `openExternalUrl`. A landed
  token, a failed flow and a disconnect each notify, so the chip follows SSE; only `pending` is recorded
  by its caller. Failures fill the status slot, since the wall renders outside the toast container. A
  lecture with no token still finishes as a local PDF.

Stable hooks: `#moodle-site` / `.moodle-site--{status}`, `#browser-prereq` / `.browser-prereq--{state}` /
`#browser-prereq-status`, `#moodle-account`,
`#drive-connection` / `.drive-connection--{state}`.

## Asking for consent mid-run — `app/DriveConsentPrompt.tsx`

A Drive step with no token fails and the backend records `consent_needed`; that flag raises one
`ConfirmModal`, and **consent never starts unconfirmed**. It mounts in `Layout` because the run wanting the
token is not the screen the user is on; the wall is out of its reach, with nothing processed yet.

The flag is set once by the first step that gives up, so a queue raises one modal with no frontend dedupe.
Either answer is final until the flag clears (a landed token re-arms it), or a decline would re-raise on
the next notify. Nothing asks while the Drive toggle is off. `.drive-consent-detail` marks "the ask is up".

## Settings the rest of the app reads — `shared/contexts/SettingsContext.tsx`

Holds the store's answer for other screens. It fetches nothing: `InitGate` pushes its boot read, the wall
and `/settings` push each save, so a change reaches every screen without a reload. `useDriveEnabled`
(unset means off, matching the backend) drives the Drive stage and what counts as a complete lecture
([LECTURES.md](LECTURES.md)); `useAutoRun` is the other consumer.
