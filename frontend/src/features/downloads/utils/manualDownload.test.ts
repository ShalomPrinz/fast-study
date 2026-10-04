import { describe, it, expect } from 'vitest'
import type { Course, Lecture } from '@/types'
import type { DownloadJob } from '@/features/downloads/services/downloadServer'
import { manualStatus, parseTarget, suggestManualName } from './manualDownload'

function job(status: DownloadJob['status']): DownloadJob {
  return {
    id: 'j',
    status,
    course: 'Algo',
    lecture: 'Lecture 3',
    kind: 'lecture',
    tool: 'yt-dlp',
    operation: null,
    ref: null,
    expectedBytes: null,
    startedAt: null,
    message: null,
  }
}

function course(name: string, lectures: string[], recitations: string[] = []): Course {
  const node = (n: string) => ({ name: n }) as Lecture
  return {
    name,
    archived: false,
    source_url: null,
    lectures: lectures.map(node),
    recitations: recitations.map(node),
  } as Course
}

describe('parseTarget', () => {
  it('splits course from lecture at the first slash', () => {
    expect(parseTarget('Algo/Lecture 3')).toEqual({ course: 'Algo', lecture: 'Lecture 3' })
  })

  it('rejects a target missing either half', () => {
    expect(parseTarget('Algo')).toBeNull()
    expect(parseTarget('/Lecture 3')).toBeNull()
    expect(parseTarget('Algo/')).toBeNull()
  })
})

describe('manualStatus', () => {
  it('follows the job while it is on /jobs, a queued one included', () => {
    expect(manualStatus(job('queued'), false)).toBe('running')
    expect(manualStatus(job('running'), true)).toBe('running')
    expect(manualStatus(job('done'), false)).toBe('done')
    expect(manualStatus(job('error'), true)).toBe('error')
  })

  it('reads an evicted job as done once the video is in the tree, else as not yet seen', () => {
    expect(manualStatus(null, true)).toBe('done')
    expect(manualStatus(null, false)).toBe('queued')
  })
})

describe('suggestManualName', () => {
  const courses = [course('Algo', ['Lecture 1', 'Lecture 2'], ['Recitation 1'])]

  it("is the tree's next name when nothing is claimed", () => {
    expect(suggestManualName(courses, 'Algo', 'lecture', [])).toBe('Lecture 3')
  })

  it('skips a name an in-flight manual download already claimed', () => {
    const claimed = [{ course: 'Algo', lecture: 'Lecture 3', kind: 'lecture' as const }]
    expect(suggestManualName(courses, 'Algo', 'lecture', claimed)).toBe('Lecture 4')
  })

  it('ignores claims on another course or the other kind', () => {
    const claimed = [
      { course: 'Logic', lecture: 'Lecture 9', kind: 'lecture' as const },
      { course: 'Algo', lecture: 'Recitation 5', kind: 'recitation' as const },
    ]
    expect(suggestManualName(courses, 'Algo', 'lecture', claimed)).toBe('Lecture 3')
    expect(suggestManualName(courses, 'Algo', 'recitation', claimed)).toBe('Recitation 6')
  })
})
