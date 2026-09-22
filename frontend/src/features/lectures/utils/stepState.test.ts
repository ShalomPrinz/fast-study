import { describe, expect, it } from 'vitest'
import type { RunError } from '@/types'
import { stepState } from './stepState'

const error = (step: string, code: RunError['code'] = null): RunError => ({
  step,
  message: 'boom',
  code,
  params: {},
  provider: code ? 'gemini' : null,
  blocked: false,
})

describe('stepState', () => {
  it('marks only the step the error names as failed', () => {
    expect(stepState(false, false, 'transcribe', error('transcribe'))).toBe('failed')
    expect(stepState(false, false, 'summarize', error('transcribe'))).toBe('pending')
  })

  it('gives a quota failure its own state', () => {
    expect(stepState(false, false, 'summarize', error('summarize', 'gemini_quota_exhausted'))).toBe(
      'quota',
    )
  })

  it('lets an existing file or a running step outrank a stale error', () => {
    expect(stepState(true, false, 'summarize', error('summarize'))).toBe('done')
    expect(stepState(false, true, 'summarize', error('summarize', 'gemini_quota_exhausted'))).toBe(
      'running',
    )
  })

  it('never marks a row without a step', () => {
    expect(stepState(false, false, undefined, error('audio'))).toBe('pending')
  })
})
