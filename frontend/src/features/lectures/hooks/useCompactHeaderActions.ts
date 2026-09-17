import { useSyncExternalStore } from 'react'

// Window width, not the content pane's: the sidebar and tree pane are fixed at 268px each, so the
// pane is always the window less 536. At 960 that leaves the header 344px of content against the
// 324px the widest three-button row measures (English; Hebrew wants 319) — the last round window
// where the row still fits, and clear of the 1008px viewport a 1366×768 laptop reports.
const COMPACT_QUERY = '(max-width: 959px)'

const media = window.matchMedia(COMPACT_QUERY)

function subscribe(onChange: () => void) {
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

// Whether the lecture header's secondary actions belong in the ⋮ menu rather than on a row of their
// own. Only one of the two shapes is ever rendered, so an action's `data-testid` stays unique.
export function useCompactHeaderActions() {
  return useSyncExternalStore(subscribe, () => media.matches)
}
