import type { FileStatus } from '@/types'
import { pdfNeedsUpdate } from './pdfBadge'

export type DiskChange = 'none' | 'reload' | 'conflict'

// What a fresh read of summary.md means for the open buffer, `saved` being what it was last read from
// or written to. Only an edited buffer that disagrees with disk is a conflict — see docs/EDITOR.md.
export function diskChange(content: string, saved: string, disk: string): DiskChange {
  if (disk === saved) return 'none'
  if (content === saved || content === disk) return 'reload'
  return 'conflict'
}

// Whether "Save & update PDF" has work to do. Never for a blank buffer: the save would leave an empty
// summary.md, whose render can only fail.
export function canUpdatePdf(content: string, dirty: boolean, files: FileStatus | null): boolean {
  if (!content.trim()) return false
  return dirty || pdfNeedsUpdate(files)
}
