import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  firstCourseName,
  nextWanted,
  readCoursesView,
  readOpenCourse,
  resolveOpenCourse,
  scrollTag,
  showsCoursesView,
  treeScrollTop,
  viewFocusSelectors,
  writeCoursesView,
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

describe('courses view memory', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('starts on the course view and round-trips', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    expect(readCoursesView()).toBe(false)
    writeCoursesView(true)
    expect(readCoursesView()).toBe(true)
    writeCoursesView(false)
    expect(readCoursesView()).toBe(false)
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
    expect(() => writeCoursesView(true)).not.toThrow()
    expect(readCoursesView()).toBe(false)
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

describe('showsCoursesView', () => {
  it('keeps the saved view without a route course', () => {
    expect(showsCoursesView(null, true)).toBe(true)
    expect(showsCoursesView(null, false)).toBe(false)
  })

  it('forces the course view when the route names a course', () => {
    expect(showsCoursesView('a', true)).toBe(false)
  })
})

describe('treeScrollTop', () => {
  it('restores the saved offset for the same course', () => {
    expect(treeScrollTop({ course: 'a', top: 120 }, 'a')).toBe(120)
  })

  it('starts a different course at the top', () => {
    expect(treeScrollTop({ course: 'a', top: 120 }, 'b')).toBe(0)
  })
})

describe('scrollTag', () => {
  it('tags a renamed course still open under its old name with the new one', () => {
    expect(scrollTag('old', { name: 'new', was: 'old' }, { course: 'new' })).toBe('new')
  })

  it('does not move the tag for a new course, whose saved tag was not moved', () => {
    expect(scrollTag('cur', { name: 'created', was: 'cur' }, { course: 'cur' })).toBe('cur')
  })

  it('tags with the open name otherwise', () => {
    expect(scrollTag('a', { name: 'a' }, { course: 'a' })).toBe('a')
    expect(scrollTag('a', { name: 'b' }, { course: 'a' })).toBe('a')
    expect(scrollTag('new', { name: 'new', was: 'old' }, { course: 'new' })).toBe('new')
  })
})

describe('viewFocusSelectors', () => {
  it('prefers the current row in the list, then the back button', () => {
    expect(viewFocusSelectors(true)).toEqual(['.other-course[aria-current]', '.pane-switch-btn'])
  })

  it('targets the header button in the tree', () => {
    expect(viewFocusSelectors(false)).toEqual(['.pane-switch-btn'])
  })
})
