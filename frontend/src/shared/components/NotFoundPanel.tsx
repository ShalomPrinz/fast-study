import { Trans } from '@lingui/react/macro'
import { Link } from 'react-router-dom'
import '@/styles/panel.css'
import './NotFoundPanel.css'

export default function NotFoundPanel({ message }: { message: string }) {
  return (
    <main className="main-view main-view--empty">
      <p className="empty-state" dir="auto">
        {message}
      </p>
      <Link className="empty-state-link" to="/">
        <Trans>Home</Trans>
      </Link>
    </main>
  )
}
