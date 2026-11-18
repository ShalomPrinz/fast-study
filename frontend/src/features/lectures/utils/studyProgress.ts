import type { Lecture } from '@/types'

export interface TrackProgress<T> {
  // The first item not marked done, in the order given; null once all are done or there are none.
  current: T | null
  done: number
  total: number
}

// One track's study state (a course's lectures, recitations or assignments), read in the order shown in the
// tree, so "current" is strict: an earlier item left undone stays current whatever comes after it.
export function trackProgress<T extends Pick<Lecture, 'name' | 'done'>>(
  items: T[],
): TrackProgress<T> {
  return {
    current: items.find((l) => !l.done) ?? null,
    done: items.filter((l) => l.done).length,
    total: items.length,
  }
}

export type TimelineSegment = 'none' | 'done' | 'todo'

// The timeline line's two halves through row `index` of `count`: the half toward the previous row and
// the half toward the next. A half is `done` (green) when it lies at or before the current row.
export function timelineSegments(
  index: number,
  count: number,
  currentIndex: number,
): { top: TimelineSegment; bottom: TimelineSegment } {
  return {
    top: index === 0 ? 'none' : index <= currentIndex ? 'done' : 'todo',
    bottom: index >= count - 1 ? 'none' : index < currentIndex ? 'done' : 'todo',
  }
}

// The timeline's current row: the first not-done item, else the last (the line runs green to the end).
export function timelineCurrentIndex(items: Pick<Lecture, 'done'>[]): number {
  const i = items.findIndex((l) => !l.done)
  return i === -1 ? items.length - 1 : i
}

// Class names that paint row `index`'s line halves; see `.tl` in sidebar-tree.css.
export function timelineClass(index: number, count: number, currentIndex: number): string {
  const { top, bottom } = timelineSegments(index, count, currentIndex)
  return `tl tl-top-${top} tl-bottom-${bottom}`
}
