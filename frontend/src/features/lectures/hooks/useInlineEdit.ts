import { useState, useEffect, useRef } from 'react'

function isTextEntry(el: Element | null) {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  )
}

// `yieldFocus`: a reopen (a late refusal) never takes focus from another text field the user is in.
export function useInlineEdit<T>(activeValue: T | null, opts: { yieldFocus?: boolean } = {}) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (activeValue === null) return
    if (opts.yieldFocus && isTextEntry(document.activeElement)) return
    ref.current?.focus()
    ref.current?.select()
  }, [activeValue])
  return { value, setValue, ref }
}
