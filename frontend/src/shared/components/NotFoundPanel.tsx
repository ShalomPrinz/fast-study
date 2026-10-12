import { Trans } from '@lingui/react/macro'
import { Link } from 'react-router-dom'
import Icon from '@/shared/components/Icon'
import '@/styles/button.css'
import '@/styles/panel.css'
import './NotFoundPanel.css'

// A route target that isn't in the tree; `failed` says the tree itself failed to load, in the danger palette.
export default function NotFoundPanel({
  message,
  failed = false,
}: {
  message: string
  failed?: boolean
}) {
  return (
    <main
      className={
        failed ? 'main-view main-view--empty main-view--failed' : 'main-view main-view--empty'
      }
    >
      <div className={failed ? 'empty-state empty-state--error' : 'empty-state'}>
        <span className="empty-state-icon">
          <Icon icon="lecture" />
        </span>
        <p className="empty-state-title" dir="auto">
          {message}
        </p>
        <Link className="btn btn--ghost empty-state-home" to="/">
          <Icon icon="home" />
          <Trans>Home</Trans>
        </Link>
      </div>
    </main>
  )
}
