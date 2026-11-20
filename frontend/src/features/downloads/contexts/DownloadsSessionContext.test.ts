// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Course } from '@/types'
import {
  DownloadsSessionProvider,
  useDownloadsActions,
  useDownloadsSession,
} from './DownloadsSessionContext'
import { MoodleLockProvider } from './MoodleLockContext'

const { reportConnectionError } = vi.hoisted(() => ({ reportConnectionError: vi.fn() }))
vi.mock('@/services/toaster', () => ({ toast: vi.fn() }))
vi.mock('@/services/serviceHealth', () => ({ reportConnectionError }))

const sendUpdate = vi.fn()

const ALGEBRA = { name: 'Algebra', source_url: 'https://lemida.example/course/1' } as Course
const CALCULUS = { name: 'Calculus', source_url: 'https://lemida.example/course/2' } as Course
const ITEM = { ref: 'r1', title: 'Lecture 1', kind: 'lecture', media: 'video', section: 'Week 1' }

// The last `/auth/events` frame the lock saw; a test reassigns it and rerenders to push one.
let frame: { moodleBusy?: boolean } | null = null

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    MoodleLockProvider,
    { frame, children: null },
    createElement(DownloadsSessionProvider, { sendUpdate, children }),
  )
}

function render() {
  return renderHook(() => ({ state: useDownloadsSession(), actions: useDownloadsActions() }), {
    wrapper,
  })
}

// Each call answers with the next response; a thrown TypeError is what fetch does when nothing listens.
function stubFetch(...answers: Array<Response | TypeError>) {
  const fetch = vi.fn(async () => {
    const next = answers.shift()
    if (next instanceof TypeError) throw next
    return next
  })
  vi.stubGlobal('fetch', fetch)
}

const listed = () => Response.json({ items: [ITEM] })
const refused = () => new Response('{}', { status: 500, statusText: 'Internal Server Error' })

beforeEach(() => {
  frame = null
  sendUpdate.mockClear()
  reportConnectionError.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a failed discovery', () => {
  it('never selects the course and records it as failed, with no detail for a codeless refusal', async () => {
    stubFetch(refused())
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))

    expect(result.current.state.selected).toBeNull()
    expect(result.current.state.pending).toBeNull()
    expect(result.current.state.items).toEqual([])
    expect(result.current.state.failed).toEqual({ course: 'Algebra', detail: null })
  })

  it('never toasts', async () => {
    stubFetch(refused())
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))

    expect(sendUpdate).not.toHaveBeenCalled()
    expect(reportConnectionError).not.toHaveBeenCalled()
  })

  it('does not bring back the course that was open', async () => {
    stubFetch(listed(), refused())
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))
    await act(() => result.current.actions.discover(CALCULUS))

    expect(result.current.state.selected).toBeNull()
    expect(result.current.state.items).toEqual([])
    expect(result.current.state.failed?.course).toBe('Calculus')
  })

  it('carries the service reason inline when the refusal has a code, with no toast', async () => {
    stubFetch(Response.json({ error: 'Moodle said no', code: 'moodle_ws_error' }, { status: 500 }))
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))

    const detail = result.current.state.failed?.detail as { props: { failure: { code: string } } }
    expect(detail.props.failure.code).toBe('moodle_ws_error')
    expect(sendUpdate).not.toHaveBeenCalled()
  })

  it('is cleared by a retry, which loads the course', async () => {
    stubFetch(refused(), listed())
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))
    await act(() => result.current.actions.discover(ALGEBRA))

    expect(result.current.state.failed).toBeNull()
    expect(result.current.state.selected).toBe('Algebra')
  })

  it('is cleared by close', async () => {
    stubFetch(refused())
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))
    act(() => result.current.actions.close())

    expect(result.current.state.failed).toBeNull()
  })
})

describe('picking a course', () => {
  it('empties the page and drops typed names at once, before the new load answers', async () => {
    stubFetch(listed())
    const { result } = render()
    await act(() => result.current.actions.discover(ALGEBRA))
    act(() => result.current.actions.rowEdits.setName('r1', 'typed'))
    expect(result.current.state.edits.r1.name).toBe('typed')

    stubFetch(new Promise<Response>(() => {}) as never)
    act(() => {
      void result.current.actions.discover(CALCULUS)
    })

    expect(result.current.state.pending).toBe('Calculus')
    expect(result.current.state.selected).toBeNull()
    expect(result.current.state.items).toEqual([])
    expect(result.current.state.edits).toEqual({})
  })
})

describe('a blocked-by-site discovery', () => {
  it('toasts once and records a failure with no detail', async () => {
    stubFetch(Response.json({ status: 'blocked', params: {} }, { status: 503 }))
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))

    expect(sendUpdate).toHaveBeenCalledTimes(1)
    expect(result.current.state.failed).toEqual({ course: 'Algebra', detail: null })
  })
})

describe('a discovery against a downed auto-downloader', () => {
  it('reports the connection error once and selects nothing', async () => {
    stubFetch(new TypeError('Failed to fetch'))
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))

    expect(reportConnectionError).toHaveBeenCalledTimes(1)
    expect(sendUpdate).not.toHaveBeenCalled()
    expect(result.current.state.selected).toBeNull()
    expect(result.current.state.failed).toEqual({ course: 'Algebra', detail: null })
  })
})

describe('a successful discovery', () => {
  it('selects the course with its items in hand', async () => {
    stubFetch(listed())
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))

    expect(result.current.state.selected).toBe('Algebra')
    expect(result.current.state.items).toHaveLength(1)
  })
})

describe('a discovery refused by a busy Moodle lock', () => {
  it('stays quiet and leaves the page as it was: the button only raced the push', async () => {
    stubFetch(
      Response.json(
        { status: 'busy', error: 'lock taken', code: 'moodle_busy', params: {} },
        { status: 429 },
      ),
    )
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))

    expect(sendUpdate).not.toHaveBeenCalled()
    expect(result.current.state.selected).toBeNull()
    expect(result.current.state.pending).toBeNull()
  })
})

describe('a waiting discovery', () => {
  it('asks again once the lock frees instead of failing on busy', async () => {
    stubFetch(
      Response.json(
        { status: 'busy', error: 'lock taken', code: 'moodle_busy', params: {} },
        { status: 429 },
      ),
      listed(),
    )
    const { result, rerender } = render()

    let done!: Promise<void>
    act(() => {
      done = result.current.actions.discover(ALGEBRA, { wait: true })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
      frame = { moodleBusy: false }
      rerender()
    })
    await act(() => done)

    expect(sendUpdate).not.toHaveBeenCalled()
    expect(result.current.state.selected).toBe('Algebra')
  })
})
