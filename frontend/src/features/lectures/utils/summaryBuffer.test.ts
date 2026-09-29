import { describe, it, expect } from 'vitest'
import type { FileStatus, FileInfo } from '@/types'
import { canUpdatePdf, diskChange } from './summaryBuffer'

const info = (over: Partial<FileInfo> = {}): FileInfo => ({
  exists: false,
  size: null,
  mtime: null,
  ...over,
})

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

describe('diskChange', () => {
  it('ignores a read that matches what the buffer came from — our own save echoing back', () => {
    expect(diskChange('edited', 'a', 'a')).toBe('none')
  })

  it('reloads a clean buffer when another writer changed the file', () => {
    expect(diskChange('a', 'a', 'b')).toBe('reload')
  })

  it('reloads when the edits already equal the new disk content', () => {
    expect(diskChange('b', 'a', 'b')).toBe('reload')
  })

  it('never replaces an edited buffer that disagrees with disk', () => {
    expect(diskChange('mine', 'a', 'theirs')).toBe('conflict')
  })
})

describe('canUpdatePdf', () => {
  const current = files({ exists: true, mtime: 200 }, { exists: true, mtime: 100 })

  it('refuses an empty buffer, even with no PDF yet', () => {
    expect(canUpdatePdf('', true, files({}, {}))).toBe(false)
  })

  it('refuses a whitespace-only buffer', () => {
    expect(canUpdatePdf(' \n\t', true, current)).toBe(false)
  })

  it('accepts an edited buffer', () => {
    expect(canUpdatePdf('# x', true, current)).toBe(true)
  })

  it('accepts a clean buffer whose PDF is missing', () => {
    expect(canUpdatePdf('# x', false, files({}, { exists: true, mtime: 100 }))).toBe(true)
  })

  it('has nothing to do for a clean buffer with a current PDF', () => {
    expect(canUpdatePdf('# x', false, current)).toBe(false)
  })
})
