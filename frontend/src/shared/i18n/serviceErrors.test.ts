import { describe, it, expect } from 'vitest'
import {
  failedRunSentence,
  failureId,
  resolveServiceError,
  rowFor,
  serviceErrorRow,
  serviceErrorText,
} from './serviceErrors'

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
  it('falls back to a generic headline over the prose when the code has no row', () => {
    const prose = 'data root is not writable: /x (Permission denied)'
    const withCode = resolveServiceError({ message: prose, code: 'unknown_step' })
    const noCode = resolveServiceError({ message: prose })

    expect(withCode.detail).toBe(prose)
    expect(withCode.headline).not.toBe(prose)
    expect(withCode.headline.length).toBeGreaterThan(0)
    expect(noCode).toEqual(withCode)
  })

  it('has no detail for a row-less failure with empty prose', () => {
    expect(resolveServiceError({ message: '', code: 'unknown_step' }).detail).toBeNull()
  })

  it('has rows for the settings IPC codes', () => {
    for (const code of [
      'unknown_setting',
      'setting_must_be_string',
      'setting_must_be_boolean',
      'setting_must_be_integer',
      'setting_invalid_choice',
      'setting_out_of_range',
    ]) {
      expect(serviceErrorRow(code), code).not.toBeNull()
    }
    const { headline, detail } = resolveServiceError({
      message: 'unknown setting: bogus',
      code: 'unknown_setting',
      params: { field: 'bogus' },
    })
    expect(headline).toContain('bogus')
    expect(detail).toBeNull()
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

  it('withholds the OS text entirely when the app files were blocked', () => {
    const prose = "[Errno 22] Invalid argument: 'C:\\FastStudy\\faststudy-services.exe'"
    const resolved = resolveServiceError({ message: prose, code: 'app_files_blocked', params: {} })

    expect(resolved.detail).toBeNull()
    expect(resolved.headline).not.toContain('Errno')
    expect(serviceErrorText({ message: prose, code: 'app_files_blocked', params: {} })).toBe(
      resolved.headline,
    )
  })

  it('names the locked file, and still says something when the file is not given', () => {
    const of = (params: Record<string, string | null>) =>
      resolveServiceError({ message: 'x', code: 'file_locked', params }).headline

    expect(of({ file: 'summary.md' })).toContain('summary.md')
    expect(of({ file: 'summary.md' })).not.toBe(of({ file: 'summary.pdf' }))
    expect(of({})).not.toContain('{file}')
    expect(of({ file: null })).toBe(of({}))
  })

  it('names the overloaded Gemini model, and still says something when the model is not given', () => {
    const prose = 'Gemini model gemini-2.5-pro is overloaded right now (503)'
    const of = (params: Record<string, string | null>) =>
      resolveServiceError({ message: prose, code: 'gemini_overloaded', params }).headline

    expect(of({ model: 'gemini-2.5-pro' })).toContain('gemini-2.5-pro')
    expect(of({ model: 'gemini-2.5-pro' })).not.toBe(prose)
    expect(of({ model: 'gemini-2.5-pro' })).not.toBe(of({ model: 'gemini-2.5-flash' }))
    expect(of({})).not.toContain('{model}')
    expect(of({ model: null })).toBe(of({}))
  })

  it('tells a user-typed name apart from a caller bug in the same invalid_request code', () => {
    const prose = 'course and name with a legal character are required'
    const of = (field: string) =>
      resolveServiceError({ message: prose, code: 'invalid_request', params: { field } }).headline

    expect(of('name')).not.toBe(prose)
    expect(of('name')).not.toBe(of('ref'))
    expect(of('course')).not.toBe(of('ref'))
  })

  it('never advises running a step for a missing video, which only a download produces', () => {
    const of = (file: string, step: string) =>
      resolveServiceError({ message: 'x', code: 'missing_prerequisite', params: { file, step } })
        .headline

    expect(of('video.mp4', 'download')).not.toBe(of('video.mp4', 'audio'))
    expect(of('video.mp4', 'download')).toContain('video.mp4')
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

describe('rowFor', () => {
  const quota = (params: Record<string, string>, retry?: unknown) => ({
    message: '',
    code: 'gemini_quota_exhausted',
    params,
    retry,
  })
  const retry = { attempt: 1, of: 3, at: '2026-01-01T00:00:00Z' }

  it('drops the advice for a per-minute quota with a waiting retry', () => {
    expect(rowFor(quota({ scope: 'minute' }, retry))).not.toBe(
      serviceErrorRow('gemini_quota_exhausted'),
    )
    expect(rowFor(quota({}, retry))).not.toBe(serviceErrorRow('gemini_quota_exhausted'))
  })

  it('keeps the catalog row with no retry waiting', () => {
    expect(rowFor(quota({ scope: 'minute' }))).toBe(serviceErrorRow('gemini_quota_exhausted'))
    expect(rowFor(quota({ scope: 'minute' }, null))).toBe(serviceErrorRow('gemini_quota_exhausted'))
  })

  it('keeps the daily row even with a retry', () => {
    expect(rowFor(quota({ scope: 'daily' }, retry))).toBe(serviceErrorRow('gemini_quota_exhausted'))
  })

  describe.each(['gemini_overloaded', 'gemini_timeout', 'gemini_unreachable'])('%s', (code) => {
    const failure = (retry?: unknown, params: Record<string, string> = { seconds: '60' }) => ({
      message: '',
      code,
      params,
      retry,
    })
    const advice = /try again/i

    it('drops the try-again advice, with and without a model, while a retry waits', () => {
      const row = rowFor(failure(retry))!
      expect(row).not.toBe(serviceErrorRow(code))
      expect(row.message).toContain('undefined {')
      expect(row.message).toContain('other {')
      expect(row.message).not.toMatch(advice)
      expect(rowFor(failure(retry, { model: 'gemini-x' }))).toBe(row)
    })

    it('keeps the catalog row with no retry waiting', () => {
      expect(rowFor(failure())).toBe(serviceErrorRow(code))
      expect(rowFor(failure(null, { model: 'gemini-x' }))).toBe(serviceErrorRow(code))
    })
  })
})

describe('site_unreachable proxy hint', () => {
  const base = { message: 'x', code: 'site_unreachable' }
  it('adds a hint line when proxy is present, for both values', () => {
    for (const proxy of ['env', 'system']) {
      const { hint, headline } = resolveServiceError({ ...base, params: { host: 'h', proxy } })
      expect(hint).toBeTruthy()
      expect(headline).not.toBe(hint)
    }
  })
  it('adds none when proxy is absent or null', () => {
    expect(resolveServiceError({ ...base, params: { host: 'h' } }).hint).toBeNull()
    expect(resolveServiceError({ ...base, params: { host: 'h', proxy: null } }).hint).toBeNull()
  })
})

describe('failedRunSentence', () => {
  const retry = { attempt: 1, of: 3, at: '2026-01-01T00:00:00Z' }
  const lecture = {
    kind: 'lecture',
    step: 'summarize',
    course: 'Calculus',
    lecture: 'Lecture 3',
  } as const
  const fail = (code: string, params: Record<string, string | null> = {}, retry?: unknown) => ({
    message: 'prose',
    code,
    params,
    retry,
  })
  const strip = (s: string | null) => s?.replace(/[\u2068\u2069]/g, '')

  it.each(['gemini_overloaded', 'gemini_timeout', 'gemini_unreachable', 'gemini_quota_exhausted'])(
    'names the lecture, course and model for %s',
    (code) => {
      const sentence = strip(
        failedRunSentence(fail(code, { model: 'gemini-x', seconds: '60' }), lecture),
      )
      expect(sentence).toContain('Lecture 3')
      expect(sentence).toContain('Calculus')
      if (code !== 'gemini_quota_exhausted') expect(sentence).toContain('gemini-x')
    },
  )

  it('is null for any other code, which keeps the lead and headline', () => {
    expect(failedRunSentence(fail('summarization_failed'), lecture)).toBeNull()
    expect(failedRunSentence(fail('gemini_quota_blocked'), lecture)).toBeNull()
    expect(failedRunSentence({ message: 'x' }, lecture)).toBeNull()
  })

  it('isolates each name so a mixed-script sentence keeps its order', () => {
    const sentence = failedRunSentence(fail('gemini_overloaded', { model: 'gemini-x' }), lecture)!
    for (const name of ['Lecture 3', 'Calculus', 'gemini-x']) {
      expect(sentence).toContain(`\u2068${name}\u2069`)
    }
  })

  it('reads the same with a null model as with none', () => {
    expect(failedRunSentence(fail('gemini_overloaded', { model: null }), lecture)).toBe(
      failedRunSentence(fail('gemini_overloaded'), lecture),
    )
  })

  it('names the step that failed, not always the summary', () => {
    const summary = failedRunSentence(fail('gemini_overloaded'), lecture)
    const other = failedRunSentence(fail('gemini_overloaded'), { ...lecture, step: 'transcribe' })
    const intuition = failedRunSentence(fail('gemini_overloaded'), {
      kind: 'assignment',
      step: 'intuition',
      course: 'Calculus',
      assignment: 'HW 2',
    })
    const solution = failedRunSentence(fail('gemini_overloaded'), {
      kind: 'assignment',
      step: 'solution',
      course: 'Calculus',
      assignment: 'HW 2',
    })
    expect(new Set([summary, other, intuition, solution]).size).toBe(4)
    expect(strip(intuition)).toContain('HW 2')
  })

  it('names only the course and branch for an overview phase', () => {
    const run = {
      kind: 'overview',
      phase: 'analyze',
      title: 'Exam Hints',
      course: 'Calculus',
    } as const
    const analyze = strip(failedRunSentence(fail('gemini_timeout', { seconds: '60' }), run))
    const noPhase = failedRunSentence(fail('gemini_timeout', { seconds: '60' }), {
      ...run,
      phase: null,
    })
    expect(analyze).toContain('Exam Hints')
    expect(analyze).toContain('Calculus')
    expect(noPhase).not.toBe(failedRunSentence(fail('gemini_timeout', { seconds: '60' }), run))
  })

  it('gives no try-again advice, so a waiting retry never contradicts it', () => {
    for (const code of ['gemini_overloaded', 'gemini_timeout', 'gemini_unreachable']) {
      expect(failedRunSentence(fail(code, {}, retry), lecture)).not.toMatch(/try again/i)
      expect(failedRunSentence(fail(code), lecture)).toBe(
        failedRunSentence(fail(code, {}, retry), lecture),
      )
    }
  })
})
