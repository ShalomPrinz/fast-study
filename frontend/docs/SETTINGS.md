# Settings

Every user-facing setting the app has, and the one route that edits them. The module behind it is
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
