import { describe, it, expect } from 'vitest'
import type { Course, FileInfo, FileStatus, Lecture, MaterialInfo } from '@/types'
import { existingNames, hasResource, materialsOf } from './existingItems'

const EMPTY: FileInfo = { exists: false, size: null, mtime: null }
const PRESENT: FileInfo = { exists: true, size: 10, mtime: 1 }

const material = (name: string): MaterialInfo => ({ name, size: 10, mtime: 1 })

function node(name: string, has: { materials?: string[]; video?: boolean } = {}): Lecture {
  const files = {
    'video.mp4': has.video ? PRESENT : EMPTY,
    'audio.mp3': EMPTY,
    'transcript.txt': EMPTY,
    'transcript.partial.txt': EMPTY,
    'summary.md': EMPTY,
    'summary.pdf': EMPTY,
    'drive_url.txt': EMPTY,
  } satisfies FileStatus
  return { name, files, materials: (has.materials ?? []).map(material), transcribePartial: null }
}

function tree(lectures: Lecture[], recitations: Lecture[] = []): Course[] {
  return [{ name: 'Algebra', archived: false, source_url: null, lectures, recitations }]
}

describe('existingNames', () => {
  it('lists the course nodes for the given kind — the material row datalist options', () => {
    const courses = tree([node('Lecture 1'), node('Lecture 2')], [node('Recitation 1')])
    expect(existingNames('lecture', courses, 'Algebra')).toEqual(['Lecture 1', 'Lecture 2'])
  })

  it('swaps to the recitations when the kind toggle flips', () => {
    const courses = tree([node('Lecture 1'), node('Lecture 2')], [node('Recitation 1')])
    expect(existingNames('recitation', courses, 'Algebra')).toEqual(['Recitation 1'])
  })

  it('is empty for an unknown course', () => {
    expect(existingNames('lecture', tree([node('Lecture 1')]), 'Calculus')).toEqual([])
  })
})

describe('materialsOf', () => {
  const courses = tree([
    node('Lecture 1'),
    node('Lecture 2', { materials: ['material.pdf', 'material.3.pdf'] }),
  ])

  it('lists the node materials in tree order', () => {
    expect(materialsOf('Lecture 2', 'lecture', courses, 'Algebra').map((m) => m.name)).toEqual([
      'material.pdf',
      'material.3.pdf',
    ])
  })

  it('is empty for a node with no materials and for one that does not exist', () => {
    expect(materialsOf('Lecture 1', 'lecture', courses, 'Algebra')).toEqual([])
    expect(materialsOf('Lecture 9', 'lecture', courses, 'Algebra')).toEqual([])
  })
})

describe('hasResource', () => {
  const courses = tree([
    node('Lecture 1', { video: true }),
    node('Lecture 2', { materials: ['material.pdf'] }),
    node('Lecture 3'),
    node('Lecture 4', { materials: ['material.pdf', 'material.2.pdf'] }),
  ])

  it('is true for a material row when that node holds any material', () => {
    expect(hasResource('material', 'Lecture 4', 'lecture', courses, 'Algebra')).toBe(true)
  })

  it('is true for a material row only when that node holds a material', () => {
    expect(hasResource('material', 'Lecture 2', 'lecture', courses, 'Algebra')).toBe(true)
    expect(hasResource('material', 'Lecture 1', 'lecture', courses, 'Algebra')).toBe(false)
  })

  it('is true for a video row only when that node holds a video.mp4', () => {
    expect(hasResource('video', 'Lecture 1', 'lecture', courses, 'Algebra')).toBe(true)
    expect(hasResource('video', 'Lecture 2', 'lecture', courses, 'Algebra')).toBe(false)
  })

  it('is false for a node that does not exist', () => {
    expect(hasResource('video', 'Lecture 9', 'lecture', courses, 'Algebra')).toBe(false)
    expect(hasResource('material', 'Lecture 9', 'lecture', courses, 'Algebra')).toBe(false)
  })

  it('is false for a video row whose node exists but holds no video.mp4', () => {
    expect(hasResource('video', 'Lecture 3', 'lecture', courses, 'Algebra')).toBe(false)
  })
})
