import type { RunInitResult } from '@/types'
import type { ServiceFailure } from '@/shared/i18n/serviceErrors'
import type { PdfState } from './pdfBadge'

// What `DocEditor` needs of one editable markdown document and its PDF: the lecture summary or an
// assignment's generated doc. See docs/EDITOR.md.
export interface DocSource {
  // Changes when the editor must load another document.
  id: string
  // The pane label.
  mdName: string
  title: string
  backRoute: string
  fetch(): Promise<{ content: string; hasOriginal: boolean }>
  save(content: string): Promise<void>
  restore(): Promise<void>
  // The tree's view of the md and its PDF; null until the tree has the document.
  pdf: PdfState | null
  pdfUrl: string
  // Re-renders the PDF over the saved text, replacing the old file.
  runPdf(): Promise<RunInitResult>
  // Called when this window's render answered `started`.
  markStarted(): void
  // The PDF render is in flight, and any run at all holds the document.
  rendering: boolean
  busy: boolean
  error: ServiceFailure | null
  openPdf(): void
}
