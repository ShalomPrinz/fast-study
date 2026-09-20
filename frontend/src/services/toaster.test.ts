import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toastInitResult } from './toaster'

const { error } = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('react-toastify', () => ({ ToastContainer: () => null, toast: { error } }))

beforeEach(() => {
  error.mockClear()
})

describe('toastInitResult', () => {
  it('reports a busy run with the caller’s wording', () => {
    toastInitResult({ status: 'busy' }, { busy: 'Step already running' })

    expect(error).toHaveBeenCalledWith('Step already running')
  })

  it('says nothing about a started run — SSE reports its progress', () => {
    toastInitResult({ status: 'started' }, { busy: 'Step already running' })

    expect(error).not.toHaveBeenCalled()
  })
})
