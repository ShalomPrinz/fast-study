import { describe, it, expect } from 'vitest'
import type { FileStatus, FileInfo } from '@/types'
import { pdfBadge, stalePdfTitle } from './pdfBadge'

const info = (over: Partial<FileInfo> = {}): FileInfo => ({
  exists: false,
  size: null,
  mtime: null,
  ...over,
})

// Only summary.md and summary.pdf matter; the rest of the row is filler.
function files(pdf: Partial<FileInfo>, md: Partial<FileInfo>): FileStatus {
  return {
    'video.mp4': info(),
    'audio.mp3': info(),
    'transcript.txt': info(),
    'transcript.partial.txt': info(),
    'summary.md': info(md),
    'summary.pdf': info(pdf),
    'drive_url.txt': info(),
  } as FileStatus
}

describe('pdfBadge', () => {
  it('is null for a PDF rendered after its summary', () => {
    expect(pdfBadge(files({ exists: true, mtime: 200 }, { exists: true, mtime: 100 }))).toBeNull()
  })

  it('reports stale when summary.md is newer — the post-revert case', () => {
    expect(pdfBadge(files({ exists: true, mtime: 100 }, { exists: true, mtime: 200 }))).toEqual({
      kind: 'stale',
      title: stalePdfTitle(),
    })
  })

  it('is null when the mtimes are equal', () => {
    expect(pdfBadge(files({ exists: true, mtime: 100 }, { exists: true, mtime: 100 }))).toBeNull()
  })

  it('is null while the PDF is missing, so a pending re-render stays quiet', () => {
    expect(pdfBadge(files({ exists: false, mtime: null }, { exists: true, mtime: 200 }))).toBeNull()
  })

  it('is null when summary.md is missing', () => {
    expect(pdfBadge(files({ exists: true, mtime: 100 }, { exists: false }))).toBeNull()
  })

  it('is null when an mtime is unavailable', () => {
    expect(pdfBadge(files({ exists: true, mtime: null }, { exists: true, mtime: 200 }))).toBeNull()
  })

  it('prefers a render warning over staleness when both apply', () => {
    const both = files(
      { exists: true, mtime: 100, warning: 'Undefined control sequence' },
      { exists: true, mtime: 200 },
    )
    expect(pdfBadge(both)).toEqual({ kind: 'warning', title: 'Undefined control sequence' })
  })
})
