import { describe, it, expect } from 'vitest'
import type { FileName, FileStatus } from '@/types'
import { PIPELINE, stepPosition, visiblePipeline } from './pipeline'

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

describe('visiblePipeline', () => {
  it('keeps every stage with Drive on', () => {
    expect(visiblePipeline(true, files([]))).toEqual(PIPELINE)
  })

  it('drops the Drive stage with Drive off', () => {
    const stages = visiblePipeline(false, files(['summary.pdf']))
    expect(stages.map((s) => s.file)).not.toContain('drive_url.txt')
    expect(stages).toHaveLength(PIPELINE.length - 1)
  })

  it('keeps the Drive stage with Drive off once the lecture was uploaded', () => {
    expect(visiblePipeline(false, files(['summary.pdf', 'drive_url.txt']))).toEqual(PIPELINE)
  })
})

describe('stepPosition', () => {
  it('numbers steps without counting the video', () => {
    expect(stepPosition(PIPELINE, 'audio')).toEqual({ number: 1, count: 5 })
    expect(stepPosition(PIPELINE, 'transcribe')).toEqual({ number: 2, count: 5 })
  })

  it('counts only the steps a lecture shows', () => {
    const stages = visiblePipeline(false, files(['video.mp4']))
    expect(stepPosition(stages, 'summarize')).toEqual({ number: 3, count: 4 })
    expect(stepPosition(stages, 'drive')).toBeNull()
  })
})
