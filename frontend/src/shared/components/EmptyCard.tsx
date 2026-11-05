import type { ReactNode } from 'react'
import Icon, { type IconName } from '@/shared/components/Icon'
import '@/styles/panel.css'

// The centered nothing-to-show card; `error` marks it with the danger palette, title unchanged.
export default function EmptyCard({
  icon,
  error = false,
  action,
  children,
}: {
  icon: IconName
  error?: boolean
  // A button under the title (retry, home).
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={error ? 'empty-state empty-state--error' : 'empty-state'}>
      <span className="empty-state-icon">
        <Icon icon={icon} />
      </span>
      <p className="empty-state-title">{children}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}
