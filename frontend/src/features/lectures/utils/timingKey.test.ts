import { describe, it, expect } from 'vitest'
import type { FileName, FileStatus, MaterialInfo } from '@/types'
import { timingKey } from './timingKey'

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
    FILES.map((f) => [
      f,
      { exists: present.includes(f), size: present.includes(f) ? 7 : null, mtime: null },
    ]),
  ) as FileStatus

const MATS: MaterialInfo[] = [
  { name: 'material.pdf', size: 100, mtime: 1 },
  { name: 'material.2.pdf', size: 50, mtime: 1 },
]

describe('timingKey', () => {
  it('times a materials-only summarize on the summed material bytes', () => {
    expect(timingKey('summarize', files([]), MATS)).toEqual({
      operation: 'summarize_materials',
      bytes: 150,
    })
  })

  it('keys a transcript summarize on the transcript, materials or not', () => {
    expect(timingKey('summarize', files(['video.mp4', 'transcript.txt']), MATS)).toEqual({
      operation: 'summarize',
      bytes: 7,
    })
    expect(timingKey('summarize', files(['transcript.txt']), MATS)).toEqual({
      operation: 'summarize',
      bytes: 7,
    })
  })

  it('keys every other step on its input file', () => {
    expect(timingKey('pdf', files(['summary.md']), MATS)).toEqual({ operation: 'pdf', bytes: 7 })
    expect(timingKey('audio', files([]), [])).toEqual({ operation: 'audio', bytes: 0 })
  })
})
