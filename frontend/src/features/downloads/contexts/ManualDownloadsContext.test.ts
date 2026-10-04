import { describe, it, expect } from 'vitest'
import {
  addManualEntry,
  isManualJob,
  manualEntries,
  retargetManualEntry,
} from './ManualDownloadsContext'

const request = {
  url: 'https://x.test/v',
  course: 'Algo',
  lecture: 'Lecture 3',
  kind: 'lecture' as const,
}
const target = { course: 'Algo', lecture: 'Lecture 3' }

describe('the manual downloads store', () => {
  it('lists the newest first and swaps a retried entry onto its new job, keeping its key', () => {
    addManualEntry(request, 'j1', target)
    addManualEntry({ ...request, lecture: 'Lecture 4' }, 'j2', { ...target, lecture: 'Lecture 4' })
    expect(manualEntries().map((e) => e.jobId)).toEqual(['j2', 'j1'])

    const key = manualEntries()[1].key
    retargetManualEntry(key, 'j3', target)
    expect(manualEntries()[1]).toMatchObject({ key, jobId: 'j3', request })
    expect(isManualJob('j3')).toBe(true)
    expect(isManualJob('j1')).toBe(false)
  })
})
