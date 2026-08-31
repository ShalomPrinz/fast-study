import { describe, it, expect } from 'vitest'
import type { Course, FileStatus, InFlightEntry, Lecture, QueueEntry } from '@/types'
import { notQueued } from './notQueued'

function files(...present: string[]): FileStatus {
  const names = [
    'video.mp4',
    'audio.mp3',
    'transcript.txt',
    'transcript.partial.txt',
    'summary.md',
    'summary.pdf',
    'drive_url.txt',
  ] as const
  return Object.fromEntries(
    names.map((n) => [n, { exists: present.includes(n), size: null, mtime: null }]),
  ) as FileStatus
}

function lecture(name: string, ...present: string[]): Lecture {
  return { name, files: files(...present), materials: [], transcribePartial: null }
}

function course(name: string, lectures: Lecture[], recitations: Lecture[] = []): Course {
  return { name, archived: false, source_url: null, lectures, recitations }
}

const queued = (c: string, l: string): QueueEntry => ({
  course: c,
  lecture: l,
  kind: 'lecture',
  depth: 'full',
})

const running = (c: string, l: string): InFlightEntry => ({
  course: c,
  lecture: l,
  kind: 'lecture',
  step: 'transcribe',
  startedAt: '2026-01-01T00:00:00Z',
  sleepingUntil: null,
  progress: null,
})

describe('notQueued', () => {
  it('keeps a lecture with a video and no final output', () => {
    const tree = [course('C1', [lecture('L1', 'video.mp4', 'audio.mp3')])]
    expect(notQueued(tree, [], [], false)).toEqual([
      { course: 'C1', lecture: 'L1', kind: 'lecture' },
    ])
  })

  it('drops a lecture with no video and one already complete', () => {
    const tree = [
      course('C1', [
        lecture('no_video'),
        lecture('done', 'video.mp4', 'summary.pdf'),
        lecture('pending', 'video.mp4'),
      ]),
    ]
    expect(notQueued(tree, [], [], false).map((e) => e.lecture)).toEqual(['pending'])
  })

  it('reads completion against the Drive setting, the way the runner does', () => {
    const tree = [course('C1', [lecture('L1', 'video.mp4', 'summary.pdf')])]
    expect(notQueued(tree, [], [], false)).toEqual([])
    expect(notQueued(tree, [], [], true).map((e) => e.lecture)).toEqual(['L1'])
  })

  it('subtracts the queue and the in-flight entries', () => {
    const tree = [
      course('C1', [
        lecture('queued', 'video.mp4'),
        lecture('running', 'video.mp4'),
        lecture('nobody', 'video.mp4'),
      ]),
    ]
    const result = notQueued(tree, [queued('C1', 'queued')], [running('C1', 'running')], false)
    expect(result.map((e) => e.lecture)).toEqual(['nobody'])
  })

  it('matches on course and kind too, never on the lecture name alone', () => {
    const tree = [
      course('C1', [lecture('L1', 'video.mp4')], [lecture('L1', 'video.mp4')]),
      course('C2', [lecture('L1', 'video.mp4')]),
    ]
    // Only C1's LECTURE L1 is queued; the same-named recitation and C2's L1 still have work left.
    const result = notQueued(tree, [queued('C1', 'L1')], [], false)
    expect(result).toEqual([
      { course: 'C1', lecture: 'L1', kind: 'recitation' },
      { course: 'C2', lecture: 'L1', kind: 'lecture' },
    ])
  })

  it('leaves an archived course out — the runner never reaches it', () => {
    const tree = [{ ...course('C1', [lecture('L1', 'video.mp4')]), archived: true }]
    expect(notQueued(tree, [], [], false)).toEqual([])
  })
})
