import { describe, it, expect } from 'vitest'
import type { RunError, RunnerStatus } from '@/types'
import { isFiguresError } from '@/shared/utils/runError'
import { notQueuedState, notQueuedTitle } from '@/features/runner/utils/notQueued'
import { waitingRetries } from '@/features/runner/utils/runnerState'
import { figuresWarning } from './figuresWarning'

const idle = { pending: true, complete: false, stepsOpen: false, inflightStep: null }

function error(step: string, retry: RunError['retry'] = null): RunError {
  return {
    step,
    message: 'm',
    code: 'figure_boxes_failed',
    params: {},
    provider: null,
    blocked: false,
    retry,
  }
}

describe('figuresWarning', () => {
  it('shows nothing unless graphs wait', () => {
    expect(figuresWarning({ ...idle, pending: false })).toBeNull()
  })

  it('goes above the card when the pipeline is collapsed, in the Summary row otherwise', () => {
    expect(figuresWarning({ ...idle, complete: true })?.placement).toBe('banner')
    expect(figuresWarning(idle)?.placement).toBe('row')
  })

  it('also shows in the Summary row while the steps modal is open', () => {
    expect(figuresWarning({ ...idle, complete: true })?.inRow).toBe(false)
    expect(figuresWarning({ ...idle, complete: true, stepsOpen: true })?.inRow).toBe(true)
    expect(figuresWarning(idle)?.inRow).toBe(true)
  })

  it('allows Retry only while the lecture is idle', () => {
    expect(figuresWarning(idle)?.retryDisabled).toBe(false)
    expect(figuresWarning({ ...idle, inflightStep: 'summarize' })?.retryDisabled).toBe(true)
    expect(figuresWarning({ ...idle, inflightStep: 'figures' })?.retryDisabled).toBe(true)
  })

  it('reads as cropping only while the figures step runs', () => {
    expect(figuresWarning({ ...idle, inflightStep: 'figures' })?.cropping).toBe(true)
    expect(figuresWarning({ ...idle, inflightStep: 'pdf' })?.cropping).toBe(false)
    expect(figuresWarning(idle)?.cropping).toBe(false)
  })
})

describe('figures error record', () => {
  const item = { course: 'c', lecture: 'l', kind: 'lecture' as const }
  const key = 'c||l||lecture'

  it('is told apart from a stage failure', () => {
    expect(isFiguresError(error('figures'))).toBe(true)
    expect(isFiguresError(error('pdf'))).toBe(false)
    expect(isFiguresError(null)).toBe(false)
  })

  it('does not mark a not-queued lecture failed or give it an error tooltip', () => {
    const errors = { [key]: error('figures') }
    expect(notQueuedState(errors, item)).toBe('pending')
    expect(notQueuedTitle(errors, item)).toBeUndefined()
    expect(notQueuedState({ [key]: error('pdf') }, item)).toBe('failed')
  })

  it('stays out of the runner waiting list', () => {
    const retry = { attempt: 1, of: 3, at: '2026-01-01T00:00:00Z' }
    const errors: RunnerStatus['errors'] = { [key]: error('figures', retry) }
    expect(waitingRetries(errors)).toEqual([])
    expect(waitingRetries({ [key]: error('pdf', retry) })).toHaveLength(1)
  })
})
