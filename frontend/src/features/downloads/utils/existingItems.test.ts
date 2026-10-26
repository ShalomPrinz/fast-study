import { describe, it, expect } from 'vitest'
import type { Course, FileInfo, FileStatus, Lecture, MaterialInfo } from '@/types'
import type { Media, ResolvedMedia } from '../services/autoDownloader'
import {
  isAssignmentDone,
  existingNames,
  hasResource,
  holdsVideo,
  materialsOf,
  overwritesVideo,
  targetLanded,
} from './existingItems'

const EMPTY: FileInfo = { exists: false, size: null, mtime: null }
const PRESENT: FileInfo = { exists: true, size: 10, mtime: 1 }

// `name` or `name@source` — the tree omits `source` for a source-less material, never nulls it.
function material(spec: string): MaterialInfo {
  const [name, source] = spec.split('@')
  return source ? { name, size: 10, mtime: 1, source } : { name, size: 10, mtime: 1 }
}

function node(
  name: string,
  has: { materials?: string[]; video?: boolean; removedVideo?: boolean } = {},
): Lecture {
  const files = {
    'video.mp4': has.video ? PRESENT : EMPTY,
    'audio.mp3': EMPTY,
    'transcript.txt': EMPTY,
    'transcript.partial.txt': EMPTY,
    'summary.md': EMPTY,
    'summary.pdf': EMPTY,
    'drive_url.txt': EMPTY,
  } satisfies FileStatus
  return {
    name,
    files,
    materials: (has.materials ?? []).map(material),
    summaryMaterials: null,
    transcribePartial: null,
    removed: has.removedVideo ? ['video.mp4'] : [],
    done: false,
  }
}

// `name@source,…` per assignment: [name, [file specs]].
function withAssignments(courses: Course[], specs: [string, string[]][]): Course[] {
  return courses.map((c) => ({
    ...c,
    assignments: specs.map(([name, files]) => ({
      name,
      done: false,
      lectures: [],
      docs: { intuition: null, solution: null },
      files: files.map((f) => {
        const [fname, source] = f.split('@')
        return source
          ? { name: fname, size: 1, mtime: 1, source, attach: true }
          : { name: fname, size: 1, mtime: 1, attach: true }
      }),
    })),
  }))
}

