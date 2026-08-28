import { Trans } from '@lingui/react/macro'
import { Link } from 'react-router-dom'
import Icon from '@/shared/components/Icon'
import '@/styles/panel.css'
import './NotFoundPanel.css'

export default function NotFoundPanel({ message }: { message: string }) {
  return (
    <main className="main-view main-view--empty">
      <div className="empty-state">
        <span className="empty-state-icon">
          <Icon icon="lecture" />
        </span>
        <p className="empty-state-title" dir="auto">
          {message}
        </p>
        <Link className="empty-state-link" to="/">
          <Trans>Home</Trans>
        </Link>
      </div>
    </main>
  )
}
