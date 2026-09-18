import './StatusNode.css'

export type StatusNodeState = 'done' | 'running' | 'pending' | 'paused' | 'failed' | 'quota'

// The one run-state glyph for pipeline rows, course branches and their steps. `paused` is a run
// waiting out a provider's rate limit: still ours, not a failure. `quota` is a failure on a provider's
// exhausted daily quota, which no retry fixes until it resets.
export default function StatusNode({ state, title }: { state: StatusNodeState; title?: string }) {
  return (
    <span className={`status-node status-node--${state}`} title={title} role="status">
      {state === 'done' && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M2.5 6.2l2.4 2.4L9.5 4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {state === 'paused' && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="4.4" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M6 3.6V6l1.7 1.1"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {state === 'quota' && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <rect
            x="1.2"
            y="3.4"
            width="8.4"
            height="5.2"
            rx="1.2"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path d="M10.9 5.1v1.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      )}
      {state === 'failed' && '!'}
    </span>
  )
}
