# First-run guided tour

An in-house spotlight tour (`features/tour/`, built on `@floating-ui/react`, no tour library) over the real UI.

- **Disabled.** `TOUR_ENABLED` in `features/tour/tourEnabled.ts` is `false`: no auto-start, no Settings replay button. Set it to `true` to restore both.
- **Start.** `shared/contexts/TourContext` is mounted in `Layout`, so the tour starts on every launch that reaches
  the app (right after the first-run wall included) unless dismissed. Settings → "Replay tutorial" starts it regardless.
- **Dismissal.** `localStorage['fast-study:tour-dismissed'] = '1'`, written only when "Don't show again" (unchecked
  by default) is ticked as the tour ends by Done, Skip or Esc. Every read and write is wrapped; a failed read shows the tour.
  It touches no service or settings store.
- **Steps** (`tourSteps.ts`, with the `data-tour` anchor each spotlights): `sidebar` (`sidebar`), `downloads`
  (`downloads-tabs`, `/downloads`), `runner` (`runner-run`, `/running`), `lecture` (`lecture-pdf`, first lecture whose page shows the PDF
  preview: `showsPdfHero`, so with Drive on it must also be uploaded), `editor` (`summary-editor`, first lecture with a summary.md, `/edit`), `search` (`search-field`,
  `/search`), `drive` (`settings-drive`, `/settings`). The tour navigates as it advances.
- **Anchor convention.** `data-tour="<anchor>"` on the real element, unique per page. Step text lives in `tourSteps.ts`
  as Lingui `msg` descriptors.
- **Live vs card.** `useAnchor` watches the anchor for the whole step; `tourMode` spotlights it while present, and it falls back to the card if it leaves the DOM (e.g. a run ends); one still missing after 2.5 s (a new user has no run, lecture or
  editor) shows a centered card with the screenshot `assets/tour/{he,en}/<id>.jpg` matching the UI language.
  Only `runner`, `lecture` and `editor` have shots.
- **Focus.** Tab wraps inside the popover/card, focus moves to Next on each step and returns to the prior element when the tour ends, only if it is still on the page (`tourFocus.ts`, hand-rolled: the dialog switches between two elements, which `FloatingFocusManager` would fight).
- **Recapturing the shots.** Manual, no CI. Against your own harness stack:
  `node .claude/harness/setup.mjs --harness DIR` then `node frontend/scripts/capture-tour.mjs --harness DIR`. It wipes
  that stack, seeds `site/capture/dataset.mjs`, holds one run mid-transcription, and writes 1008x630 JPEGs
  (a ring marks the step's element). A new card step needs an entry in the script's `RING` map.
