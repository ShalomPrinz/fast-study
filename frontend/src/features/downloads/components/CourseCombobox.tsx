import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { courseOptions } from '@/features/downloads/utils/manualDownload'
import './CourseCombobox.css'

interface Props {
  id: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
  // Fired only when an option is chosen, never for typed text.
  onPick?: (option: string) => void
  onBlur?: () => void
  placeholder?: string
  className?: string
}

// Free text with the options as an ARIA combobox listbox; unedited since focus it lists every option,
// so a prefilled value never hides the others, and only typed text filters.
export default function CourseCombobox({
  id,
  value,
  options,
  onChange,
  onPick,
  onBlur,
  placeholder,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [edited, setEdited] = useState(false)
  const [active, setActive] = useState(-1)
  const listRef = useRef<HTMLUListElement>(null)
  const key = value.trim().toLowerCase()
  const shown = courseOptions(options, value, edited)
  const expanded = open && shown.length > 0
  const listId = `${id}-listbox`
  const optionId = (i: number) => `${id}-option-${i}`

  // Opens on the full list with the current value highlighted, as if nothing was typed yet.
  function show() {
    setOpen(true)
    setEdited(false)
    setActive(options.findIndex((o) => o.toLowerCase() === key))
  }

  function pick(option: string) {
    onChange(option)
    onPick?.(option)
    setOpen(false)
    setEdited(false)
  }

  useEffect(() => {
    if (expanded && active >= 0)
      listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' })
  }, [expanded, active])

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return show()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) =>
        i < 0 && step < 0 ? shown.length - 1 : (i + step + shown.length) % shown.length,
      )
    } else if (e.key === 'Enter' && expanded && active >= 0 && active < shown.length) {
      e.preventDefault()
      pick(shown[active])
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className={className ? `course-combobox ${className}` : 'course-combobox'}>
      <input
        id={id}
        className="source-row-input"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setEdited(true)
          setActive(-1)
        }}
        onFocus={show}
        onClick={() => !open && show()}
        onBlur={() => {
          setOpen(false)
          onBlur?.()
        }}
        onKeyDown={onKeyDown}
      />
      {expanded && (
        <ul id={listId} ref={listRef} className="course-combobox-listbox" role="listbox">
          {shown.map((option, i) => (
            <li
              key={option}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={
                i === active
                  ? 'course-combobox-option course-combobox-option--active'
                  : 'course-combobox-option'
              }
              // Keeps focus on the input, so its blur does not close the list before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(option)}
              onMouseEnter={() => setActive(i)}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
