import { describe, it, expect } from 'vitest'
import type { FileStatus, FileInfo } from '@/types'
import { pdfBadge, pdfNeedsUpdate } from './pdfBadge'

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

  // The English literal, not stalePdfTitle(): asserting against the function the implementation
  // calls would pass for any title it returned. test-setup activates the source catalog.
  it('reports stale when summary.md is newer — the post-revert case', () => {
    expect(pdfBadge(files({ exists: true, mtime: 100 }, { exists: true, mtime: 200 }))).toEqual({
      kind: 'stale',
      title: 'The PDF is older than the summary. Re-generate it.',
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

describe('pdfNeedsUpdate', () => {
  it('is false for a PDF rendered after its summary', () => {
    expect(pdfNeedsUpdate(files({ exists: true, mtime: 200 }, { exists: true, mtime: 100 }))).toBe(
      false,
    )
  })

  it('is true for a stale PDF', () => {
    expect(pdfNeedsUpdate(files({ exists: true, mtime: 100 }, { exists: true, mtime: 200 }))).toBe(
      true,
    )
  })

  // The warning badge wins the chip, but the PDF still shows text that is no longer on disk.
  it('is true for a stale PDF that also carries a render warning', () => {
    const both = files(
      { exists: true, mtime: 100, warning: 'Undefined control sequence' },
      { exists: true, mtime: 200 },
    )
    expect(pdfNeedsUpdate(both)).toBe(true)
  })

  it('is false for a fresh PDF with a render warning', () => {
    const warned = files(
      { exists: true, mtime: 200, warning: 'Undefined control sequence' },
      { exists: true, mtime: 100 },
    )
    expect(pdfNeedsUpdate(warned)).toBe(false)
  })

  it('is true when there is no PDF, or no file status yet', () => {
    expect(pdfNeedsUpdate(files({ exists: false }, { exists: true, mtime: 200 }))).toBe(true)
    expect(pdfNeedsUpdate(null)).toBe(true)
  })
})
