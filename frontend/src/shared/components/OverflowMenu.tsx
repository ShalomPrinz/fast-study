import Tooltip from '@/shared/components/Tooltip'
import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import Icon from '@/shared/components/Icon'
import './OverflowMenu.css'

export interface OverflowAction {
  label: string
  onClick: () => void
  // A smoke-suite selector for the one item it drives (see docs/ARCHITECTURE.md).
  testId?: string
  // A stable modifier class for the item, for live-DOM checks (docs/TESTING.md).
  className?: string
}

interface Props {
  actions: OverflowAction[]
  testId?: string
  className?: string
}

// A ghost ⋯ button opening a dropdown of actions; closes on an outside pointerdown or Escape.
export default function OverflowMenu({ actions, testId, className }: Props) {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Pointerdown, not click: a click on another button would otherwise fire before the menu closes.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (actions.length === 0) return null

  return (
    <div className="actions-menu" ref={ref}>
      <Tooltip content={t`More actions`} placement="bottom">
        <button
          type="button"
          className={`btn btn--ghost actions-menu-btn${className ? ` ${className}` : ''}`}
          data-testid={testId}
          onClick={() => setOpen((v) => !v)}
          aria-label={t`More actions`}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Icon icon="overflow" />
        </button>
      </Tooltip>
      {open && (
        <div className="actions-menu-list" role="menu">
          {actions.map(({ label, onClick, testId, className }) => (
            <button
              key={label}
              type="button"
              className={`actions-menu-item${className ? ` ${className}` : ''}`}
              data-testid={testId}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onClick()
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
