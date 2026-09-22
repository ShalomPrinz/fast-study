# Testing

## Unit tests

`npm run test` runs vitest (config in `vite.config.ts`; `test:watch` for watch mode). Tests are
`*.test.ts` colocated with the logic they cover and assert **decisions** — never markup, CSS or translated
copy. So components go untested by design; what they decide is pulled into pure functions (`utils/`,
`constants/`) that are. A UI-state bug fix — a flash, flicker, stale value or wrong count — moves the
deciding logic into such a function and tests it in the same change.

One test reads outside `frontend/`: `shared/i18n/errorCodeDrift.test.ts` walks the service sources, the
repo's `docs/ERROR-CODES.md` and `serviceErrors.ts` to hold the error-code vocabulary in step. Vitest is
the only runner here that sees the whole tree, which is why that guard lives in this suite rather than
with any one service.

A hook whose logic is its async ordering or its providers is tested with `renderHook` under a
`// @vitest-environment jsdom` docblock, providers built with `createElement` so the file stays `.ts`.
Everything else runs in `node`, where `window` does not exist — why `runtimeBridge()` guards it. The only
shared setup is `src/test-setup.ts`, which activates the English catalog.

## Verifying layout against the real page

Check layout and CSS work on the **real page**, not a hand-built harness: run `npm run dev` on a spare
port, drive it with Playwright, and fulfil the service calls from the script — `/settings` (the init wall
gates everything), `/tree`, `/auth/status`, `/list`. Stubbing poses any data shape without booting four
services or writing to `DATA_ROOT`. Measure with `getBoundingClientRect` whenever the claim is "aligned"
or "centred", and screenshot every row/card shape at more than one width.

- Use **one** `page.route("**/*")` handler that lets the dev-server origin `continue_()` and answers the
  rest by URL suffix. A narrower glob like `**/list` or `**/events*` also matches Vite's module URLs
  (`/src/services/events.ts`), and aborting one blanks the app with no console error.
- A run that reaches a **real** peer needs `npm run dev -- --port 5173 --strictPort`: the peers pin their
  CORS origins as literals (`http://localhost:5173`, `app://bundle`), and any other port fails only as a
  console CORS error under an empty UI. Never widen a peer's allowlist for the harness.
- SSE state is drivable too: fulfil `/events` with one `event: notify\ndata: {}\n\n` body as
  `text/event-stream`. The stream closes, `EventSource` reconnects, and each reconnect is another notify —
  so flipping a stub and waiting proves the UI follows the push.
- The packaged app renders at **1008x655** on the CI runner (Windows clamps the 1400x900 window to its
  1024x768 desktop — [delivery/docs/SMOKE.md](../../delivery/docs/SMOKE.md)), so a width breakpoint at or
  above ~1008px flips CI and every 1366x768 laptop narrow; hence the lecture header's ⋮ collapse at 960px.
- Two dev-only artefacts are not bugs: StrictMode double-invokes mount effects (two requests per mount
  probe), and `.init-wall` scrolls itself, so screenshot the element rather than `full_page`.

## Stable selectors

The user checks frontend work by querying the live DOM over CDP in the real Electron app, so a new UI
state — a notice, a disabled control, an empty state — needs a stable selector, named in the report of the
change. Prefer an existing `id` (`#key-gemini`); otherwise add a modifier class
(`.settings-note--no-key-storage`). `data-testid` is reserved for the smoke suite's contract
([ARCHITECTURE.md](ARCHITECTURE.md) §Smoke-suite test ids).
