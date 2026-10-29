export interface TourState {
  active: boolean
  index: number
}

export type TourAction = { type: 'start' } | { type: 'next' } | { type: 'back' } | { type: 'skip' }

// Next past the last step finishes, and so does Skip; Back stops at the first.
export function tourReducer(state: TourState, action: TourAction, total: number): TourState {
  switch (action.type) {
    case 'start':
      return { active: true, index: 0 }
    case 'next':
      if (!state.active) return state
      return state.index + 1 >= total
        ? { active: false, index: 0 }
        : { ...state, index: state.index + 1 }
    case 'back':
      return state.active ? { ...state, index: Math.max(0, state.index - 1) } : state
    case 'skip':
      return { active: false, index: 0 }
  }
}

export type TourMode = 'pending' | 'spotlight' | 'card'

// A found anchor is spotlit; one still absent after the page settled falls back to the screenshot card.
export function tourMode(found: boolean, settled: boolean): TourMode {
  if (found) return 'spotlight'
  return settled ? 'card' : 'pending'
}

export interface Found<E> {
  el: E | null
  settled: boolean
}

// The anchor looked up again after a DOM change: finding it settles the step for good, so a later loss shows the card at once.
export function foundAfterLookup<E>(prev: Found<E>, el: E | null): Found<E> {
  if (prev.el === el) return prev
  return { el, settled: prev.settled || el !== null }
}
