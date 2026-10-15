import Tooltip from '@/shared/components/Tooltip'
import type { PdfBadge } from '@/types'
import '@/styles/chip.css'
import './PdfWarningBadge.css'

// The full message is the tooltip, since a render warning is a long one-liner.
export default function PdfWarningBadge({ badge }: { badge: PdfBadge | null }) {
  if (!badge) return null

  return (
    <Tooltip content={badge.title}>
      <span className="chip chip--warn pdf-badge" aria-label={badge.title} role="status">
        <span className="pdf-badge-symbol">{badge.kind === 'warning' ? '⚠' : '≠'}</span>
      </span>
    </Tooltip>
  )
}
