import { describe, it, expect } from 'vitest'
import type { RunnerStatus } from '@/types'
import type { Settings } from '@/services/settings'
import { isInitialized, missingEntries, type RequiredInput } from './required'
import { runsAtRisk } from './dataRootGuard'

const FILLED: RequiredInput = {
  geminiKey: 'AIzaabc',
  geminiKeyStored: false,
  groqKey: 'gsk_abc',
  groqKeyStored: false,
  dataRoot: '/data',
  dataRootConfirmed: true,
  driveEnabled: false,
  gdriveRootFolder: '',
}

describe('missingEntries', () => {
  it('is empty once the three required entries are filled', () => {
    expect(missingEntries(FILLED)).toEqual([])
  })

  it('accepts a key that is already in the store, since the field renders blank', () => {
    expect(missingEntries({ ...FILLED, geminiKey: '', geminiKeyStored: true })).toEqual([])
    expect(missingEntries({ ...FILLED, geminiKey: '', geminiKeyStored: false })).toEqual([
      'geminiApiKey',
    ])
  })

  it('holds a prefilled data root back until it is confirmed', () => {
    expect(missingEntries({ ...FILLED, dataRootConfirmed: false })).toEqual(['dataRoot'])
  })

  it('requires the Drive folder only while Drive is on', () => {
    expect(missingEntries({ ...FILLED, driveEnabled: true })).toEqual(['gdriveRootFolder'])
    expect(missingEntries({ ...FILLED, driveEnabled: true, gdriveRootFolder: 'Lectures' })).toEqual(
      [],
    )
  })

  it('names every missing entry at once', () => {
    expect(missingEntries({ ...FILLED, geminiKey: ' ', groqKey: '', dataRoot: '' })).toEqual([
      'geminiApiKey',
      'groqApiKey',
      'dataRoot',
    ])
  })
})

const STORE: Settings = {
  dataRoot: '/data',
  geminiApiKeySet: true,
  groqApiKeySet: true,
  geminiModel: null,
  driveEnabled: null,
  gdriveRootFolder: null,
  autoRun: null,
}

describe('isInitialized', () => {
  it('passes once both keys and a data root are stored', () => {
    expect(isInitialized(STORE)).toBe(true)
  })

  it('holds the wall up for any one of the three', () => {
    expect(isInitialized({ ...STORE, geminiApiKeySet: false })).toBe(false)
    expect(isInitialized({ ...STORE, groqApiKeySet: false })).toBe(false)
    expect(isInitialized({ ...STORE, dataRoot: null })).toBe(false)
  })

  it('is not blocked by anything else being unset', () => {
    expect(isInitialized({ ...STORE, driveEnabled: null, geminiModel: null })).toBe(true)
  })
})

function status(running: boolean, lectures: string[]): RunnerStatus {
  return {
    runner: { running, total: lectures.length, done: 0, lastError: null },
    queue: [],
    inFlight: lectures.map((lecture) => ({
      course: 'Algebra',
      lecture,
      kind: 'lecture' as const,
      step: 'transcribe',
      startedAt: '',
      sleepingUntil: null,
      progress: null,
    })),
    errors: {},
  }
}

describe('runsAtRisk', () => {
  it('ignores a save that leaves the data root alone', () => {
    expect(runsAtRisk({ geminiModel: 'gemini-3.5-flash' }, status(true, ['Lecture 1']))).toBeNull()
  })

  it('names the runs in flight when the data root changes', () => {
    expect(runsAtRisk({ dataRoot: '/new' }, status(true, ['Lecture 1', 'Lecture 2']))).toEqual([
      'Algebra / Lecture 1',
      'Algebra / Lecture 2',
    ])
  })

  it('still warns while the runner sweeps with nothing yet in flight', () => {
    expect(runsAtRisk({ dataRoot: '/new' }, status(true, []))).toEqual([])
  })

  it('stays quiet when nothing is running at all', () => {
    expect(runsAtRisk({ dataRoot: '/new' }, status(false, []))).toBeNull()
    expect(runsAtRisk({ dataRoot: '/new' }, null)).toBeNull()
  })
})
