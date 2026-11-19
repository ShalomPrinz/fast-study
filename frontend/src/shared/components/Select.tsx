import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import Icon from '@/shared/components/Icon'
import { nextIndex, typeAheadIndex } from '@/shared/utils/listbox'
import { isOutsidePress } from '@/shared/utils/tooltip'
import './Select.css'

export interface SelectOption {
  value: string
  label: string
  // The language of a label written in its own script (a language's endonym).
  lang?: string
  // Marks the empty-value row that stands for "nothing chosen": the closed trigger greys it.
  placeholder?: boolean
  // Draws a rule above the row.
  dividerBefore?: boolean
}

interface Props {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  // Lets a `<label htmlFor>` name the trigger.
  id?: string
  // The accessible name when there is no visible label; the chip's panel shows it as a heading.
  label?: string
  // `chip` is the tinted pill that sits inside the search field.
  variant?: 'field' | 'chip'
}

const GAP = 4
const MARGIN = 8
const CHIP_WIDTH = 240
const TYPE_AHEAD_MS = 500
// `popover` is missing from this React's typings.
const MANUAL = { popover: 'manual' }

// A select-only ARIA listbox for a fixed set of options; focus stays on the trigger. The free-text
// counterpart is `Combobox`.
export default function Select({ value, options, onChange, id, label, variant = 'field' }: Props) {
  const autoId = useId()
  const base = id ?? autoId
  const listId = `${base}-listbox`
  const optionId = (i: number) => `${base}-option-${i}`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', timer: 0 })
  const selected = options.findIndex((o) => o.value === value)
  const current = options[selected]
  const chip = variant === 'chip'

  function openPanel() {
    setActive(selected)
    setOpen(true)
  }

  function close() {
    setOpen(false)
    typed.current.text = ''
  }

  function commit(i: number) {
    const option = options[i]
    close()
    if (option && option.value !== value) onChange(option.value)
  }

  // The panel sits in the top layer, placed from the trigger's rect and flipped above when it would run
  // off the bottom. Rects are visual px and a `zoom` ancestor (the init wall) scales CSS px, so divide by it.
  function place() {
    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger || !panel) return
    panel.style.left = '100px'
    const zoom = panel.getBoundingClientRect().left / 100 || 1
    const rect = trigger.getBoundingClientRect()
    const width = chip ? Math.min(CHIP_WIDTH, innerWidth - 2 * MARGIN) : rect.width
    panel.style.minInlineSize = `${width / zoom}px`
    panel.style.maxInlineSize = `${(innerWidth - 2 * MARGIN) / zoom}px`
    const size = panel.getBoundingClientRect()
    const rtl = getComputedStyle(trigger).direction === 'rtl'
    // The panel's inline-end edge meets the trigger's; physical top/left because they come from a resolved DOMRect.
    let left = chip ? (rtl ? rect.left : rect.right - size.width) : rect.left
    left = Math.max(MARGIN, Math.min(left, innerWidth - size.width - MARGIN))
    const below = innerHeight - rect.bottom - MARGIN
    const flip = size.height > below && rect.top > below
    const top = flip ? Math.max(MARGIN, rect.top - GAP - size.height) : rect.bottom + GAP
    panel.style.left = `${left / zoom}px`
    panel.style.top = `${top / zoom}px`
  }

  useLayoutEffect(() => {
    if (!open) return
    panelRef.current?.showPopover?.()
    place()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (
        isOutsidePress(triggerRef.current, e.target) &&
        isOutsidePress(panelRef.current, e.target)
      )
        close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  useEffect(() => {
    if (open && active >= 0)
      document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  useEffect(() => () => window.clearTimeout(typed.current.timer), [])

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openPanel()
      }
      return
    }
    const to = nextIndex(e.key, active, options.length)
    if (to !== null) {
      e.preventDefault()
      setActive(to)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Enter' || (e.key === ' ' && !typed.current.text)) {
      e.preventDefault()
      commit(active)
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      const buffer = typed.current
      buffer.text += e.key
      window.clearTimeout(buffer.timer)
      buffer.timer = window.setTimeout(() => (buffer.text = ''), TYPE_AHEAD_MS)
      const hit = typeAheadIndex(
        buffer.text,
        options.map((o) => o.label),
        active,
      )
      if (hit !== null) setActive(hit)
    }
  }

  const empty = current?.placeholder && current.value === ''

  return (
    <span className={`select select--${variant}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        // The option text a settings-page search matches, though the panel is closed.
        data-options={options.map((o) => o.label).join('\n')}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onKeyDown}
        onBlur={close}
      >
        {chip && (
          <span className="select-lead" aria-hidden="true">
            <Icon icon="book" />
          </span>
        )}
        <span
          className={empty ? 'select-value select-value--placeholder' : 'select-value'}
          dir="auto"
          lang={current?.lang}
        >
          {current?.label}
        </span>
        <span className="select-chevron" aria-hidden="true">
          <Icon icon="chevron-down" />
        </span>
      </button>
      {open && (
        <div
          {...MANUAL}
          ref={panelRef}
          id={listId}
          className="select-panel"
          role="listbox"
          aria-label={label}
          // Keeps focus on the trigger, so its blur does not close the panel before the click lands.
          onMouseDown={(e) => e.preventDefault()}
        >
          {chip && label && (
            <div className="select-heading" aria-hidden="true">
              {label}
            </div>
          )}
          {options.map((option, i) => (
            <div
              key={option.value}
              id={optionId(i)}
              role="option"
              aria-selected={i === selected}
              lang={option.lang}
              className={`select-option${i === active ? ' select-option--active' : ''}${
                i === selected ? ' select-option--selected' : ''
              }${option.dividerBefore ? ' select-option--divided' : ''}`}
              onClick={() => commit(i)}
              onMouseMove={() => i !== active && setActive(i)}
            >
              <span className="select-option-label" dir="auto">
                {option.label}
              </span>
              {i === selected && (
                <span className="select-check" aria-hidden="true">
                  <Icon icon="check" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
