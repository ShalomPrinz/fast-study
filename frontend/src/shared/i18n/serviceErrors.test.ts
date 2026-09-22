import { describe, it, expect } from 'vitest'
import { failureId, resolveServiceError, serviceErrorRow, serviceErrorText } from './serviceErrors'

// Codes, never copy: what a row says is the catalogs' business and changes with every translation.
describe('serviceErrorRow', () => {
  it('has a row for a user-reachable code', () => {
    expect(serviceErrorRow('file_locked')).not.toBeNull()
  })

  it('has none for a developer-facing code, which renders the service prose', () => {
    expect(serviceErrorRow('unknown_step')).toBeNull()
  })

  it('has none for a code it has never heard of, or for no code at all', () => {
    expect(serviceErrorRow('invented_by_a_future_service')).toBeNull()
    expect(serviceErrorRow(null)).toBeNull()
    expect(serviceErrorRow(undefined)).toBeNull()
  })
})

describe('resolveServiceError', () => {
  it("falls back to the service's own prose when the code has no row", () => {
    const prose = 'data root is not writable: /x (Permission denied)'

    expect(resolveServiceError({ message: prose, code: 'unknown_step' })).toEqual({
      headline: prose,
      detail: null,
    })
    expect(resolveServiceError({ message: prose })).toEqual({ headline: prose, detail: null })
  })

  it('writes its own sentence for a known code, not the prose', () => {
    const { headline } = resolveServiceError({
      message: 'summary.pdf is open in another program. Close it and try again.',
      code: 'file_locked',
      params: { file: 'summary.pdf' },
    })

    expect(headline).not.toContain('summary.pdf is open in another program')
    expect(headline.length).toBeGreaterThan(0)
  })

  it('fills a named param into the sentence', () => {
    const { headline } = resolveServiceError({
      message: 'boom',
      code: 'file_delete_failed',
      params: { file: 'summary.pdf', detail: 'EBUSY' },
    })

    expect(headline).toContain('summary.pdf')
  })

  it('separates third-party text from the sentence instead of splicing it in', () => {
    const { headline, detail } = resolveServiceError({
      message: 'ffmpeg exited 1',
      code: 'audio_extraction_failed',
      params: { detail: 'ffmpeg exited 1' },
    })

    expect(detail).toBe('ffmpeg exited 1')
    expect(headline).not.toContain('ffmpeg exited 1')
  })

  it('carries no detail when the failure had none to carry', () => {
    expect(resolveServiceError({ message: 'x', code: 'drive_not_connected' }).detail).toBeNull()
    expect(
      resolveServiceError({ message: 'x', code: 'site_blocked', params: { detail: null } }).detail,
    ).toBeNull()
  })

  it("keeps the TeX engine's own words out of the frontend's frame", () => {
    const { headline, detail } = resolveServiceError({
      message: 'LaTeX error: Undefined control sequence (line 42: \\foo) and 2 more',
      code: 'latex_error',
      params: { message: 'Undefined control sequence', line: 42, at: '\\foo', more_count: 2 },
    })

    expect(detail).toBe('Undefined control sequence\nl.42 \\foo')
    expect(headline).not.toContain('Undefined control sequence')
  })

  it('picks a clause off an absent param the same way it does off a null one', () => {
    const named = resolveServiceError({ message: 'x', code: 'file_read_failed', params: {} })
    const nulled = resolveServiceError({
      message: 'x',
      code: 'file_read_failed',
      params: { file: null },
    })

    expect(nulled.headline).toBe(named.headline)
  })
})

describe('serviceErrorText', () => {
  it('folds the detail onto its own line, for an attribute that cannot hold markup', () => {
    const text = serviceErrorText({
      message: 'x',
      code: 'transcription_failed',
      params: { detail: 'Groq said no' },
    })

    expect(text.split('\n').at(-1)).toBe('Groq said no')
  })
})

describe('failureId', () => {
  it('identifies a failure by its facts, so the same one is reported once', () => {
    const one = { message: 'a', code: 'file_locked', params: { file: 'x.pdf' } }
    const same = { message: 'a', code: 'file_locked', params: { file: 'x.pdf' } }
    const other = { message: 'a', code: 'file_locked', params: { file: 'y.pdf' } }

    expect(failureId(one)).toBe(failureId(same))
    expect(failureId(one)).not.toBe(failureId(other))
  })
})
