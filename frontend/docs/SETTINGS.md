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
| Summary model (row 1) | the first curated entry                | row 1 of the ordered list | `backend/`    |
| Summary models (fallback rows 2+) | every other curated model, wrapping, when never saved | any order, any subset, one minimum | `backend/` |
| Summary figures   | off (a checkbox beside the model)         | on                    | `backend/`        |
| Auto retry        | on, 3 retries, 10 minutes apart           | off; 1-10 retries, 1-120 minutes | `backend/`, `electron/` store |
| Auto-run          | the whole pipeline                        | audio only, off       | `backend/`        |
| Auto-remove       | off                                       | video, video + audio  | `backend/`        |
| Auto-remove after | none — the user must choose               | the PDF, the Drive upload | `backend/`    |
| Error reports     | off until answered; the wall starts it on | on                    | `electron/`, live    |
| AI chat provider  | Claude                                    | ChatGPT, Gemini       | `electron/`, renderer-only |
| Course structure  | lectures and recitations (`split`)        | lectures only: every course, chosen courses | `database/`, live |

The model list comes from `GET /config/options` as `{id, name}` (the wall's dropdown and the Settings list show the name, stores the id; `modelDisplayName`, filled by every options fetch incl. `InitGate`'s at boot, swaps ids for names in `serviceErrors.ts` error params and `model_fallback` notices, an unmapped id staying raw), so a model the free tier does not serve can never be
typed in and fail minutes later mid-pipeline.

**Summary models** (`SummaryModelsField`, order rules in `utils/geminiOrder.ts`) is one ordered list: row 1 is `geminiModel`,
rows 2+ are `geminiFallbackModels` (`[]` = never switch, `null` = never saved). ▲/▼ reorder: the two rows slide into each other's place together (FLIP, 200ms, the clicked row on top; clicks mid-slide are ignored, reduced motion swaps instantly), the top row has no ▲ and the bottom no ▼ (slot kept empty, `visibility: hidden`), focus stays on the moved row's arrow (the other one when it is gone),
✕ removes (disabled on the last row, its `Tooltip` says why); each fallback row's place name carries a small badge with the previous row's number, the dashed rows under "Not used" add at the end. Never saved,
`effectiveFallback` derives the rows as the backend does (auto-fallback unset/on: every other model after the main, wrapping; off: none),
and the first save writes the list explicitly; a change sends both fields whenever either differs from that effective value, so
`buildPatch` takes the options. The wall asks for no model and keeps a `null` list, so it sends only the model. `geminiAutoFallback`
is read only for the derivation and never written. Selectors: `#summary-models`, `.summary-model-row[data-model-id]` with
`.summary-model-up/-down/-remove`, `.summary-model-add[data-model-id]`.

**Auto retry** (`AutoRetryField`, rules in `utils/autoRetry.ts`) is its own section: a switch plus "Number of
retries" and "Minutes between retries", disabled while off. Unset reads as the defaults; the switch saves at once, the two
boxes share one row and wait for the section's Approve (`ApproveRow` id `retry`, Enter approves). A box holds a whole number
clamped to the range (`parseRetryInt`); empty or fractional text makes it NaN, so Approve stays disabled and a patch never
carries an out-of-range value (the launcher store would refuse it with `setting_out_of_range`). The three fields go to the
backend's `POST /config`, which clamps them; turning the switch off drops every waiting retry there. The countdown
UI is in [LECTURES.md](LECTURES.md) §Runner status.

**Summary figures** (`summaryFigures`, unset reads as off) makes `summarize` crop the graphs out of a lecture's slide PDFs/PPTXs into the summary. It sits beside the summary model, is owned by the backend (`/config`) and, like it, is hidden where the model is.

**Auto-run is a ceiling on unattended work, not a schedule.** It caps a dropped or downloaded video; it
never caps a run the user starts. An unset value reads as the backend's own fallback (`useAutoRun`), so
both ends agree on a fresh install.

