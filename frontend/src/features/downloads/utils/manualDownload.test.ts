import { describe, it, expect } from 'vitest'
import type { Course, Lecture } from '@/types'
import type { DownloadJob } from '@/features/downloads/services/downloadServer'
import {
  manualStatus,
  matchCourse,
  onMoodleSite,
  parseTarget,
  suggestManualName,
} from './manualDownload'

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

  it('starts a course the tree lacks from the first name, since the download creates it', () => {
    expect(suggestManualName(courses, 'New', 'lecture', [])).toBe('Lecture 1')
    expect(suggestManualName(courses, 'New', 'recitation', [])).toBe('Recitation 1')
  })
})

describe('matchCourse', () => {
  const active = [{ name: 'Algo', lectures: [] }] as unknown as Course[]

  it('answers the stored spelling of a course typed in another case or padded', () => {
    expect(matchCourse(active, '  aLGO ')).toBe('Algo')
  })

  it('answers null for a name no active course has, which makes it a new course', () => {
    expect(matchCourse(active, 'Algo 2')).toBeNull()
    expect(matchCourse([], 'Algo')).toBeNull()
  })
})

describe('onMoodleSite', () => {
  const SITE = 'https://moodle.example.ac.il'

  it('is true for any link on the configured site, path and query aside', () => {
    expect(onMoodleSite('https://moodle.example.ac.il/pluginfile.php/1/v.mp4?x=1', SITE)).toBe(true)
    expect(onMoodleSite('  https://MOODLE.example.ac.il/mod/url/view.php  ', `${SITE}/`)).toBe(true)
  })

  it('compares origins, so a sibling host, another scheme or port is not the site', () => {
    expect(onMoodleSite('https://www.youtube.com/watch?v=x', SITE)).toBe(false)
    expect(onMoodleSite('https://cdn.moodle.example.ac.il/v.mp4', SITE)).toBe(false)
    expect(onMoodleSite('http://moodle.example.ac.il/v.mp4', SITE)).toBe(false)
    expect(onMoodleSite('https://moodle.example.ac.il:8443/v.mp4', SITE)).toBe(false)
  })

  it('is false with no configured site or an unparseable link', () => {
    expect(onMoodleSite('https://moodle.example.ac.il/v.mp4', null)).toBe(false)
    expect(onMoodleSite('https://moodle.example.ac.il/v.mp4', '')).toBe(false)
    expect(onMoodleSite('moodle.example.ac.il/v.mp4', SITE)).toBe(false)
    expect(onMoodleSite('', SITE)).toBe(false)
  })
})
