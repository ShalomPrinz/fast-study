import Tooltip from '@/shared/components/Tooltip'
import './StatusNode.css'

export type StatusNodeState =
  | 'done'
  | 'running'
  | 'pending'
  | 'paused'
  | 'failed'
  | 'quota'
  // A file gone from disk after a later stage was made from it: finished, but not there.
  | 'removed'

// The one run-state glyph for pipeline rows, course branches and their steps. `paused` is a run
// waiting out a provider's rate limit: still ours, not a failure. `quota` is a failure on a provider's
// exhausted daily quota, which no retry fixes until it resets.
export default function StatusNode({ state, hint }: { state: StatusNodeState; hint?: string }) {
  return (
    <Tooltip content={hint}>
      <span className={`status-node status-node--${state}`} aria-label={hint} role="status">
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
        {state === 'removed' && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M3 6h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
        {state === 'failed' && '!'}
      </span>
    </Tooltip>
  )
}
