# First-launch tour

A seven-step guided tour in a modal (`features/tour/`, no tour library). It never navigates, never points at live
elements and never reads the user's data: each step is a floating box over a captured screenshot, with the step's
element highlighted on the screenshot by the app.

- **Steps** (`tourSteps.ts`): two screenshots, `downloads` (steps 1-3: the sidebar Downloads item, the University /
  Extension / Manual tabs, the first recording row) and `lecture` (steps 4-7: the sidebar Lectures item, the open course's
  block in the tree, the PDF preview, the Study with AI card). A step's `id` keys its rect in `assets/tour/rects.json`;
  titles, bodies and the per-screenshot alt text are Lingui `msg` descriptors.
- **Start.** `shared/contexts/TourContext` is mounted in `Layout` and starts the tour on mount only while the seen
  flag is unset, so it shows right after the first-run wall. Settings → "Replay tutorial" calls `start()` and ignores the flag.
- **Seen flag.** `localStorage['fast-study:tour-dismissed'] = '1'` (`tourFlag.ts`), written by the context's `stop()`,
  which every ending goes through: Done, Skip, the close button, Esc. The key name is fixed: the app harness presets it
  in every browser (`HB_TOUR=1` leaves it unset). Reads and writes are wrapped; a failed read counts as unseen.
- **Controls.** The box holds the title, body, Back and Next (Done on the last step). Back is absent on step 1. The footer holds seven clickable
  dots and Skip (absent on the last step, replaced by an invisible twin so the dialog keeps its height); close sits on the dialog corner. Left/Right arrows move between steps,
  mirrored in RTL (`tourMachine.arrowDelta`). The track holds one slide per screenshot and slides along the reading
  direction only when the step crosses screenshots (3 to 4), so RTL slides the other way and the dots list right to left, in the same 480ms (`--tour-glide`) as the highlight and box. Focus on Next uses `preventScroll`: an overflow-hidden viewport still scrolls to a focused child, which jumped the forward slide.
- **Tokens.** Scrim, dim, ring, box width and arrow size are `--tour-*` in `styles/tokens.css`. Untokenised: the highlight's 5px padding (`Tour.tsx`, mirrored by `REACH` in the capture script), placement's gap and margin, the 900px dialog and 20px radius.
- **Highlight.** `.tour-highlight` sits over the frame at the step's rect: an accent ring plus a light dim over the rest.
  Both slides draw their nearest step's highlight (`stepOnShot`), so a slide leaving the view keeps its ring. Within one
  screenshot the highlight and box glide between steps.
- **The box.** `.tour-callout` (`TourCallout.tsx`; `.tour-callout-title`, `-body`, `-actions`; `data-side` names the side of
  the element it sits on, `.tour-callout--docked` when none fits). `tourPlacement.placeCallout` picks the first side with
  room (right, left, below, above), clamps into the frame (a step with `alignTop` sits level with its element's top, so a tall element's box clears the page title beside it), keeps a gap so the box never covers the element, and aims
  the arrow at the element's middle. When no side fits (a very narrow window) the box docks under the screenshot with no
  arrow. The frame is `direction: ltr` because rects are the screenshot's own physical coordinates; the box sets `dir`
  from the UI language. Only the active slide renders a box, so there is one `.tour-next`.
- **Dialog.** `role="dialog"`, `aria-modal`, labelled by the active step's title (`tour-title-<step id>`); the inactive
  slide is `inert` and `aria-hidden`. Tab wraps inside it, focus moves to Next on each step and returns to the prior
  element when the tour ends (`tourFocus.ts`). Screenshots carry alt text. Motion honours `prefers-reduced-motion`.
- **Screenshots and rects.** `src/assets/tour/{he,en}/<shot>.jpg`, clean (no baked ring), picked by UI language through
  `import.meta.glob`; a missing one hides the image. `src/assets/tour/rects.json` holds `{lang: {stepId: {x,y,w,h}}}` as
  fractions of the viewport, measured per language because Hebrew mirrors the layout. The app has no dark theme.
- **Recapturing.** Manual, no CI. Against your own harness stack:
  `node .claude/harness/setup.mjs --harness DIR` then `node frontend/scripts/capture-tour.mjs --harness DIR`. It wipes
  that stack, seeds the showcase dataset (`.claude/harness/showcase/`), writes 1440x900 JPEGs at 1.5x and measures each
  step's element by selector (`STEPS` in the script, several matches unioned; `within` pulls the rect in so the drawn ring, 8px outside it, stays inside that pane; a renamed class breaks the capture, not the
  app). A new or changed step needs an entry there, and `tourSteps.test.ts` fails until `rects.json` has it.
  The width is fixed by the lecture page, which lays out in two columns only once its main column is 640px wide (window
  about 1270px); 1440 shows it comfortably, and the frame (`aspect-ratio` in `Tour.css`) matches the 1440:900 shot.
