import type { ReactNode } from 'react'
import './PageHeader.css'

interface Props {
  // Breadcrumb line above the title — the course a lecture belongs to, and the like.
  eyebrow?: ReactNode
  title: string
  // Inline facts about what the page shows; the caller separates them with `<PageHeaderDot />`.
  meta?: ReactNode
  actions?: ReactNode
}

// The band every view opens with: breadcrumb, title, metadata row, and a right-aligned action group.
export default function PageHeader({ eyebrow, title, meta, actions }: Props) {
  return (
    <header className="page-header">
      {eyebrow && (
        <p className="page-header-eyebrow" dir="auto">
          {eyebrow}
        </p>
      )}
      <div className="page-header-main">
        <div className="page-header-text">
          <h1 className="page-header-title" dir="auto">
            {title}
          </h1>
          {meta && <div className="page-header-meta">{meta}</div>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
    </header>
  )
}

// Separator between two metadata facts, so callers never hand-punctuate the row.
export function PageHeaderDot() {
  return <span aria-hidden="true">·</span>
}
