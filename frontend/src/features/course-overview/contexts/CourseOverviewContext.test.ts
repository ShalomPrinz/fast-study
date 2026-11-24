// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { CourseFile, CourseStatus, OverviewMeta } from '@/types'
import { CourseOverviewProvider, useCourseOverview } from './CourseOverviewContext'

const { fetchCourseFiles, fetchCourseMeta, fetchCourseStatus, notify } = vi.hoisted(() => ({
  fetchCourseFiles: vi.fn(),
  fetchCourseMeta: vi.fn(),
  fetchCourseStatus: vi.fn(),
  notify: { cb: (_m?: string[]) => {} },
}))
vi.mock('@/services/backend', () => ({
  fetchCourseStatus,
  fetchOverviewExtractors: () => Promise.resolve([]),
  runOverview: vi.fn(),
}))
vi.mock('@/services/database', () => ({ fetchCourseFiles, fetchCourseMeta }))
vi.mock('@/services/events', () => ({
  subscribeNotify: (cb: (m: string[]) => void, topics?: string[]) => {
    notify.cb = (m = topics ?? []) => cb(m)
    return () => {}
  },
}))

// Files, meta and status tagged with the same version, so a render can tell whether they agree.
const files = (v: number): CourseFile[] => [{ name: `v${v}`, size: 0, mtime: 0 }]
const meta = (v: number) => ({ [`v${v}`]: {} }) as unknown as OverviewMeta
const status = (v: number) =>
  ({ running: true, extractors: {}, notices: [], v }) as unknown as CourseStatus

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type Triple = ReturnType<typeof triple>
function triple() {
  const t = {
    f: deferred<CourseFile[]>(),
    m: deferred<OverviewMeta>(),
    s: deferred<CourseStatus>(),
  }
  fetchCourseFiles.mockReturnValueOnce(t.f.promise)
  fetchCourseMeta.mockReturnValueOnce(t.m.promise)
  fetchCourseStatus.mockReturnValueOnce(t.s.promise)
  return t
}
const land = (t: Triple, v: number) => {
  t.f.resolve(files(v))
  t.m.resolve(meta(v))
  t.s.resolve(status(v))
}

// Every render's (files version, meta version, status version), in order.
function render() {
  const seen: string[] = []
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(CourseOverviewProvider, { course: shown.course, children })
  const hook = renderHook(
    () => {
      const { files: f, meta: m, status: s } = useCourseOverview()
      const sv = s ? (s as unknown as { v: number }).v : '-'
      seen.push(`${f[0]?.name ?? '-'}/${Object.keys(m)[0] ?? '-'}/${sv}`)
    },
    { wrapper },
  )
  return { ...hook, seen }
}

// The course the wrapper mounts the provider with; a test switches it, then rerenders.
const shown = { course: 'a' }

beforeEach(() => {
  shown.course = 'a'
  fetchCourseFiles.mockReset()
  fetchCourseMeta.mockReset()
  fetchCourseStatus.mockReset()
})

describe('a refresh', () => {
  it('applies files, meta and status together even when a newer notify lands mid-flight', async () => {
    const t1 = triple()
    const { seen } = render()
    await act(async () => land(t1, 1))
    expect(seen.at(-1)).toBe('v1/v1/1')

    // Status answers first, then a newer notify starts the next triple before files and meta land.
    const t2 = triple()
    act(() => {
      notify.cb()
    })
    await act(async () => t2.s.resolve(status(2)))
    const t3 = triple()
    act(() => {
      notify.cb()
    })
    await act(async () => {
      t2.m.resolve(meta(2))
      t2.f.resolve(files(2))
    })
    expect(seen.at(-1)).toBe('v2/v2/2')
    await act(async () => land(t3, 3))

    expect(seen.at(-1)).toBe('v3/v3/3')
    expect(seen.filter((r) => !['-/-/-', 'v1/v1/1', 'v2/v2/2', 'v3/v3/3'].includes(r))).toEqual([])
  })

  it('drops a triple older than the one shown, but lands one newer while a later fetch is in flight', async () => {
    const [t1, t2, t3] = [triple(), triple(), triple()]
    const { seen } = render()
    act(() => {
      notify.cb()
    })
    act(() => {
      notify.cb()
    })

    await act(async () => land(t2, 2))
    expect(seen.at(-1)).toBe('v2/v2/2')

    await act(async () => land(t1, 1))
    expect(seen.at(-1)).toBe('v2/v2/2')

    await act(async () => land(t3, 3))
    expect(seen.at(-1)).toBe('v3/v3/3')
  })

  it('drops a triple fetched for the course before a switch', async () => {
    const [a, b] = [triple(), triple()]
    const { seen, rerender } = render()
    shown.course = 'b'
    rerender()

    await act(async () => land(a, 1))
    expect(seen.at(-1)).toBe('-/-/-')
    await act(async () => land(b, 2))
    expect(seen.at(-1)).toBe('v2/v2/2')
  })

  it('still applies the sides that succeeded when one fails', async () => {
    const t1 = triple()
    const { seen } = render()
    await act(async () => {
      t1.f.reject(new Error('database down'))
      t1.m.resolve(meta(1))
      t1.s.resolve(status(1))
    })
    expect(seen.at(-1)).toBe('-/v1/1')
  })
})

describe('a topic-tagged notify', () => {
  async function booted() {
    fetchCourseFiles.mockResolvedValue(files(1))
    fetchCourseMeta.mockResolvedValue(meta(1))
    fetchCourseStatus.mockResolvedValue(status(1))
    const hook = render()
    await act(async () => {})
    fetchCourseFiles.mockClear()
    fetchCourseMeta.mockClear()
    fetchCourseStatus.mockClear()
    return hook
  }

  it('refetches only the status for runner', async () => {
    await booted()
    await act(async () => notify.cb(['runner']))
    expect(fetchCourseStatus).toHaveBeenCalledTimes(1)
    expect(fetchCourseFiles).not.toHaveBeenCalled()
    expect(fetchCourseMeta).not.toHaveBeenCalled()
  })

  it('refetches only files and meta for tree', async () => {
    await booted()
    await act(async () => notify.cb(['tree']))
    expect(fetchCourseFiles).toHaveBeenCalledTimes(1)
    expect(fetchCourseMeta).toHaveBeenCalledTimes(1)
    expect(fetchCourseStatus).not.toHaveBeenCalled()
  })

  it('refetches the triple for runner and tree', async () => {
    await booted()
    await act(async () => notify.cb(['runner', 'tree']))
    expect(fetchCourseFiles).toHaveBeenCalledTimes(1)
    expect(fetchCourseMeta).toHaveBeenCalledTimes(1)
    expect(fetchCourseStatus).toHaveBeenCalledTimes(1)
  })
})
