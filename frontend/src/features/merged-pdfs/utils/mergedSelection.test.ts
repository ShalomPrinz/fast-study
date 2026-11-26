import { describe, expect, it } from 'vitest'
import type { Course, FileInfo, FileStatus, MergedPart } from '@/types'
import { RequestError } from '@/services/http'
import {
  appendMissing,
  applyPrefill,
  canCreate,
  createBlocker,
  checkboxDisabled,
  existingTitle,
  pruneVanished,
  movePart,
  pdfState,
  pickGroups,
  isRenderingPdf,
  sectionTick,
  toggleSection,
  type PickItem,
  readPrefill,
  submitAction,
  toggleInOrder,
} from './mergedSelection'

const L = (name: string): MergedPart => ({ name, kind: 'lecture' })
const R = (name: string): MergedPart => ({ name, kind: 'recitation' })
const names = (order: MergedPart[]) => order.map((p) => p.name)

const file = (exists: boolean, mtime: number | null = null): FileInfo => ({
  exists,
  size: exists ? 10 : null,
  mtime,
})
function files(md: FileInfo, pdf: FileInfo): Pick<FileStatus, 'summary.md' | 'summary.pdf'> {
  return { 'summary.md': md, 'summary.pdf': pdf }
}

describe('toggleInOrder', () => {
  it('appends a ticked part at the bottom and ignores a repeat', () => {
    const once = toggleInOrder([L('a')], L('b'), true)
    expect(names(once)).toEqual(['a', 'b'])
    expect(toggleInOrder(once, L('b'), true)).toBe(once)
  })
  it('removes an unticked part and leaves the rest in order', () => {
    expect(names(toggleInOrder([L('a'), L('b'), L('c')], L('b'), false))).toEqual(['a', 'c'])
  })
  it('keeps a lecture and a recitation of one name apart', () => {
    expect(toggleInOrder([L('x')], R('x'), true)).toHaveLength(2)
    expect(names(toggleInOrder([L('x'), R('x')], L('x'), false))).toEqual(['x'])
  })
})

describe('appendMissing', () => {
  it('adds only the parts not ticked yet, after the existing order', () => {
    expect(names(appendMissing([L('c')], [L('a'), L('b'), L('c')]))).toEqual(['c', 'a', 'b'])
  })
})

const item = (part: MergedPart, state: PickItem['state'] = 'ok'): PickItem => ({ part, state })

describe('sectionTick', () => {
  const items = [item(L('a')), item(L('b'), 'outdated'), item(L('c'), 'missing')]
  it('counts only the mergeable items', () => {
    expect(sectionTick(items, [])).toBe('none')
    expect(sectionTick(items, [L('a')])).toBe('some')
    expect(sectionTick(items, [L('a'), L('b')])).toBe('all')
  })
  it('ignores a ticked part that is no longer mergeable', () => {
    expect(sectionTick(items, [L('c')])).toBe('none')
  })
  it('reads none when nothing is mergeable', () => {
    expect(sectionTick([item(L('c'), 'missing')], [])).toBe('none')
  })
})

describe('toggleSection', () => {
  const items = [item(L('a')), item(L('b')), item(L('c'), 'missing')]
  it('ticks the rest when only some are ticked, keeping the existing order', () => {
    expect(names(toggleSection([L('b')], items))).toEqual(['b', 'a'])
  })
  it('unticks the section when all are ticked, leaving other sections alone', () => {
    expect(names(toggleSection([R('x'), L('a'), L('b')], items))).toEqual(['x'])
  })
  it('never ticks an unmergeable item', () => {
    expect(names(toggleSection([], items))).toEqual(['a', 'b'])
  })
})

describe('isRenderingPdf', () => {
  it('is true only for the pdf step', () => {
    expect(isRenderingPdf({ step: 'pdf' })).toBe(true)
    expect(isRenderingPdf({ step: 'summarize' })).toBe(false)
    expect(isRenderingPdf(null)).toBe(false)
  })
})

describe('movePart', () => {
  const order = [L('a'), L('b'), L('c'), L('d')]
  it('moves down and up', () => {
    expect(names(movePart(order, 0, 2))).toEqual(['b', 'c', 'a', 'd'])
    expect(names(movePart(order, 3, 1))).toEqual(['a', 'd', 'b', 'c'])
  })
  it('leaves the order alone for a no-op or an out-of-range index', () => {
    expect(movePart(order, 1, 1)).toBe(order)
    expect(movePart(order, -1, 2)).toBe(order)
    expect(movePart(order, 0, 4)).toBe(order)
  })
})

describe('pdfState', () => {
  it('is missing without a PDF, outdated when it predates the summary, else ok', () => {
    expect(pdfState(files(file(true, 5), file(false)))).toBe('missing')
    expect(pdfState(files(file(true, 9), file(true, 5)))).toBe('outdated')
    expect(pdfState(files(file(true, 5), file(true, 9)))).toBe('ok')
    expect(pdfState(files(file(false), file(true, 5)))).toBe('ok')
  })
})

