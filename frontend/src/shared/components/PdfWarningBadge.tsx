import type { PdfBadge } from '@/types'
import './PdfWarningBadge.css'

// The full message is the tooltip, since a render warning is a long one-liner.
export default function PdfWarningBadge({ badge }: { badge: PdfBadge | null }) {
  if (!badge) return null

  return (
    <span className="pdf-badge" title={badge.title} role="status">
      <span className="pdf-badge-symbol">{badge.kind === 'warning' ? '⚠' : '≠'}</span>
    </span>
  )
}
