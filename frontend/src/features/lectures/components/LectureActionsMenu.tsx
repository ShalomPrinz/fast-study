import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import Icon from '@/shared/components/Icon'
import './LectureActionsMenu.css'

export interface LectureAction {
  label: string
  onClick: () => void
}

// The overflow beside the page's one primary button: the per-file actions that no longer sit inline
// on their pipeline row. Renders nothing when the lecture offers none of them yet.
export default function LectureActionsMenu({ actions }: { actions: LectureAction[] }) {
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
      <button
        className="btn btn--ghost actions-menu-btn"
        onClick={() => setOpen((v) => !v)}
        title={t`More actions`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon icon="overflow" />
      </button>
      {open && (
        <div className="actions-menu-list" role="menu">
          {actions.map(({ label, onClick }) => (
            <button
              key={label}
              className="actions-menu-item"
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
