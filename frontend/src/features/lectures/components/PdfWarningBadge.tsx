import type { FileStatus } from '@/types'
import { pdfBadge } from '@/features/lectures/utils/pdfBadge'

// Non-fatal marker for summary.pdf: it rendered with XeLaTeX errors, or it no longer matches
// summary.md. The full message is the tooltip, since a render warning is a long one-liner.
export default function PdfWarningBadge({ files }: { files: FileStatus | null }) {
  const badge = files && pdfBadge(files)
  if (!badge) return null

  return (
    <span
      className="pdf-badge"
      title={badge.title}
      role="status"
    >
      <span className="pdf-badge-symbol">{badge.kind === 'warning' ? '⚠' : '≠'}</span>
    </span>
  )
}
