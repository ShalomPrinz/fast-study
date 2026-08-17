import { useState } from 'react'
import type { ComponentType, ReactNode } from 'react'

export interface ModeConfig {
  label: string
  Component?: ComponentType
}

interface Props<M extends string> {
  modes: Record<M, ModeConfig>
  storageKey: string
  className?: string
  // `selectMode` lets a body switch segments itself — e.g. jumping to the section a run is stuck on.
  children?: (mode: M, selectMode: (m: M) => void) => ReactNode
}

// A localStorage-persisted segmented switch. Segment order and the default mode both follow
// `modes` insertion order; a body comes from the mode's `Component` or from `children(mode)`.
export default function ModeToggle<M extends string>({
  modes,
  storageKey,
  className,
  children,
}: Props<M>) {
  const entries = Object.entries(modes) as [M, ModeConfig][]
  const [mode, setMode] = useState<M>(() => {
    const stored = localStorage.getItem(storageKey)
    // A stale stored key falls back to the default.
    return stored && stored in modes ? (stored as M) : entries[0][0]
  })

  function selectMode(m: M) {
    setMode(m)
    localStorage.setItem(storageKey, m)
  }

  const Body = modes[mode].Component

  return (
    <>
      <div className={className ? `mode-toggle ${className}` : 'mode-toggle'}>
        {entries.map(([m, { label }]) => (
          <button
            key={m}
            className={`mode-toggle-btn${mode === m ? ' active' : ''}`}
            onClick={() => selectMode(m)}
          >
            {label}
          </button>
        ))}
      </div>
      {Body ? <Body /> : children?.(mode, selectMode)}
    </>
  )
}
