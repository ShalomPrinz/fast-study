import type { Lecture } from '@/types'

export interface TrackProgress {
  // The first item not marked done, in the order given; null once all are done or there are none.
  current: string | null
  done: number
  total: number
}

// One track's study state (a course's lectures, or its recitations), read in the tree's `sortLectures`
// order, so "current" is strict: an earlier item left undone stays current whatever comes after it.
export function trackProgress(items: Pick<Lecture, 'name' | 'done'>[]): TrackProgress {
  return {
    current: items.find((l) => !l.done)?.name ?? null,
    done: items.filter((l) => l.done).length,
    total: items.length,
  }
}
