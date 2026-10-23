import { useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { effectiveMode, storedMode } from '@/shared/utils/modeToggle'
import Icon from '@/shared/components/Icon'
import type { IconName } from '@/shared/components/Icon'
import '@/styles/segmented.css'

export interface ModeConfig {
  label: string
  // How many rows the segment holds, shown beside its label. Optional — most switches count nothing.
  count?: number
  // A glyph above the label, for the card-style switch (`mode-toggle--cards`).
  icon?: IconName
  Component?: ComponentType
}

interface Props<M extends string> {
  // Partial so a caller can hide a segment; the hidden mode still types the body's `mode`.
  modes: Partial<Record<M, ModeConfig>>
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
  const [mode, setMode] = useState<M>(() => storedMode(localStorage.getItem(storageKey), modes))

  function selectMode(m: M) {
    setMode(m)
    localStorage.setItem(storageKey, m)
  }

  // A caller may drop a segment while it is chosen; the choice is kept for when it returns.
  const shown = effectiveMode(modes, mode)
  const Body = modes[shown]?.Component

  return (
    <>
      <div className={className ? `mode-toggle ${className}` : 'mode-toggle'}>
        {entries.map(([m, { label, count, icon }]) => (
          <button
            key={m}
            className={`mode-toggle-btn${shown === m ? ' active' : ''}`}
            onClick={() => selectMode(m)}
          >
            {icon && <Icon icon={icon} />}
            <span className="mode-toggle-label">
              {label}
              {count !== undefined && <span className="mode-toggle-count">{count}</span>}
            </span>
          </button>
        ))}
      </div>
      {Body ? <Body /> : children?.(shown, selectMode)}
    </>
  )
}
