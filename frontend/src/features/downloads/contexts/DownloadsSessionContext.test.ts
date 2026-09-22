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

const { toastConnectionError } = vi.hoisted(() => ({ toastConnectionError: vi.fn() }))
vi.mock('@/services/toaster', () => ({ toast: vi.fn(), toastConnectionError }))

const sendUpdate = vi.fn()

const ALGEBRA = { name: 'Algebra', source_url: 'https://lemida.example/course/1' } as Course
const CALCULUS = { name: 'Calculus', source_url: 'https://lemida.example/course/2' } as Course
const ITEM = { ref: 'r1', title: 'Lecture 1', kind: 'lecture', media: 'video', section: 'Week 1' }

function wrapper({ children }: { children: ReactNode }) {
  return createElement(DownloadsSessionProvider, { sendUpdate, children })
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
  sendUpdate.mockClear()
  toastConnectionError.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a failed discovery', () => {
  it('never selects the course, so no Loaded chip and no open panel', async () => {
    stubFetch(refused())
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))

    expect(result.current.state.selected).toBeNull()
    expect(result.current.state.pending).toBeNull()
    expect(result.current.state.items).toEqual([])
  })

  it('toasts exactly once', async () => {
    stubFetch(refused())
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))

    expect(sendUpdate).toHaveBeenCalledTimes(1)
    expect(sendUpdate.mock.calls[0][0]).toBe('error')
    expect(toastConnectionError).not.toHaveBeenCalled()
  })

  it('leaves the course already open, and its items, as they were', async () => {
    stubFetch(listed(), refused())
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))
    await act(() => result.current.actions.discover(CALCULUS))

    expect(result.current.state.selected).toBe('Algebra')
    expect(result.current.state.items.map((i) => i.ref)).toEqual(['r1'])
  })
})

describe("a failed discovery's toast", () => {
  it("renders the service's reason when the refusal carries a code", async () => {
    stubFetch(Response.json({ error: 'Moodle said no', code: 'moodle_ws_error' }, { status: 500 }))
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))

    expect(sendUpdate).toHaveBeenCalledTimes(1)
    expect(sendUpdate.mock.calls[0][1].props.failure.code).toBe('moodle_ws_error')
  })

  it('falls back to the generic line for a codeless refusal', async () => {
    stubFetch(refused())
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))

    expect(typeof sendUpdate.mock.calls[0][1]).toBe('string')
  })
})

describe('a discovery against a downed auto-downloader', () => {
  it('toasts once, through the shared connection toast, and selects nothing', async () => {
    stubFetch(new TypeError('Failed to fetch'))
    const { result } = render()

    await act(() => result.current.actions.discover(ALGEBRA))

    expect(toastConnectionError).toHaveBeenCalledTimes(1)
    expect(sendUpdate).not.toHaveBeenCalled()
    expect(result.current.state.selected).toBeNull()
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
