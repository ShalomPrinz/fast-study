import { describe, it, expect } from 'vitest'
import type { DownloadJob } from '../services/downloadServer'
import { groupJobsByRef } from '../contexts/DownloadJobsContext'
import type { Tally, Verdicts } from './runSummary'
import { isRunSettled, recordVerdicts, summarize } from './runSummary'

function verdict(status: 'done' | 'error', ...jobIds: string[]) {
  return { status, jobIds }
}

function job(over: Partial<DownloadJob> & Pick<DownloadJob, 'id'>): DownloadJob {
  return {
    status: 'running',
    course: 'Algo',
    lecture: 'lecture 1',
    kind: 'lecture',
    tool: null,
    operation: null,
    ref: 'r1',
    expectedBytes: null,
    startedAt: null,
    message: null,
    ...over,
  }
}

function tally(over: Partial<Tally> = {}): Tally {
  return { failed: 0, skipped: 0, unsupported: 0, ...over }
}

describe('summarize', () => {
  it('counts a started row as downloaded only when its verdict is done', () => {
    const verdicts = { r1: verdict('done', 'a'), r2: verdict('error', 'b') }
    expect(summarize(tally(), ['r1', 'r2'], verdicts)).toBe('1 downloaded, 1 failed')
  })

  it('omits every zero part and keeps the tallied ones', () => {
    expect(summarize(tally({ skipped: 2, unsupported: 1 }), [], {})).toBe(
      '0 downloaded, 1 unsupported, 2 already there',
    )
  })
})

// The provider freezes the summary from exactly this predicate, so the tests call it rather than a copy.
function frozen(
  outcome: Tally | null,
  started: readonly string[],
  verdicts: Verdicts,
): string | null {
  return isRunSettled(outcome, started, verdicts) ? summarize(outcome, started, verdicts) : null
}

describe('isRunSettled', () => {
  it('never settles mid-run, even with a verdict for every ref triggered so far', () => {
    expect(frozen(null, ['r1'], { r1: verdict('done', 'a') })).toBeNull()
    expect(frozen(tally(), ['r1'], { r1: verdict('done', 'a') })).toBe('1 downloaded')
  })

  it('keeps a verdict recorded during triggering after its job is evicted', () => {
    // r1 settles and is recorded while the queue is still triggering — no outcome yet.
    const first =
      recordVerdicts(
        ['r1'],
        groupJobsByRef([job({ id: 'a', ref: 'r1', status: 'done' })]),
        {},
        {},
      ) ?? {}
    expect(frozen(null, ['r1'], first)).toBeNull()
    // 60s on r1's done job is gone, and the queue has since triggered r2 and finished.
    const evicted = groupJobsByRef([job({ id: 'b', ref: 'r2', status: 'done' })])
    const second = recordVerdicts(['r1', 'r2'], evicted, first, {}) ?? first
    expect(frozen(tally(), ['r1', 'r2'], second)).toBe('2 downloaded')
  })
})

