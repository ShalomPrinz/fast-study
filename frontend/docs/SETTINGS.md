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
| Auto-run on boot  | on                                        | on, off              | frontend    |
| Runner controls   | hidden                                    | shown, hidden        | frontend    |

The model list comes from `GET /config/options`, so a model id that the free tier does not serve can
never be typed in — a wrong one surfaces minutes later as a pipeline failure.

## `/settings`

`features/settings/SettingsView.tsx`, reachable from the sidebar's fifth nav row. It loads the store
and the backend's options once, edits a local form, and saves the changed fields in one
`saveSettings` call. Saving also writes the two UI preferences to `localStorage`.

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

## The two UI preferences — `shared/utils/uiPreferences.ts`

Auto-run on boot and runner-control visibility are the user's own preferences, so they live in
`localStorage`; their first-boot default comes from the settings store, so a fresh browser profile
and a packaged install agree without a rebuild. `resolvePreference` is the whole rule: a stored
choice wins, then the store's value, then the shipped default — auto-run **on**, runner controls
**hidden**. `usePreference` re-renders on every write, so toggling one here reaches the sidebar
without a reload.
