import { describe, it, expect } from 'vitest'
import type { Course, FileInfo, FileStatus, Lecture } from '@/types'
import type { Item, Media } from '../services/autoDownloader'
import { resolveRow } from './RowEditsContext'

const EMPTY: FileInfo = { exists: false, size: null, mtime: null }

function node(name: string): Lecture {
  const files = {
    'video.mp4': EMPTY,
    'audio.mp3': EMPTY,
    'transcript.txt': EMPTY,
    'transcript.partial.txt': EMPTY,
    'summary.md': EMPTY,
    'summary.pdf': EMPTY,
    'drive_url.txt': EMPTY,
    'material.pdf': EMPTY,
  } satisfies FileStatus
  return { name, files, transcribePartial: null }
}

const COURSES: Course[] = [
  {
    name: 'Algebra',
    archived: false,
    source_url: null,
    lectures: [node('Lecture 1'), node('Lecture 2')],
    recitations: [node('Recitation 4')],
  },
]

function item(media: Media, title = 'slides'): Item {
  return { ref: 'r1', title, kind: 'lecture', media, expandable: false, section: '' }
}

describe('resolveRow', () => {
  it('defaults a material row to the lecture its title names', () => {
    const row = resolveRow(item('material', 'שקפי הרצאה 5'), undefined, COURSES, 'Algebra')
    expect(row).toEqual({
      kind: 'lecture',
      suggestion: 'Lecture 5',
      value: 'Lecture 5',
      name: 'Lecture 5',
    })
  })

  it('defaults a material row with a numberless title to the next new lecture', () => {
    const row = resolveRow(item('material'), undefined, COURSES, 'Algebra')
    expect(row.name).toBe('Lecture 3')
  })

  it('still defaults a video row to the next new lecture', () => {
    const row = resolveRow(item('video', 'הרצאה 8'), undefined, COURSES, 'Algebra')
    expect(row.name).toBe('Lecture 8')
  })

  it('re-derives a material row against the recitations when the kind toggle flips', () => {
    const row = resolveRow(
      item('material', 'תרגול 3 - פתרונות'),
      { kind: 'recitation' },
      COURSES,
      'Algebra',
    )
    expect(row).toMatchObject({ kind: 'recitation', name: 'Recitation 3' })
  })

  it('accepts a free-text lecture that does not exist yet, pinned against the kind toggle', () => {
    const edit = { name: 'Lecture 12' }
    expect(resolveRow(item('material'), edit, COURSES, 'Algebra').name).toBe('Lecture 12')
    expect(
      resolveRow(item('material'), { ...edit, kind: 'recitation' }, COURSES, 'Algebra').name,
    ).toBe('Lecture 12')
  })

  it('falls back to the suggestion when the field is cleared', () => {
    const row = resolveRow(item('material', 'שקפי הרצאה 5'), { name: '  ' }, COURSES, 'Algebra')
    expect({ value: row.value, name: row.name }).toEqual({ value: '  ', name: 'Lecture 5' })
  })
})
