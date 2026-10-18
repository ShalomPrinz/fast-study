import { describe, it, expect } from 'vitest'
import type { Course, FileName, FileStatus, Lecture, MaterialInfo } from '@/types'
import {
  canRunRemaining,
  courseProgress,
  isLectureComplete,
  isMaterialsOnly,
  skippedStage,
  stagePrereqMet,
  summarizedFromMaterials,
} from './lectureProgress'

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

const MATS: MaterialInfo[] = [{ name: 'material.pdf', size: 100, mtime: 1 }]
const SUMMARIZE = { file: 'summary.md' as FileName, prereq: 'transcript.txt' as FileName }
const PDF = { file: 'summary.pdf' as FileName, prereq: 'summary.md' as FileName }

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

describe('canRunRemaining', () => {
  it('runs a lecture whose next step has its input', () => {
    expect(canRunRemaining(files(['video.mp4']), [], true)).toBe(true)
    expect(canRunRemaining(files(['video.mp4', 'transcript.txt']), [], true)).toBe(true)
    expect(canRunRemaining(files(['video.mp4', 'audio.mp3', 'transcript.txt']), [], true)).toBe(
      true,
    )
  })

  it('refuses a lecture with no video, whose first step cannot start', () => {
    expect(canRunRemaining(files([]), [], true)).toBe(false)
    expect(canRunRemaining(files(['transcript.txt', 'summary.md']), [], true)).toBe(false)
  })

  it('refuses a complete lecture even with an earlier output missing', () => {
    expect(canRunRemaining(files(['video.mp4', 'summary.md', 'drive_url.txt']), [], true)).toBe(
      false,
    )
    expect(canRunRemaining(files(['video.mp4', 'summary.pdf']), [], false)).toBe(false)
  })

  it('stops at summary.pdf with Drive off', () => {
    const upToPdf = files(['video.mp4', 'audio.mp3', 'transcript.txt', 'summary.md'])
    expect(canRunRemaining(upToPdf, [], false)).toBe(true)
  })

  it('runs a materials-only lecture straight to summarize', () => {
    expect(canRunRemaining(files([]), MATS, true)).toBe(true)
    expect(canRunRemaining(files(['summary.md']), MATS, false)).toBe(true)
    expect(canRunRemaining(files(['summary.md', 'summary.pdf']), MATS, false)).toBe(false)
  })

  it('refuses a lecture with neither a video nor materials', () => {
    expect(canRunRemaining(files([]), [], true)).toBe(false)
  })

  it('keeps a lecture with a video on its normal chain, materials or not', () => {
    expect(canRunRemaining(files(['video.mp4']), MATS, true)).toBe(true)
    expect(canRunRemaining(files(['video.mp4', 'audio.mp3']), MATS, true)).toBe(true)
  })
})

describe('materials-only predicates', () => {
  it('is materials-only with materials and no video', () => {
    expect(isMaterialsOnly(files([]), MATS)).toBe(true)
    expect(isMaterialsOnly(files([]), [])).toBe(false)
    expect(isMaterialsOnly(files(['video.mp4']), MATS)).toBe(false)
    expect(isMaterialsOnly(files(['audio.mp3']), MATS)).toBe(false)
  })

  it('keeps a lecture with audio but no video on the normal chain from transcribe', () => {
    const audioOnly = files(['audio.mp3'])
    expect(skippedStage('transcript.txt', audioOnly, MATS)).toBe(false)
    expect(stagePrereqMet(SUMMARIZE, audioOnly, MATS)).toBe(false)
    expect(canRunRemaining(audioOnly, MATS, true)).toBe(true)
  })

  it('skips the video, audio and transcript stages while materials-only', () => {
    for (const f of ['video.mp4', 'audio.mp3', 'transcript.txt'] as FileName[]) {
      expect(skippedStage(f, files([]), MATS)).toBe(true)
      expect(skippedStage(f, files([]), [])).toBe(false)
      expect(skippedStage(f, files(['video.mp4']), MATS)).toBe(false)
    }
    expect(skippedStage('summary.md', files([]), MATS)).toBe(false)
  })

  it('does not skip a stage whose file is there', () => {
    expect(skippedStage('transcript.txt', files(['transcript.txt']), MATS)).toBe(false)
  })

  it('meets summarize from materials alone, and nothing else', () => {
    expect(stagePrereqMet(SUMMARIZE, files([]), MATS)).toBe(true)
    expect(stagePrereqMet(SUMMARIZE, files([]), [])).toBe(false)
    expect(stagePrereqMet(SUMMARIZE, files(['video.mp4']), MATS)).toBe(false)
    expect(stagePrereqMet(SUMMARIZE, files(['video.mp4', 'transcript.txt']), [])).toBe(true)
    expect(stagePrereqMet(PDF, files([]), MATS)).toBe(false)
    expect(stagePrereqMet({ file: 'video.mp4' }, files([]), [])).toBe(true)
  })

  it('reads a summary with no transcript on a materials-only lecture as made from materials', () => {
    expect(summarizedFromMaterials(files(['summary.md']), MATS)).toBe(true)
    expect(summarizedFromMaterials(files([]), MATS)).toBe(false)
    expect(summarizedFromMaterials(files(['summary.md', 'transcript.txt']), MATS)).toBe(false)
    expect(summarizedFromMaterials(files(['video.mp4', 'summary.md']), MATS)).toBe(false)
    expect(summarizedFromMaterials(files(['summary.md']), [])).toBe(false)
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
