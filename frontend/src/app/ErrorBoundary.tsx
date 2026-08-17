import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import '@/styles/panel.css'
import '@/styles/modal.css'
import './ErrorBoundary.css'

// Last-resort net for render errors: without it React unmounts the whole tree and leaves a blank
// page with no way back. It sits outside <Routes>, so the fallback replaces everything including
// the sidebar — hence the Home link, and the pathname key below that lets Home actually recover.

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
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }
  return (
    <button className={`modal-btn error-btn${copied ? ' error-btn--copied' : ''}`} onClick={copy}>
      {copied ? 'Copied!' : 'Copy details'}
    </button>
  )
}

class Boundary extends Component<{ children: ReactNode }, { report: string | null }> {
  state = { report: null as string | null }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ report: buildReport(error, info.componentStack ?? '') })
  }

  render() {
    const { report } = this.state
    if (!report) return this.props.children
    return (
      <main className="main-view error-view">
        <h1 className="error-title">Something went wrong</h1>
        <p className="error-hint">
          Sorry about it. Go home to keep working, or copy the details below to report it.
        </p>
        <div className="error-actions">
          <Link className="modal-btn error-btn error-btn--primary" to="/">
            Home
          </Link>
          {/* A crash in Layout or the providers re-crashes at "/", so keep a hard reset around. */}
          <button className="modal-btn error-btn" onClick={() => window.location.reload()}>
            Reload
          </button>
          <CopyButton report={report} />
        </div>
        <pre className="error-report">{report}</pre>
      </main>
    )
  }
}

export default function ErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  // Remounting on navigation is what clears the error — the class alone would show the fallback
  // forever once Home changed the URL.
  return <Boundary key={pathname}>{children}</Boundary>
}
