// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Course, RunnerStatus } from '@/types'
import { SnapshotProvider } from './SnapshotProvider'
import { useCourseTreeContext } from './CourseTreeContext'
import { useRunnerStatus } from './RunnerStatusContext'

const { fetchRunnerStatus, fetchTree, notify } = vi.hoisted(() => ({
  fetchRunnerStatus: vi.fn(),
  fetchTree: vi.fn(),
  notify: { cb: () => {} },
}))
vi.mock('@/services/backend', () => ({ fetchRunnerStatus, runAll: vi.fn() }))
vi.mock('@/services/database', () => ({ fetchTree }))
vi.mock('@/services/toaster', () => ({ toast: vi.fn() }))
vi.mock('@/services/events', () => ({
  subscribeNotify: (cb: () => void) => {
    notify.cb = cb
    return () => {}
  },
}))

// A status and a tree tagged with the same version, so a render can tell whether they agree.
const status = (v: number) =>
  ({
    runner: { running: true, lastError: null },
    inFlight: [],
    errors: {},
    v,
  }) as unknown as RunnerStatus
const tree = (v: number) =>
  [{ name: `v${v}`, lectures: [], recitations: [] }] as unknown as Course[]

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Every render's (status version, tree version, loaded), in order.
function render() {
  const seen: string[] = []
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(SnapshotProvider, { children })
  const hook = renderHook(
    () => {
      const { status: s } = useRunnerStatus()
      const { courses, loaded } = useCourseTreeContext()
      const sv = s ? (s as unknown as { v: number }).v : '-'
      seen.push(`${sv}/${courses[0]?.name ?? '-'}/${loaded}`)
      return { status: s, courses, loaded }
    },
    { wrapper },
  )
  return { ...hook, seen }
}

beforeEach(() => {
  fetchRunnerStatus.mockReset()
  fetchTree.mockReset()
})

describe('a notify', () => {
  it('applies /status and /tree in one render, never a fresh status beside a stale tree', async () => {
    fetchRunnerStatus.mockResolvedValueOnce(status(1))
    fetchTree.mockResolvedValueOnce(tree(1))
    const { seen } = render()
    await act(async () => {})
    expect(seen.at(-1)).toBe('1/v1/true')

    const s2 = deferred<RunnerStatus>()
    const t2 = deferred<Course[]>()
    fetchRunnerStatus.mockReturnValueOnce(s2.promise)
    fetchTree.mockReturnValueOnce(t2.promise)
    act(() => {
      notify.cb()
    })
    await act(async () => s2.resolve(status(2)))
    expect(seen.at(-1)).toBe('1/v1/true')
    await act(async () => t2.resolve(tree(2)))

    expect(seen.at(-1)).toBe('2/v2/true')
    expect(seen).not.toContain('2/v1/true')
    expect(seen).not.toContain('1/v2/true')
  })

  it('drops a pair older than the one shown, but lands one newer while a later fetch is in flight', async () => {
    const pairs = [1, 2, 3].map(() => [deferred<RunnerStatus>(), deferred<Course[]>()] as const)
    for (const [s, c] of pairs) {
      fetchRunnerStatus.mockReturnValueOnce(s.promise)
      fetchTree.mockReturnValueOnce(c.promise)
    }
    const { seen } = render()
    act(() => {
      notify.cb()
    })
    act(() => {
      notify.cb()
    })

    await act(async () => {
      pairs[1][0].resolve(status(2))
      pairs[1][1].resolve(tree(2))
    })
    expect(seen.at(-1)).toBe('2/v2/true')

    await act(async () => {
      pairs[0][0].resolve(status(1))
      pairs[0][1].resolve(tree(1))
    })
    expect(seen.at(-1)).toBe('2/v2/true')

    await act(async () => {
      pairs[2][0].resolve(status(3))
      pairs[2][1].resolve(tree(3))
    })
    expect(seen.at(-1)).toBe('3/v3/true')
  })
})

describe('one side failing', () => {
  it('still applies the tree when /status fails', async () => {
    fetchRunnerStatus.mockRejectedValueOnce(new Error('backend down'))
    fetchTree.mockResolvedValueOnce(tree(1))
    const { seen } = render()
    await act(async () => {})
    expect(seen.at(-1)).toBe('-/v1/true')
  })

  it('still applies the status, and settles loaded, when /tree fails', async () => {
    fetchRunnerStatus.mockResolvedValueOnce(status(1))
    fetchTree.mockRejectedValueOnce(new Error('database down'))
    const { seen } = render()
    await act(async () => {})
    expect(seen.at(-1)).toBe('1/-/true')
  })

  it('leaves loaded unset when a newer fetch owns the failure, so no empty tree shows', async () => {
    const t2 = deferred<Course[]>()
    fetchRunnerStatus.mockResolvedValue(status(1))
    fetchTree
      .mockRejectedValueOnce(new Error('database restarting'))
      .mockReturnValueOnce(t2.promise)
    const { seen } = render()
    act(() => {
      notify.cb()
    })
    await act(async () => {})
    expect(seen.at(-1)).toBe('1/-/false')

    await act(async () => t2.resolve(tree(2)))
    expect(seen.at(-1)).toBe('1/v2/true')
  })
})

describe('refreshUntil', () => {
  // Booted on tree v1, with a notify's refetch and refreshUntil's own refetch both pending.
  async function waitingFor(name: string) {
    fetchRunnerStatus.mockResolvedValue(status(1))
    fetchTree.mockResolvedValueOnce(tree(1))
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(SnapshotProvider, { children })
    const { result } = renderHook(() => useCourseTreeContext(), { wrapper })
    await act(async () => {})
    const fromNotify = deferred<Course[]>()
    const own = deferred<Course[]>()
    fetchTree.mockReturnValueOnce(fromNotify.promise).mockReturnValueOnce(own.promise)
    act(() => {
      notify.cb()
    })
    let settled = false
    act(() => {
      void result.current
        .refreshUntil((courses) => courses.some((c) => c.name === name))
        .then(() => (settled = true))
    })
    return { fromNotify, own, settled: () => settled }
  }

  it('settles at the first applied tree holding the name, though its own refetch is still out', async () => {
    const { fromNotify, settled } = await waitingFor('v2')
    await act(async () => fromNotify.resolve(tree(2)))
    expect(settled()).toBe(true)
  })

  it('keeps waiting past a tree without the name, and settles when its own refetch does', async () => {
    const { fromNotify, own, settled } = await waitingFor('v9')
    await act(async () => fromNotify.resolve(tree(2)))
    expect(settled()).toBe(false)
    await act(async () => own.resolve(tree(3)))
    expect(settled()).toBe(true)
  })

  it('settles when its own refetch fails', async () => {
    const { own, settled } = await waitingFor('v9')
    await act(async () => own.reject(new Error('database down')))
    expect(settled()).toBe(true)
  })
})

describe('the course tree', () => {
  it('orders courses by name, whatever order the database lists them in', async () => {
    fetchRunnerStatus.mockResolvedValueOnce(status(1))
    const names = ['Physics', 'אלגברה', 'Calculus', 'archived', 'בדידה']
    fetchTree.mockResolvedValueOnce(
      names.map((name) => ({ name, lectures: [], recitations: [] })) as unknown as Course[],
    )
    const { result } = render()
    await act(async () => {})
    // Case-insensitive, Latin before Hebrew: a plain code-unit sort would put `archived` after `Physics`.
    expect(result.current.courses.map((c) => c.name)).toEqual([
      'archived',
      'Calculus',
      'Physics',
      'אלגברה',
      'בדידה',
    ])
  })
})