**Auto-remove deletes a finished lecture's video (and audio) from disk**, and saves differently from
the rest of the page. Its section (`AutoRemoveField`, rules in `utils/autoRemove.ts`) has its own Apply,
enabled once it differs from the store and both values are chosen; checking the box always starts from
video and no timing, and "after Drive" is disabled while the form's Drive toggle is off. A stored "after
Drive" rule may stay saved beside Drive turned off, by design: it removes nothing until the rule changes
or Drive is back on. No other change on the page saves the section, and a half-chosen one holds Apply. A save that **widens** the
rule (`autoRemoveWidens`: off to on, video to video + audio, Drive to PDF) first confirms that the files
of every existing lecture go for good; Yes saves, pushes `/config`, then awaits the backend's `POST
/auto-remove/apply` and toasts its counts (`AutoRemoveSummary`); No saves nothing. Narrowing or unchecking (stored `off`) saves with no confirm and no sweep. Apply's action is
`autoRemoveApply`: with the section matching a stored rule that is on, it re-runs the sweep with no
confirm, the retry the locked and failed toasts point to; "after Drive" while the form's Drive toggle
differs from the store disables it with a hint, since the Drive toggle must be stored before sweeping (it can wait on an unapproved Drive folder); an incomplete edit shows a hint from `autoRemoveBlock` (no timing yet, or "after Drive" with Drive off, the latter worded per "What to remove"); nothing to apply (`unchanged`) also shows a hint, a busy page with a complete edit (`null`) none. How removed files
read on a lecture is in [LECTURES.md](LECTURES.md).

**Error reports apply live, and unset means off** — nothing is sent before an explicit yes. The launcher
owns the switch and pushes each saved value to every service itself, so the frontend posts it to no
`/config`; `saveSettings` only re-gates the renderer's own reports (`applyErrorReports`). A service the push
misses takes it at the next launch: the write answers `errorReportsRestartNeeded`, and `/settings` then
says so under the switch (`restartNotice`). The switch is Electron-only (`canSetErrorReports`): browser
dev's `.env` store has no such field and reports nothing anyway, so both screens hide it and
`buildPatch` never sends it there.

**The privacy policy** opens from a link under the switch (`PrivacyPolicyModal`); Confirm unlocks only
once its text is scrolled to the end (`readToEnd`), Confirm turns the switch on and Decline off, and both
set the launcher-only `privacyConfirmed`, shown as the box's mark. Esc or a click outside answers nothing.
On `/settings` an answer saves at once. The wall stores `errorReports` explicitly
on every save, and while the policy is unanswered its Start opens the modal instead, whose answer saves
and starts in one go (`wallMustAskPrivacy`); closing it saves nothing.

**The Gemini model offer** (`HydrogenPrompt`, mounted in `Layout` so it never meets the wall) asks once whether to switch
a stored non-`gemini-4-hydrogen` model; Yes saves hydrogen on top, the rest of the effective order after it (`geminiFallbackModels`), and the launcher-only `hydrogenPrompted` together; No, Esc
or a click outside (the backdrop calls `onCancel`) all count as No and save only the flag. The init wall's save sets
the flag too (`wallPatch`), so a new install never sees the offer. An unset model or an answered flag shows nothing, and browser dev reads the flag as answered.

**The AI chat provider** is the chat "Study with AI" opens ([LECTURES.md](LECTURES.md)), read through
`useAiProvider`, where unset or unknown is Claude. It is renderer-only: no service reads it, so a save writes
it to the store alone, the launcher's in the packaged app and the database's `.env` in browser dev.

**Course structure** applies live through the database's `/config`, which re-resolves every course's
`lectures_only` and notifies. Everything but this field reads only that per-course flag
([LECTURES.md](LECTURES.md)). Under "chosen courses" (`CourseStructureField`) a checklist of the
courses writes each pick at once (`PATCH /courses/{course}/lectures_only`), and the box
reads the tree's flag — which is the pick only while that mode is live, so until the mode's save lands the field
says the courses appear once it is saved (`checklistState`). A new course starts unchecked.

## What is not a setting

The list is closed on purpose; each of these looks like a field and deliberately isn't one.

| Not a setting                                             | Why                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Whisper model, `he` transcript language                   | The corpus is Hebrew lectures; no user has a reason to change either                        |
| The summary length budget                                 | A prompt-shaped tuning knob, not a preference                                               |
| Service ports, `BACKEND_URL` / `DATABASE_URL`             | Wiring: the frontend takes its URLs from the runtime bridge                                 |
| `FRONTEND_URL`                                            | Dev-only CORS wiring the packaged app never uses                                            |
| The last opened lecture, the search view's course         | Per-view memory in `localStorage`; nothing else has to agree on it                          |
| The Google Drive account                                  | A consent flow and a token, connected or not — see below                                    |
| Running unfinished lectures at app start                  | A sweep is a deliberate act; `/running`'s button covers it      |

## The store — `services/settings.ts`

`Settings` is the read view, `null` for anything unstored — the client owns every default.
`SettingsPatch` is partial; omitted fields are left alone. **The API keys are write-only**: the patch
carries them, the read view only reports `…ApiKeySet`, so a stored key never reaches the renderer.

`pickBacking()` is the one place the store's backing is chosen: the preload bridge's
`window.faststudy.settings` packaged, the database service's `/settings` in browser dev. Same interface,
no adapter, and both stay permanent so browser-only dev remains a first-class loop.
A save in one window never reaches an already-open one (`SettingsContext` holds the boot read and its own
save; the database broadcasts nothing): in browser dev a second tab sees it after a reload. Packaged has one window and one writer.

`saveSettings` is **two phases, in order**: the store first (it is what a fresh boot reads), then each
changed field to its owner's `POST /config` — backend, database, or the auto-downloader for the university
(`ownerBodies`). Nothing restarts. The UI language has no owner: it lives only
in `localStorage` ([I18N.md](I18N.md)).

## `/settings`

Loads the store (database) and the options (backend) apart, so either can be down alone. With the backend
down the form renders from the store and the API keys and model show as unavailable; with the store down the
page says so and offers Retry. Whichever half is missing is fetched again on every notify — the backend
notifies at boot and the stream's reconnect dispatches — so a returning service fills in without a reload;
the options only resolve the model (`withOptions`), never resetting an edit. It edits a local form and has no Save button (below).
The form is read from the store (`formFromStore`) on load; a stored model the options no longer list reads as the first.
**Saving.** There is no Save button. A change saves at once on its own: checkboxes, dropdowns, the summary-model list,
the auto-retry switch, error reports and the privacy answer, the Drive toggle, a preset university. `autoPatch`
(`utils/autosave.ts`) is `buildPatch` minus the held entries, so a patch holds only what changed. Typed or sensitive
entries save through their own **Approve** (`ApproveRow`, hidden until the entry has an unsaved edit; Enter in its text box
approves too): each API key, the data folder, the Drive folder, the two auto-retry numbers and a pasted university address. `approvePatch`
stays empty while the entry is blank or invalid, so that field alone waits (Approve disabled, its hint shown; a blank data folder shows the red `Required` chip) while every
other change still saves: Drive turned on with no stored folder waits, and approving the folder stores both together.
Approving the data folder while runs are in flight opens the split-runs `ConfirmModal` (`runsAtRisk`); Cancel leaves the
edit unsaved. Auto-remove keeps its own Apply and confirm.
Saves run on `useSiteSave`'s one chain, in the order the changes were made; an auto save builds its patch when it runs (latest form against the store as it stands then), so a toggle undone before the first save lands is still sent. A landed save writes only the store
(`storedRef`), never the form, except `mergeApproved`, which takes the store's answer into an approved entry alone (a key
clears, the folder takes its normalized spelling) and only while its text is unchanged since; so overlapping saves can
never revert a newer edit. A failed save leaves its field unsaved and the next change retries it.
A saved section shows a brief "Saved" beside its title (`SavedMark`; no success toast); a failure toasts.
**Every save answers**, failure included — a connection error's own toast is deduped and reads as noise.
A failure after the store write leaves the service behind until a retry, so the toast asks for one.

**Layout and search.** Sections sit in two fixed columns (`.settings-column` inside `.settings-page`, wider than the
shared 880px measure): left is API keys, Storage, Google Drive; right is Downloading recordings, Courses, Automatic retry,
Appearance and behaviour, Disk space, Error reports. Each column stacks independently, so a section never changes column when
another grows; below two 440px columns the grid collapses to one, left above right. DOM order is left then right, so match order
reads column 1 then column 2. A search bar pinned between the header and the
scrolling body (`SettingsSearchBar`, `useSettingsSearch`, matcher in `utils/settingsSearch.ts`) highlights every
case-insensitive match of the text rendered in the columns: titles, labels, hints, notes, buttons and every dropdown's option
text, never input values, placeholders or modals. It is highlight only, nothing hides. Text is painted with the CSS Custom
Highlight API (no `<mark>`, React's DOM untouched); a dropdown with a matching option counts once (its trigger's `data-options`) and the whole trigger is
outlined. The first match scrolls to centre per keystroke; a match inside a closed `<details>` (the key guide, a
screenshot) opens it first, like the browser's find, and it stays open. A `MutationObserver` (childList/characterData,
not attributes, so opening never re-scans) re-scans while a query stands. Enter or
the down arrow steps next, Shift+Enter or the up arrow previous, wrapping; Ctrl/Cmd+F focuses the box only while the page is mounted;
Escape clears a query, or blurs an empty box.

A saved key shows an "a key is saved" placeholder; a blank key field is never sent, since empty would
clear the stored key. The language applies the moment it is picked and reaches no save.

**The data folder is guarded**:
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
keeps its default. The data folder is **prefilled and taken as is** — the stored one, else the bridge's `defaultDataRoot`,
else empty, which in browser dev reads red — but
probed as it is typed (`probeDataRoot`, the database's read-only `POST /settings/data-root/probe`, debounced
and latest-wins; 200 usable, 422 with a coded reason unusable, any other status unknown): an unusable verdict renders its coded reason under the field and blocks the wall, while an
unreachable probe is unknown and blocks nothing, since the save validates again. Packaged, the field is read-only and
a click, Enter/Space or its folder button opens the bridge's native `pickFolder` dialog (one at a time;
cancel keeps the value), so a non-technical user never types a path; browser dev keeps the typed input. In
browser dev an already-filled `.env` passes the wall instantly; blank the values to exercise it.

Each section heading but the language's carries a mark at its inline end, derived from `missingEntries`
(`sectionMark`): the keys and the data folder read red `Required` until complete, then green `Done`; the
university, Drive, downloading and error reports read gray `Optional`.

Each provider's key field, here and on `/settings`, carries a short how-to-get-a-key guide keyed by provider id,
open while no key is saved and collapsed behind its title once one is (`storedKeyExists`); its first step is the console link itself. A step may have a collapsed screenshot,
`src/assets/key-steps/{provider}-{step}.png` (step numbers 1-based), imported
through Vite and listed in `SHOTS`, so replacing a file is the whole update; a real key in one must be
blurred out before it is committed. A save failure shows in place — a rejected data folder is the one thing in the way.

## When the computer can't store a key

The packaged app keeps the keys encrypted by the OS keystore; a machine with none (Linux without a
keyring) cannot store them. `runtime.ts` resolves the launcher's report once as `canStoreApiKeys`;
no bridge means browser dev, where keys go to `.env`, so a missing answer means a machine that is fine.

Degraded, not fatal: a field that can never be filled invites a user to try, so the wall drops the whole
keys section, and `/settings` drops the key fields and the summary models list with the figures checkbox, leaving `SecureStorageNotice`
under the section heading. The keys stop counting in `missingEntries` and `isInitialized` (which take the flag as an argument,
staying pure), or the wall would have no way past. A save stays safe: a blank key is never sent, and an
unrendered list still holds the stored or default order.

## Key validation — `components/ApiKeyField.tsx`

Probes through `probeKey` on blur and paste, only when the value changed and is non-empty
(`utils/keyStatus.ts`). An edit resets the probe memory — the sequence number, so an old probe cannot land
on new text, and the last-probed value, so retyping a rejected key asks again.

`probeKey` answers `valid`, `rejected` or `unverified`, and every failure short of a verdict is
`unverified`, since an unreachable provider must never call a good key bad. **Approving is always permitted.**
The key-prefix mismatch is an instant offline warning in the same slot, overwritten by any probe result;
prefixes are convention, not contract, so it never blocks.

## The university — `components/MoodleSiteField.tsx`

A `Select` of presets (`utils/moodleSites.ts`, frontend-only) plus "Other…", under a greyed "Choose your university…" row, which reveals a URL input
and a plain-words hint on copying the address from the browser.
Picking a preset or blurring the input calls `probeMoodleSite` (`POST /site/probe` on the auto-downloader),
with `ApiKeyField`'s sequence-number and last-probed-value discipline (`utils/siteStatus.ts`). The status
slot reads `supported` (the canonical site), `unsupported` (the `moodle_site_unsupported` sentence for its
`reason`) or `unverified` ("couldn't check", or "solve the captcha in the window that opened" when the probe's
`challengeWindow` is `'captcha'`) or `invalid` (text that is no web address: danger tone, saves
nothing; a scheme typo like `http:/x` is invalid too). Nobody pressed a button, so the probe runs through
the Moodle lock's `wait` mode ([DOWNLOADS.md](DOWNLOADS.md#the-moodle-lock)) and reads "Checking…" until
the lock frees;
`probeMoodleSite` rethrows a 429 `moodle_busy` rather than calling it `unverified`.

**The save rule is the opposite of a key's.** A key the provider rejects might still be right; a site that
definitively isn't a usable Moodle can never work. So `unsupported` saves nothing — the field hands the form
`null`, which `buildPatch` never sends, so the stored site stays. A probe in flight holds the choice on both screens
(`onChecking`), so it can't outrun the answer and drop it; a blank site never blocks. `unverified` saves, since a
bot wall or a dropped connection says nothing about the site; the post-login check in the auto-downloader
is the backstop. What is saved is always the probe's canonical root, never the typed text.

**No university is a choice too.** The "Choose your university…" entry, or "Other…" with no address
(`choosesNoSite`), hands the form `''`, which `buildPatch` sends and every store and auto's `/config`
read as cleared. The wall saves either at once; `/settings` saves only the "Choose…" entry at once
(`onNoSite`), since a blank "Other…" there is usually a switch half typed, and stores nothing for it.

**Both screens save a confirmed site at once**: a `supported` answer, or no university, writes `moodle_site` alone
through `saveSettings` (store, then auto's `/config`), chained so a quicker second pick never lands first,
which makes Connect live at once. The rest of the form keeps its unsaved edits (`withSavedSite`).
`unverified` waits: the wall for its Start, `/settings` for the University section's Approve. `/settings` does it in
`hooks/useSiteSave.ts`, whose chain every save of the page joins, so saves land in the order made.

**Switching sites keeps the account.** The auto-downloader holds one session and keeps it across a switch:
the chip reads not connected on any other site and connected again once its own site is picked back, with
no confirm and no reconnect. Only Connect on another site (or Disconnect) replaces it, and that Connect first confirms, naming the
university it logs out of ([DOWNLOADS.md](DOWNLOADS.md) §Auth). The chip follows
auto's `/auth/events`, and either save re-probes it.

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
  actually blocks; the login finishes by itself with no button (the chip follows the pushed state); its unverified state, panel and retry button (bot challenge after login) show here too, the control row wrapping for it. The hint names the saved site's host. It belongs to the saved site only (`accountView`), so with none
  saved it asks for a university, and with another one chosen but unsaved it shows a "save first" hint, instead
  of a Connect that would sign in to the wrong site; the chip is keyed on the site, so a new one re-probes. It is what makes a settings screen call `/auth/status`; the wall shows it
  under the university picker and, outside `Layout`, brings its own `AuthStatusProvider`. A down auto-downloader shows one toast, deduped with the
  browser check's.
- **Google account** (`DriveConnection`, over `services/drive.ts`) — rendered only while Drive is on.
  States `unknown` / `disconnected` / `pending` / `connected`. `POST /config/drive/connect` opens the
  browser on the backend's side and answers the URL, so **Connect** opens nothing itself; the pending
  state's reopen link connects again (same URL, no rival flow) and hands it to `openExternalUrl`. A landed
  token, a failed flow and a disconnect each notify, so the chip follows SSE; only `pending` is recorded
  by its caller. Failures fill the status slot, since the wall renders outside the toast container. A
  lecture with no token still finishes as a local PDF.

**Bundled tools** have no control: `app/toolWarnings.ts`, run once per page load from `Layout` (so never over
the wall), reads `GET /tools` on the backend and both downloader services concurrently and toasts one
auto-closing warning per broken tool, merged by name so a yt-dlp both downloaders report warns once; a service
that does not answer is skipped, its client having toasted the connection already.

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

**Model fallback notices.** A Gemini 503 that moves on to the next summary model raises a `model_fallback` notice in the
`notices` of `GET /status` and the overview status. `shared/utils/notices.ts` info-toasts each id once (ids are unique across both
endpoints) and records, without toasting, whatever a source already holds on its first load after page load. The sentence lives in `serviceErrors.ts`.
