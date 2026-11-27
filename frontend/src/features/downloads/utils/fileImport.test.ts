import { describe, it, expect } from 'vitest'
import {
  canCancelImport,
  seenAtMount,
  classifyDrop,
  formatBytes,
  importBlocker,
  importsInto,
  importAnnouncement,
  importRoute,
  isMp4,
  pathOf,
  percentOf,
} from './fileImport'

const file = (name: string, type = '') => ({ name, type }) as File

describe('the .mp4 and one-file drop rules', () => {
  it('takes a name or a type that says mp4, case-insensitively', () => {
    expect(isMp4(file('Lecture.MP4'))).toBe(true)
    expect(isMp4(file('blob', 'video/mp4'))).toBe(true)
    expect(isMp4(file('a.mkv', 'video/x-matroska'))).toBe(false)
  })

  it('takes exactly one .mp4 and says why for anything else', () => {
    const a = file('a.mp4')
    expect(classifyDrop([a])).toEqual({ kind: 'file', file: a })
    expect(classifyDrop([])).toEqual({ kind: 'none' })
    expect(classifyDrop([a, file('b.mp4')])).toEqual({ kind: 'many' })
    expect(classifyDrop([file('a.pdf')])).toEqual({ kind: 'not-mp4' })
  })
})

describe('the import route', () => {
  it('uses the path when there is one, uploads a plain-browser Copy, and refuses a plain-browser Move', () => {
    expect(importRoute('copy', 'C:\\a.mp4')).toBe('path')
    expect(importRoute('move', 'C:\\a.mp4')).toBe('path')
    expect(importRoute('copy', '')).toBe('upload')
    expect(importRoute('move', '')).toBe('unavailable')
  })

  it('reads the path off the bridge, empty when the bridge or the function is absent', () => {
    const f = file('a.mp4')
    expect(pathOf(f, undefined)).toBe('')
    expect(pathOf(f, {})).toBe('')
    expect(pathOf(f, { pathForFile: () => '/x/a.mp4' })).toBe('/x/a.mp4')
  })
})

describe('importBlocker', () => {
  const ready = {
    hasFile: true,
    course: 'Algo',
    name: 'L1',
    busy: false,
    importing: false,
    route: 'path' as const,
  }
  it('names the first unmet requirement in order', () => {
    expect(importBlocker({ ...ready, hasFile: false, course: '', name: '', busy: true })).toBe(
      'no-file',
    )
    expect(importBlocker({ ...ready, course: '', name: '', busy: true })).toBe('no-course')
    expect(importBlocker({ ...ready, name: ' ', busy: true })).toBe('no-name')
    expect(importBlocker({ ...ready, busy: true, route: 'unavailable' })).toBe('busy')
    expect(importBlocker({ ...ready, importing: true, route: 'unavailable' })).toBe('importing')
    expect(importBlocker({ ...ready, route: 'unavailable' })).toBe('desktop-only')
    expect(importBlocker(ready)).toBeNull()
  })
})

describe('sizes and percent', () => {
  it('formats bytes and clamps the percent', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(540 * 1024 * 1024)).toBe('540 MB')
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.2 GB')
    expect(percentOf(540, 1200)).toBe(45)
    expect(percentOf(5, 0)).toBe(0)
    expect(percentOf(9, 3)).toBe(100)
  })
})

describe('importAnnouncement', () => {
  it('speaks the start, the end and a failure, and nothing else', () => {
    expect(importAnnouncement(undefined, 'running')).toBe('start')
    expect(importAnnouncement('running', 'running')).toBeNull()
    expect(importAnnouncement('running', 'done')).toBe('done')
    expect(importAnnouncement('running', 'error')).toBe('error')
    expect(importAnnouncement('running', 'cancelled')).toBeNull()
    expect(importAnnouncement('error', 'running')).toBe('start')
  })
})

describe('canCancelImport', () => {
  it('offers Cancel until every byte is copied or sent', () => {
    expect(canCancelImport(0, 0)).toBe(true)
    expect(canCancelImport(3, 4)).toBe(true)
    expect(canCancelImport(4, 4)).toBe(false)
  })
})

describe('seenAtMount', () => {
  it('seeds every present entry so a remount announces nothing until one changes', () => {
    const seen = seenAtMount([
      { key: 1, status: 'done' },
      { key: 2, status: 'running' },
    ])
    expect(importAnnouncement(seen.get(1), 'done')).toBeNull()
    expect(importAnnouncement(seen.get(2), 'running')).toBeNull()
    expect(importAnnouncement(seen.get(2), 'done')).toBe('done')
    expect(importAnnouncement(seen.get(3), 'running')).toBe('start')
  })
})

describe('importsInto', () => {
  const e = (status: 'running' | 'done', over = {}) => ({
    course: 'Algo',
    lecture: 'L1',
    kind: 'lecture',
    status,
    doneAt: status === 'done' ? 100 : null,
    ...over,
  })
  it('matches the status, course and kind, casefolded and trimmed', () => {
    const target = { course: ' algo ', lecture: 'l1 ', kind: 'lecture' }
    expect(importsInto([e('running')], target, 'running')).toBe(true)
    expect(importsInto([e('done')], target, 'running')).toBe(false)
    expect(importsInto([e('done')], target, 'done')).toBe(true)
    expect(importsInto([e('running', { kind: 'recitation' })], target, 'running')).toBe(false)
    expect(importsInto([e('running', { course: 'Other' })], target, 'running')).toBe(false)
    expect(importsInto([e('running', { lecture: 'L2' })], target, 'running')).toBe(false)
  })
  it('counts a done import only until the tree refreshes after it finished', () => {
    const target = { course: 'Algo', lecture: 'L1', kind: 'lecture' }
    expect(importsInto([e('done')], target, 'done', 50)).toBe(true)
    expect(importsInto([e('done')], target, 'done', 100)).toBe(false)
    expect(importsInto([e('done')], target, 'done', 200)).toBe(false)
  })
})
