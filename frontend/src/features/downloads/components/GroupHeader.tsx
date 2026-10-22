import type { ReactNode } from 'react'
import { Plural } from '@lingui/react/macro'
import Chevron from '@/shared/components/Chevron'
import type { GroupScope } from '@/features/downloads/utils/sections'
import { GROUP_SELECTOR } from '@/features/downloads/utils/sections'
import './GroupHeader.css'
import './RecordingRow.css'

interface Props {
  // Names the stable selectors: `${GROUP_SELECTOR[scope]}-header`, `-toggle`, `-title`, `-count`.
  scope: GroupScope
  title: string
  // Unknown until the group's rows are; omitted then.
  count: number | null
  // `loading` swaps the caret for a spinner and holds the toggle until the rows arrive.
  toggle: { open: boolean; loading: boolean; controls: string; onClick: () => void }
  // The run's facts and button, after the count.
  children?: ReactNode
}

// A collapsible group's heading line — a section's or a playlist's: caret, bold title and count, with
// the whole line as the toggle except the run button that follows.
export default function GroupHeader({ scope, title, count, toggle, children }: Props) {
  const selector = GROUP_SELECTOR[scope]
  return (
    <div className={`group-header ${selector}-header`}>
      <button
        type="button"
        className={`group-header-toggle ${selector}-toggle`}
        aria-expanded={toggle.open}
        aria-controls={toggle.controls}
        aria-busy={toggle.loading || undefined}
        disabled={toggle.loading}
        onClick={toggle.onClick}
      >
        <span className="group-header-caret" aria-hidden="true">
          {toggle.loading ? <span className="recording-spinner" /> : <Chevron open={toggle.open} />}
        </span>
        <span className={`group-header-title ${selector}-title`} dir="auto">
          {title}
        </span>
      </button>
      {count !== null && (
        <span className={`group-header-fact ${selector}-count`}>
          <Plural value={count} one="# item" other="# items" />
        </span>
      )}
      {children}
    </div>
  )
}
