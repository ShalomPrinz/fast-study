import { useState } from 'react'
import type { ComponentType } from 'react'
import type { AppMode } from '@/types'

const MODE_STORAGE_KEY = 'fastStudyMode'
const DEFAULT_MODE: AppMode = 'lectures'

export interface ModeConfig {
  label: string
  Component: ComponentType
}

interface Props {
  modes: Record<AppMode, ModeConfig>
}

// Owns the localStorage-persisted AppMode and renders the selected mode's body.
// Segment order follows `modes` insertion order.
export default function ModeToggle({ modes }: Props) {
  const [mode, setMode] = useState<AppMode>(() => {
    const stored = localStorage.getItem(MODE_STORAGE_KEY)
    // A stale stored key falls back to the default.
    return stored && stored in modes ? (stored as AppMode) : DEFAULT_MODE
  })

  function selectMode(m: AppMode) {
    setMode(m)
    localStorage.setItem(MODE_STORAGE_KEY, m)
  }

  const Body = modes[mode].Component

  return (
    <>
      <div className="mode-toggle">
        {(Object.entries(modes) as [AppMode, ModeConfig][]).map(([m, { label }]) => (
          <button
            key={m}
            className={`mode-toggle-btn${mode === m ? ' active' : ''}`}
            onClick={() => selectMode(m)}
          >
            {label}
          </button>
        ))}
      </div>
      <Body />
    </>
  )
}
