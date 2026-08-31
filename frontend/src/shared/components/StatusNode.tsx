import './StatusNode.css'

export type StatusNodeState = 'done' | 'running' | 'pending' | 'paused' | 'failed'

// The one "where is this up to" glyph — the lecture pipeline, the course branches and their steps
// all read from the same five states at the same 22px size. `paused` is a run waiting out a
// provider's rate limit: still ours, not a failure.
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
      {state === 'failed' && '!'}
    </span>
  )
}