describe('pickGroups', () => {
  const lec = (name: string) => ({ name, files: files(file(true, 1), file(true, 2)) })
  const course = (lectures_only: boolean) =>
    ({
      lectures: [lec('Lecture 2'), lec('Lecture 1')].map((l) => l),
      recitations: [lec('Recitation 1')],
      lectures_only,
    }) as unknown as Course
  it('lists a lectures-only course as one merged list', () => {
    const g = pickGroups(course(true))
    expect(g.recitations).toEqual([])
    expect(g.lectures.map((i) => i.part.kind)).toContain('recitation')
  })
  it('keeps recitations apart otherwise', () => {
    const g = pickGroups(course(false))
    expect(g.lectures.every((i) => i.part.kind === 'lecture')).toBe(true)
    expect(g.recitations.map((i) => i.part.name)).toEqual(['Recitation 1'])
  })
})

describe('readPrefill / applyPrefill', () => {
  it('reads nothing from a missing or malformed state', () => {
    expect(readPrefill(null)).toBeNull()
    expect(readPrefill({ title: 3 })).toBeNull()
  })
  it('drops parts that are gone or have no PDF now and names them', () => {
    const prefill = readPrefill({ title: 'T', parts: [L('a'), R('b'), L('gone'), { name: 'x' }] })!
    expect(prefill.parts).toHaveLength(3)
    const { order, dropped } = applyPrefill(prefill, [L('a'), R('b')])
    expect(names(order)).toEqual(['a', 'b'])
    expect(names(dropped)).toEqual(['gone'])
  })
  it('keeps the old merge order, not the course order', () => {
    const prefill = { title: 'T', parts: [L('b'), L('a')] }
    expect(names(applyPrefill(prefill, [L('a'), L('b')]).order)).toEqual(['b', 'a'])
  })
})

describe('canCreate', () => {
  it('needs a non-blank title and at least one part', () => {
    expect(canCreate('  ', [L('a')])).toBe(false)
    expect(canCreate('T', [])).toBe(false)
    expect(canCreate(' T ', [L('a')])).toBe(true)
  })
})

describe('submitAction', () => {
  const refusal = (code: string) => new RequestError(code, code, null)
  it('goes to the history when the merge started or one is already running', () => {
    expect(submitAction({ status: 'started' }, false)).toBe('navigate')
    expect(submitAction({ status: 'busy' }, true)).toBe('navigate')
  })
  it('asks before replacing an existing title, once', () => {
    expect(submitAction({ error: refusal('merged_pdf_exists') }, false)).toBe('confirm-overwrite')
    expect(submitAction({ error: refusal('merged_pdf_exists') }, true)).toBe('toast')
  })
  it('toasts any other refusal', () => {
    expect(submitAction({ error: refusal('merged_part_missing') }, false)).toBe('toast')
    expect(submitAction({ error: new Error('boom') }, false)).toBe('toast')
  })
})

describe('checkboxDisabled', () => {
  it('lets a ticked part be unticked even without a PDF, but not ticked again', () => {
    expect(checkboxDisabled('missing', true)).toBe(false)
    expect(checkboxDisabled('missing', false)).toBe(true)
    expect(checkboxDisabled('ok', false)).toBe(false)
  })
})

describe('pruneVanished', () => {
  const items = [
    { part: L('a'), state: 'ok' as const },
    { part: L('b'), state: 'missing' as const },
  ]
  it('keeps parts still listed, even without a PDF, and drops the ones gone from the tree', () => {
    const r = pruneVanished([L('b'), L('gone'), L('a')], items)
    expect(names(r.order)).toEqual(['b', 'a'])
    expect(names(r.dropped)).toEqual(['gone'])
  })
  it('returns the same order when nothing vanished', () => {
    const order = [L('a')]
    expect(pruneVanished(order, items).order).toBe(order)
  })
  it('tells a lecture from a recitation of the same name', () => {
    expect(names(pruneVanished([R('a')], items).dropped)).toEqual(['a'])
  })
})

describe('existingTitle', () => {
  it('prefers the server title param, else the typed one', () => {
    expect(
      existingTitle({ error: new RequestError('x', 'merged_pdf_exists', { title: 'S' }) }, 'T'),
    ).toBe('S')
    expect(existingTitle({ error: new Error('x') }, 'T')).toBe('T')
  })
})

describe('createBlocker', () => {
  it('names the missing title, selection or both', () => {
    expect(createBlocker(' ', [L('a')], false)).toBe('title')
    expect(createBlocker('t', [], false)).toBe('selection')
    expect(createBlocker('', [], false)).toBe('both')
  })
  it('is null when creatable and submitting wins otherwise', () => {
    expect(createBlocker('t', [L('a')], false)).toBeNull()
    expect(createBlocker('t', [L('a')], true)).toBe('submitting')
  })
})
