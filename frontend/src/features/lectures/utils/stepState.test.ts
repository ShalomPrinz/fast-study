import { describe, expect, it } from 'vitest'
import type { RunError } from '@/types'
import { stageControl, stepState } from './stepState'

const error = (step: string, code: RunError['code'] = null): RunError => ({
  step,
  message: 'boom',
  code,
  params: {},
  provider: code ? 'gemini' : null,
  blocked: false,
  retry: null,
})

describe('stepState', () => {
  it('marks only the step the error names as failed', () => {
    expect(stepState(false, false, false, 'transcribe', error('transcribe'))).toBe('failed')
    expect(stepState(false, false, false, 'summarize', error('transcribe'))).toBe('pending')
  })

  it('gives a quota failure its own state', () => {
    expect(
      stepState(false, false, false, 'summarize', error('summarize', 'gemini_quota_exhausted')),
    ).toBe('quota')
  })

  it('lets an existing file or a running step outrank a stale error', () => {
    expect(stepState(false, true, false, 'summarize', error('summarize'))).toBe('done')
    expect(
      stepState(false, false, true, 'summarize', error('summarize', 'gemini_quota_exhausted')),
    ).toBe('running')
  })

  it('marks a removed file removed, over done, running and a stale error', () => {
    expect(stepState(true, true, false, undefined, null)).toBe('removed')
    expect(stepState(true, true, false, 'audio', error('audio'))).toBe('removed')
    expect(stepState(true, true, true, 'audio', null)).toBe('removed')
  })

  it('never marks a row without a step', () => {
    expect(stepState(false, false, false, undefined, error('audio'))).toBe('pending')
  })
})

describe('stageControl', () => {
  const row = {
    removed: false,
    exists: false,
    running: false,
    skipped: false,
    hasStep: true,
    canRotate: true,
  }

  it('gives a removed file only its label, never a run or rotate action', () => {
    // The markRemoved map reads a removed file as present.
    expect(stageControl({ ...row, removed: true, exists: true })).toBe('removed')
    expect(stageControl({ ...row, removed: true, exists: true, hasStep: false })).toBe('removed')
    expect(stageControl({ ...row, removed: true, exists: false })).toBe('removed')
  })

  it('offers rotate on a present step file once any step file exists', () => {
    expect(stageControl({ ...row, exists: true })).toBe('rotate')
    expect(stageControl({ ...row, exists: true, canRotate: false })).toBeNull()
    expect(stageControl({ ...row, exists: true, hasStep: false })).toBeNull()
  })

  it('offers run on a missing step file unless it is running', () => {
    expect(stageControl(row)).toBe('run')
    expect(stageControl({ ...row, running: true })).toBeNull()
  })

  it('labels a skipped stage and a missing stepless file', () => {
    expect(stageControl({ ...row, skipped: true })).toBe('skipped')
    expect(stageControl({ ...row, hasStep: false })).toBe('not-provided')
  })
})
