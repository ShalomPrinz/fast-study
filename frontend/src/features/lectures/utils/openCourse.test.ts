import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  firstCourseName,
  nextWanted,
  readMoreOpen,
  readOpenCourse,
  resolveOpenCourse,
  writeMoreOpen,
  writeOpenCourse,
} from './openCourse'

const courses = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]

describe('resolveOpenCourse', () => {
  it('opens the wanted course', () => {
    expect(resolveOpenCourse(courses, 'b')).toBe(courses[1])
  })

  it('falls back to the first course when the wanted one is gone or unset', () => {
    expect(resolveOpenCourse(courses, 'gone')).toBe(courses[0])
    expect(resolveOpenCourse(courses, null)).toBe(courses[0])
  })

  it('tries wanted names in order, so a rename holds until the tree catches up', () => {
    expect(resolveOpenCourse(courses, 'new', 'c')).toBe(courses[2])
    expect(resolveOpenCourse(courses, 'b', 'c')).toBe(courses[1])
  })

  it('opens nothing without courses', () => {
    expect(resolveOpenCourse([], 'a')).toBeUndefined()
  })
})

describe('open course memory', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('round-trips through storage', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    writeOpenCourse('b')
    expect(readOpenCourse()).toBe('b')
  })

  it('survives blocked storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => writeOpenCourse('b')).not.toThrow()
    expect(readOpenCourse()).toBeNull()
  })
})

describe('more courses memory', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('starts collapsed and round-trips', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    expect(readMoreOpen()).toBe(false)
    writeMoreOpen(true)
    expect(readMoreOpen()).toBe(true)
    writeMoreOpen(false)
    expect(readMoreOpen()).toBe(false)
  })

  it('survives blocked storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => writeMoreOpen(true)).not.toThrow()
    expect(readMoreOpen()).toBe(false)
  })
})

describe('nextWanted', () => {
  it('keeps the old name when the same course is opened again', () => {
    expect(nextWanted({ name: 'new', was: 'old' }, 'new')).toEqual({ name: 'new', was: 'old' })
  })

  it('drops it when another course is opened', () => {
    expect(nextWanted({ name: 'new', was: 'old' }, 'b')).toEqual({ name: 'b', was: undefined })
  })

  it('takes an explicit old name', () => {
    expect(nextWanted({ name: 'a' }, 'new', 'a')).toEqual({ name: 'new', was: 'a' })
  })
})

describe('firstCourseName', () => {
  it('skips an empty route param so the remembered course still applies', () => {
    expect(firstCourseName(undefined, '')).toBeNull()
    expect(firstCourseName(undefined, '') ?? 'remembered').toBe('remembered')
  })

  it('takes the first non-empty name', () => {
    expect(firstCourseName('', 'b', 'c')).toBe('b')
  })
})