function tree(lectures: Lecture[], recitations: Lecture[] = []): Course[] {
  return [
    {
      name: 'Algebra',
      archived: false,
      source_url: null,
      lectures_only: false,
      lectures,
      recitations,
      assignments: [],
    },
  ]
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
    node('Lecture 2', { materials: ['material.pdf@refA'] }),
    node('Lecture 3'),
    node('Lecture 4', { materials: ['material.pdf@refA', 'material.2.pdf@refB'] }),
    node('Lecture 5', { materials: ['material.pdf'] }),
  ])
  const row = (media: Media, resolvedMedia?: ResolvedMedia, ref = 'refA') => ({
    ref,
    media,
    resolvedMedia,
  })

  it('is true for a material row only when that node holds a material from its own ref', () => {
    expect(hasResource(row('material'), 'Lecture 2', 'lecture', courses, 'Algebra')).toBe(true)
    expect(
      hasResource(row('material', undefined, 'refB'), 'Lecture 2', 'lecture', courses, 'Algebra'),
    ).toBe(false)
    expect(
      hasResource(row('material', undefined, 'refB'), 'Lecture 4', 'lecture', courses, 'Algebra'),
    ).toBe(true)
    expect(hasResource(row('material'), 'Lecture 1', 'lecture', courses, 'Algebra')).toBe(false)
  })

  it('matches no row against a source-less material, nor a ref-less caller against any', () => {
    expect(hasResource(row('material'), 'Lecture 5', 'lecture', courses, 'Algebra')).toBe(false)
    expect(hasResource({ media: 'material' }, 'Lecture 5', 'lecture', courses, 'Algebra')).toBe(
      false,
    )
    expect(hasResource({ media: 'material' }, 'Lecture 2', 'lecture', courses, 'Algebra')).toBe(
      false,
    )
  })

  it('is true for a video row only when that node holds a video.mp4', () => {
    expect(hasResource(row('video'), 'Lecture 1', 'lecture', courses, 'Algebra')).toBe(true)
    expect(hasResource(row('video'), 'Lecture 2', 'lecture', courses, 'Algebra')).toBe(false)
  })

  it('is false for a node that does not exist', () => {
    expect(hasResource(row('video'), 'Lecture 9', 'lecture', courses, 'Algebra')).toBe(false)
    expect(hasResource(row('material'), 'Lecture 9', 'lecture', courses, 'Algebra')).toBe(false)
  })

  it('is false for a video row whose node exists but holds no video.mp4', () => {
    expect(hasResource(row('video'), 'Lecture 3', 'lecture', courses, 'Algebra')).toBe(false)
  })

  it('is false for an unprobed unknown row, whatever is on disk', () => {
    expect(hasResource(row('unknown'), 'Lecture 1', 'lecture', courses, 'Algebra')).toBe(false)
    expect(hasResource(row('unknown'), 'Lecture 4', 'lecture', courses, 'Algebra')).toBe(false)
  })

  it('follows the probed type once an unknown row is resolved', () => {
    expect(hasResource(row('unknown', 'video'), 'Lecture 1', 'lecture', courses, 'Algebra')).toBe(
      true,
    )
  })

  it('is false for a row probed as unsupported — nothing of it can land on disk', () => {
    expect(
      hasResource(row('unknown', 'unsupported'), 'Lecture 1', 'lecture', courses, 'Algebra'),
    ).toBe(false)
  })
})

describe('overwritesVideo', () => {
  const courses = tree([
    node('Lecture 1', { video: true, materials: ['material.pdf'] }),
    node('Lecture 2', { materials: ['material.pdf'] }),
  ])
  const row = (media: Media, resolvedMedia?: ResolvedMedia) => ({ media, resolvedMedia })
  const overwrites = (r: ReturnType<typeof row>, name: string) =>
    overwritesVideo(r, name, 'lecture', courses, 'Algebra')

  it('is true for an unprobed unknown row whose target holds video.mp4 — it may be a video', () => {
    expect(overwrites(row('unknown'), 'Lecture 1')).toBe(true)
  })

  it('is true for a video row, resolved or not, whose target holds video.mp4', () => {
    expect(overwrites(row('video'), 'Lecture 1')).toBe(true)
    expect(overwrites(row('unknown', 'video'), 'Lecture 1')).toBe(true)
  })

  it('is false when the target holds no video.mp4 or does not exist', () => {
    expect(overwrites(row('unknown'), 'Lecture 2')).toBe(false)
    expect(overwrites(row('unknown'), 'Lecture 9')).toBe(false)
  })

  it('is false for a material or unsupported row, which never replaces a video', () => {
    expect(overwrites(row('material'), 'Lecture 1')).toBe(false)
    expect(overwrites(row('unknown', 'unsupported'), 'Lecture 1')).toBe(false)
  })
})

describe('targetLanded', () => {
  const landed = (name: string, media: Media | 'unsupported', courses: Course[], ref = 'refA') =>
    targetLanded({ ref, name, kind: 'lecture', media }, courses, 'Algebra')

  it('reads a material target as landed only once a material from its own ref is there', () => {
    const courses = tree([
      node('Lecture 1', { materials: ['material.pdf@refA', 'material.2.pdf'] }),
    ])
    expect(landed('Lecture 1', 'material', courses, 'refA')).toBe(true)
    expect(landed('Lecture 1', 'material', courses, 'refB')).toBe(false)
  })

  it('is true when the queued name itself holds the media', () => {
    expect(landed('Lecture 1', 'video', tree([node('Lecture 1', { video: true })]))).toBe(true)
  })

  it('is true when a split sibling holds the media instead of the queued name', () => {
    const courses = tree([node('Lecture 1.1', { video: true }), node('Lecture 1.2')])
    expect(landed('Lecture 1', 'video', courses)).toBe(true)
  })

  it('is false when the siblings exist but hold nothing — an earlier run left them bare', () => {
    const courses = tree([node('Lecture 1.1'), node('Lecture 1.2')])
    expect(landed('Lecture 1', 'video', courses)).toBe(false)
  })

  it('is false for an unprobed unknown target, even with the node on disk', () => {
    expect(landed('Lecture 1', 'unknown', tree([node('Lecture 1', { video: true })]))).toBe(false)
  })
})

