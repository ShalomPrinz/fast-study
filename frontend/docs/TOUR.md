# First-launch tour

A three-slide carousel modal (`features/tour/`, no tour library). It never navigates, never points at live
elements and never reads the user's data: each slide is a captured screenshot, a title and one line.

- **Slides** (`tourSteps.ts`): `downloads` (the Downloads screen), `runner` (a lecture mid-run), `lecture` (a
  finished lecture's PDF summary). Titles, bodies and alt text are Lingui `msg` descriptors.
- **Start.** `shared/contexts/TourContext` is mounted in `Layout` and starts the tour on mount only while the seen
  flag is unset, so it shows right after the first-run wall. Settings → "Replay tutorial" calls `start()` and ignores the flag.
- **Seen flag.** `localStorage['fast-study:tour-dismissed'] = '1'` (`tourFlag.ts`), written by the context's `stop()`,
  which every ending goes through: Done, Skip, the close button, Esc. The key name is fixed: the app harness presets it
  in every browser. Reads and writes are wrapped; a failed read counts as unseen.
- **Controls.** Next (Done on the last slide), Back, Skip (hidden on the last slide), close, clickable dots. Left/Right
  arrows move between slides, mirrored in RTL (`tourMachine.arrowDelta`). The track slides along the reading direction,
  so RTL slides the other way and the dots list right to left.
- **Dialog.** `role="dialog"`, `aria-modal`, labelled by the active slide's title; inactive slides are `inert` and
  `aria-hidden`. Tab wraps inside it, focus moves to Next on each slide and returns to the prior element when the tour
  ends (`tourFocus.ts`). Screenshots carry alt text describing the screen. Motion honours `prefers-reduced-motion`.
- **Screenshots.** `src/assets/tour/{he,en}/<id>.jpg`, picked by UI language through `import.meta.glob`; a missing one
  hides the image. The app has no dark theme, so there is one light set.
- **Recapturing.** Manual, no CI. Against your own harness stack:
  `node .claude/harness/setup.mjs --harness DIR` then `node frontend/scripts/capture-tour.mjs --harness DIR`. It wipes
  that stack, seeds the showcase dataset (`.claude/harness/showcase/`), holds one run mid-transcription and writes
  1008x630 JPEGs with a ring on the slide's element (`RING` in the script; it selects by class, so a renamed class
  breaks the capture, not the app).
