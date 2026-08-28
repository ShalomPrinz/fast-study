import './StatusNode.css'

export type StatusNodeState = 'done' | 'running' | 'pending' | 'failed'

// The one "where is this up to" glyph — the lecture pipeline, the course branches and their steps
// all read from the same four states at the same 22px size.
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
      {state === 'failed' && '!'}
    </span>
  )
}
