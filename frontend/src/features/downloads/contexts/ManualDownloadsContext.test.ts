import { describe, it, expect } from 'vitest'
import {
  addManualEntry,
  isManualJob,
  manualDraft,
  manualEntries,
  retargetManualEntry,
  updateManualDraft,
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

describe('the manual form draft', () => {
  it('starts empty and merges each edit, leaving the other fields as they were', () => {
    expect(manualDraft()).toEqual({
      source: 'link',
      file: null,
      url: '',
      course: null,
      kind: 'lecture',
      name: null,
    })
    updateManualDraft({ url: 'https://x.test/v', course: 'New course' })
    updateManualDraft({ kind: 'recitation', name: 'Recitation 2' })
    updateManualDraft({ name: null })
    expect(manualDraft()).toEqual({
      source: 'link',
      file: null,
      url: 'https://x.test/v',
      course: 'New course',
      kind: 'recitation',
      name: null,
    })
  })

  it('keeps the chosen file and source across edits to other fields', () => {
    const file = new File(['x'], 'lecture.mp4')
    updateManualDraft({ source: 'file', file })
    updateManualDraft({ name: 'Lecture 1' })
    expect(manualDraft()).toMatchObject({ source: 'file', file, name: 'Lecture 1' })
    updateManualDraft({ file: null, source: 'link' })
    expect(manualDraft().file).toBeNull()
  })
})
