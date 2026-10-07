import { describe, expect, it } from 'vitest'
import { isQuotaError } from './runError'

describe('isQuotaError', () => {
  it.each([
    'gemini_quota_exhausted',
    'gemini_quota_blocked',
    'groq_rate_limited',
    'groq_rate_limit_blocked',
  ])('is true for %s', (code) => {
    expect(isQuotaError(code)).toBe(true)
  })

  it('is false for a non-quota code', () => {
    expect(isQuotaError('ffmpeg_failed')).toBe(false)
  })

  it('is false for null, undefined and empty', () => {
    expect(isQuotaError(null)).toBe(false)
    expect(isQuotaError(undefined)).toBe(false)
    expect(isQuotaError('')).toBe(false)
  })
})
