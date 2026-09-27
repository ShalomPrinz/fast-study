import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link, useLocation } from 'react-router-dom'
import { captureRenderError, isReporting } from '@/services/sentry'
import '@/styles/panel.css'
import '@/styles/button.css'
import './ErrorBoundary.css'

// Last-resort net for render errors. The fallback replaces the sidebar too, hence the Home link and
// the pathname reset that lets it recover — see docs/ARCHITECTURE.md §Error boundary.

function buildReport(error: Error, componentStack: string): string {
  return [
    new Date().toISOString(),
    window.location.href,
    navigator.userAgent,
    '',
    error.stack ?? `${error.name}: ${error.message}`,
    '',
    'Component stack:' + componentStack,
  ].join('\n')
}

function CopyButton({ report }: { report: string }) {
  const { t } = useLingui()
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }
  return (
    <button
      className={`btn btn--ghost error-btn${copied ? ' error-btn--copied' : ''}`}
      onClick={copy}
    >
      {copied ? t`Copied!` : t`Copy details`}
    </button>
  )
}

// Rendered in place, never as a toast: the fallback has replaced the App that mounts the container.
function ReportOutcome({ eventId }: { eventId: string | null }) {
  return eventId ? (
    <p className="error-sent">
      <Trans>
        This error was reported automatically. Reference: <code>{eventId}</code>
      </Trans>
    </p>
  ) : (
    <p className="error-sent error-sent--failed">
      <Trans>This error could not be reported automatically. Copy the details to report it.</Trans>
    </p>
  )
}

interface BoundaryProps {
  children: ReactNode
  pathname: string
}

interface BoundaryState {
  report: string | null
  eventId: string | null
  pathname: string
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state = {
    report: null as string | null,
    eventId: null as string | null,
    pathname: this.props.pathname,
  }

  // Navigating clears the error. Doing it here rather than by re-keying the boundary is what keeps
  // an ordinary route change from remounting everything below — providers, SSE stream and all.
  static getDerivedStateFromProps(p: BoundaryProps, s: BoundaryState): BoundaryState | null {
    return p.pathname === s.pathname ? null : { report: null, eventId: null, pathname: p.pathname }
  }

  // Captured here, once per caught error, so every render crash lands in Sentry unprompted.
  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentStack = info.componentStack ?? ''
    this.setState({
      report: buildReport(error, componentStack),
      eventId: captureRenderError(error, { componentStack, route: this.props.pathname }),
    })
  }

  render() {
    const { report, eventId } = this.state
    if (!report) return this.props.children
    return (
      <main className="main-view error-view">
        <span className="error-icon" aria-hidden="true">
          !
        </span>
        <h1 className="error-title">
          <Trans>Something went wrong</Trans>
        </h1>
        <p className="error-hint">
          <Trans>
            Sorry about it. Go home to keep working, or copy the details below to report it.
          </Trans>
        </p>
        <div className="error-actions">
          <Link className="btn btn--primary error-btn" to="/">
            <Trans>Home</Trans>
          </Link>
          {/* A crash in Layout or the providers re-crashes at "/", so keep a hard reset around. */}
          <button className="btn btn--ghost error-btn" onClick={() => window.location.reload()}>
            <Trans>Reload</Trans>
          </button>
          <CopyButton report={report} />
          {/* Browser dev and a DSN-less build have nowhere to send, so they say nothing about it. */}
          {isReporting() && <ReportOutcome eventId={eventId} />}
        </div>
        <pre className="error-report">{report}</pre>
      </main>
    )
  }
}

export default function ErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  // Passed, never used as a key: the boundary resets its own error on a pathname change, so the
  // tree below survives navigation instead of being torn down and rebuilt.
  return <Boundary pathname={pathname}>{children}</Boundary>
}
