import { describe, expect, it } from 'vitest'
import type { Course, FileInfo, Lecture } from '@/types'
import { headingsKey } from './refetchInputs'

const file = (mtime: number | null, exists = true): FileInfo => ({ exists, size: 1, mtime })
function lec(name: string, md: number | null, pdf: number | null): Lecture {
  return {
    name,
    files: {
      'summary.md': md === null ? file(null, false) : file(md),
      'summary.pdf': pdf === null ? file(null, false) : file(pdf),
    },
  } as unknown as Lecture
}
const course = (lectures: Lecture[], recitations: Lecture[] = []) =>
  ({ name: 'C', lectures, recitations }) as unknown as Course

describe('headingsKey', () => {
  it('changes with a summary.md mtime, a part appearing and a rename, not with a pdf', () => {
    const base = headingsKey(course([lec('a', 1, 1)]))
    expect(headingsKey(course([lec('a', 2, 1)]))).not.toBe(base)
    expect(headingsKey(course([lec('a', 1, 1), lec('b', 1, 1)]))).not.toBe(base)
    expect(headingsKey(course([lec('x', 1, 1)]))).not.toBe(base)
    expect(headingsKey(course([lec('a', 1, 9)]))).toBe(base)
  })
  it('tells a lecture from a recitation of the same name', () => {
    expect(headingsKey(course([lec('a', 1, 1)]))).not.toBe(
      headingsKey(course([], [lec('a', 1, 1)])),
    )
  })
})
