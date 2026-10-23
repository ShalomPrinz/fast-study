import type { Lecture } from '@/types'

export interface TrackProgress<T> {
  // The first item not marked done, in the order given; null once all are done or there are none.
  current: T | null
  done: number
  total: number
}

// One track's study state (a course's lectures, or its recitations), read in the order shown in the
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