describe('recordVerdicts', () => {
  it('records nothing new when a run started nothing', () => {
    expect(recordVerdicts([], groupJobsByRef([]), {}, {})).toBeNull()
    expect(isRunSettled(tally(), [], {})).toBe(true)
  })

  it('records a row as error when any of its jobs failed', () => {
    const byRef = groupJobsByRef([
      job({ id: 'a', ref: 'r1', status: 'done' }),
      job({ id: 'b', ref: 'r1', status: 'error' }),
    ])
    expect(recordVerdicts(['r1'], byRef, {}, {})).toEqual({ r1: verdict('error', 'a', 'b') })
  })

  it('leaves a still-running row and one with no jobs yet unsettled', () => {
    const byRef = groupJobsByRef([
      job({ id: 'a', ref: 'r1', status: 'done' }),
      job({ id: 'b', ref: 'r2' }),
    ])
    const verdicts = recordVerdicts(['r1', 'r2', 'r3'], byRef, {}, {}) ?? {}
    expect(verdicts).toEqual({ r1: verdict('done', 'a') })
    expect(isRunSettled(tally(), ['r1', 'r2', 'r3'], verdicts)).toBe(false)
  })

  it('keeps a verdict after the server evicts its done job', () => {
    const first = recordVerdicts(
      ['r1', 'r2'],
      groupJobsByRef([job({ id: 'a', ref: 'r1', status: 'done' }), job({ id: 'b', ref: 'r2' })]),
      {},
      {},
    )
    expect(isRunSettled(tally(), ['r1', 'r2'], first ?? {})).toBe(false)
    // 60s on: r1's done job is gone from `/jobs`, and r2 has just finished.
    const evicted = groupJobsByRef([job({ id: 'b', ref: 'r2', status: 'done' })])
    const second = recordVerdicts(['r1', 'r2'], evicted, first ?? {}, {}) ?? {}
    expect(isRunSettled(tally(), ['r1', 'r2'], second)).toBe(true)
    expect(summarize(tally(), ['r1', 'r2'], second)).toBe('2 downloaded')
  })

  it('ignores the jobs a re-triggered ref already had, then records the new one', () => {
    // A previous run left r1 failed, and the server never time-evicts an `error` job.
    const stale = { r1: ['a'] }
    const before = groupJobsByRef([job({ id: 'a', ref: 'r1', status: 'error' })])
    expect(recordVerdicts(['r1'], before, {}, stale)).toBeNull()
    // The retry's own job supersedes it in the next snapshot, and its status is the verdict.
    const after = groupJobsByRef([job({ id: 'b', ref: 'r1', status: 'done' })])
    expect(recordVerdicts(['r1'], after, {}, stale)).toEqual({ r1: verdict('done', 'b') })
  })

  it('returns null once every started ref already has a verdict', () => {
    const byRef = groupJobsByRef([job({ id: 'a', ref: 'r1', status: 'done' })])
    expect(recordVerdicts(['r1'], byRef, { r1: verdict('done', 'a') }, {})).toBeNull()
  })

  it('drops a verdict when a retry queues a job it was not derived from', () => {
    // A bulk run of r1 and r2: r2 fails and is recorded while r1 is still downloading.
    const first =
      recordVerdicts(
        ['r1', 'r2'],
        groupJobsByRef([job({ id: 'a', ref: 'r2', status: 'error' })]),
        {},
        {},
      ) ?? {}
    expect(first).toEqual({ r2: verdict('error', 'a') })
    // The user retries r2 from its row; the retry's job supersedes the failed one server-side.
    const retried = groupJobsByRef([job({ id: 'b', ref: 'r2' })])
    const second = recordVerdicts(['r1', 'r2'], retried, first, {}) ?? first
    expect(second).toEqual({})
    // r1 lands meanwhile and the queue is done — the run must still wait for the retry.
    const landed = groupJobsByRef([
      job({ id: 'c', ref: 'r1', status: 'done' }),
      job({ id: 'b', ref: 'r2' }),
    ])
    const third = recordVerdicts(['r1', 'r2'], landed, second, {}) ?? second
    expect(frozen(tally(), ['r1', 'r2'], third)).toBeNull()
    // The retry succeeds, and the summary reports the corrected count rather than the old failure.
    const done = groupJobsByRef([job({ id: 'b', ref: 'r2', status: 'done' })])
    const fourth = recordVerdicts(['r1', 'r2'], done, third, {}) ?? third
    expect(frozen(tally(), ['r1', 'r2'], fourth)).toBe('2 downloaded')
  })

  it('keeps a verdict when its jobs are merely gone, not superseded', () => {
    const evicted = groupJobsByRef([job({ id: 'b', ref: 'r2', status: 'done' })])
    expect(recordVerdicts(['r1'], evicted, { r1: verdict('done', 'a') }, {})).toBeNull()
  })
})
