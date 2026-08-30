import { describe, it, expect } from 'vitest'
import type { Course, FileName, FileStatus, Lecture } from '@/types'
import { courseProgress, isLectureComplete } from './lectureProgress'

const FILES: FileName[] = [
  'video.mp4',
  'audio.mp3',
  'transcript.txt',
  'transcript.partial.txt',
  'summary.md',
  'summary.pdf',
  'drive_url.txt',
]

const files = (present: FileName[]): FileStatus =>
  Object.fromEntries(
    FILES.map((f) => [f, { exists: present.includes(f), size: null, mtime: null }]),
  ) as FileStatus

const lecture = (name: string, present: FileName[]): Lecture => ({
  name,
  files: files(present),
  materials: [],
  transcribePartial: null,
})

const done = (name: string) => lecture(name, ['video.mp4', 'summary.pdf', 'drive_url.txt'])
const partial = (name: string) => lecture(name, ['video.mp4', 'summary.pdf'])
const noPdf = (name: string) => lecture(name, ['video.mp4', 'summary.md'])

const course = (over: Partial<Course>): Course => ({
  name: 'Course',
  archived: false,
  source_url: null,
  lectures: [],
  recitations: [],
  ...over,
})

describe('isLectureComplete', () => {
  it('is complete only once drive_url.txt exists, with Drive on', () => {
    expect(isLectureComplete(done('Lecture 1'), true)).toBe(true)
    expect(isLectureComplete(partial('Lecture 2'), true)).toBe(false)
  })

  it('stops at summary.pdf with Drive off', () => {
    expect(isLectureComplete(partial('Lecture 1'), false)).toBe(true)
    expect(isLectureComplete(done('Lecture 2'), false)).toBe(true)
    expect(isLectureComplete(noPdf('Lecture 3'), false)).toBe(false)
  })
})

describe('courseProgress', () => {
  it('counts every lecture when all are complete', () => {
    const c = course({ lectures: [done('Lecture 1'), done('Lecture 2')] })
    expect(courseProgress(c, true)).toEqual({ complete: 2, total: 2 })
  })

  it('counts recitations alongside lectures', () => {
    const c = course({
      lectures: [done('Lecture 1'), partial('Lecture 2')],
      recitations: [partial('Recitation 1')],
    })
    expect(courseProgress(c, true)).toEqual({ complete: 1, total: 3 })
  })

  it('reaches its total with Drive off and nothing uploaded', () => {
    const c = course({ lectures: [partial('Lecture 1'), partial('Lecture 2')] })
    expect(courseProgress(c, false)).toEqual({ complete: 2, total: 2 })
  })

  it('is 0/0 for a course with nothing in it', () => {
    expect(courseProgress(course({}), true)).toEqual({ complete: 0, total: 0 })
  })

  it('excludes an archived course from both numbers', () => {
    const c = course({ archived: true, lectures: [done('Lecture 1'), partial('Lecture 2')] })
    expect(courseProgress(c, true)).toEqual({ complete: 0, total: 0 })
  })
})
