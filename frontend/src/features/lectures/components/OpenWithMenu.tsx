import Tooltip from '@/shared/components/Tooltip'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import Icon from '@/shared/components/Icon'
import { shouldOpenUp } from './openWithPlacement'
import './OpenWithMenu.css'

// A file row's overflow menu holding "Open with…" alone; the caller renders it only where
// `canOpenWith()` is true (Windows packaged).
export default function OpenWithMenu({ onOpenWith }: { onOpenWith: () => void }) {
  const { t } = useLingui()
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Measure before paint so the list never shows clipped below the viewport.
  useLayoutEffect(() => {
    if (!open || !ref.current || !listRef.current) return
    setUp(
      shouldOpenUp(
        ref.current.getBoundingClientRect(),
        listRef.current.offsetHeight,
        window.innerHeight,
      ),
    )
  }, [open])

  // Pointerdown, not click, so a click on another button does not fire before the menu closes.
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

  return (
    <span className="open-with-menu" ref={ref}>
      <Tooltip content={t`More actions`}>
        <button
          className="open-with-menu-btn"
          aria-label={t`More actions`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon icon="overflow" />
        </button>
      </Tooltip>
      {open && (
        <div className={`open-with-menu-list${up ? ' open-up' : ''}`} role="menu" ref={listRef}>
          <button
            className="open-with-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onOpenWith()
            }}
          >
            {t`Open with…`}
          </button>
        </div>
      )}
    </span>
  )
}