describe('holdsVideo', () => {
  const courses = tree([
    node('On disk', { video: true }),
    node('Removed', { removedVideo: true }),
    node('Never had one'),
  ])

  it('counts a video on disk or a removed one, so bulk skips and a re-download confirms', () => {
    expect(holdsVideo('On disk', 'lecture', courses, 'Algebra')).toBe(true)
    expect(holdsVideo('Removed', 'lecture', courses, 'Algebra')).toBe(true)
    expect(hasResource({ media: 'video' }, 'Removed', 'lecture', courses, 'Algebra')).toBe(true)
    expect(overwritesVideo({ media: 'video' }, 'Removed', 'lecture', courses, 'Algebra')).toBe(true)
  })

  it('is false for a lecture with no video and for a missing one', () => {
    expect(holdsVideo('Never had one', 'lecture', courses, 'Algebra')).toBe(false)
    expect(holdsVideo('Nowhere', 'lecture', courses, 'Algebra')).toBe(false)
  })
})

describe('assignment rows', () => {
  const courses = withAssignments(tree([node('Lecture 1', { video: true })]), [
    ['תרגיל 1', ['a.pdf@refA', 'b.pdf']],
    ['תרגילון 1', ['c.pdf@refC']],
  ])
  const row = (ref: string, name: string) =>
    hasResource({ ref, media: 'assignment' }, name, 'lecture', courses, 'Algebra')

  it('is on disk only when a file of the named assignment came from this ref', () => {
    expect(row('refA', 'תרגיל 1')).toBe(true)
    expect(row('refA', 'תרגילון 1')).toBe(false)
    expect(row('refB', 'תרגיל 1')).toBe(false)
    expect(row('refA', 'Lecture 1')).toBe(false)
  })

  it('never matches a ref-less caller or a source-less file', () => {
    expect(hasResource({ media: 'assignment' }, 'תרגיל 1', 'lecture', courses, 'Algebra')).toBe(
      false,
    )
  })

  it('reads a target as landed by the same rule, never through split siblings', () => {
    const target = (name: string) =>
      targetLanded({ ref: 'refA', name, kind: 'lecture', media: 'assignment' }, courses, 'Algebra')
    expect(target('תרגיל 1')).toBe(true)
    expect(target('תרגיל')).toBe(false)
  })

  it('never counts as overwriting a stored video', () => {
    expect(
      overwritesVideo({ media: 'assignment' }, 'Lecture 1', 'lecture', courses, 'Algebra'),
    ).toBe(false)
  })
})

describe('isAssignmentDone', () => {
  const base = withAssignments(tree([]), [
    ['A', []],
    ['B', []],
  ])
  const courses = base.map((c) => ({
    ...c,
    assignments: c.assignments.map((a) => ({ ...a, done: a.name === 'A' })),
  }))

  it('is true only for an existing assignment marked done', () => {
    expect(isAssignmentDone('A', courses, 'Algebra')).toBe(true)
    expect(isAssignmentDone('B', courses, 'Algebra')).toBe(false)
    expect(isAssignmentDone('New', courses, 'Algebra')).toBe(false)
    expect(isAssignmentDone('A', courses, 'Other')).toBe(false)
  })
})
