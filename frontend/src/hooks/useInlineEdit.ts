import { useState, useEffect, useRef } from 'react'

export function useInlineEdit<T>(activeValue: T | null) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (activeValue !== null) { ref.current?.focus(); ref.current?.select() }
  }, [activeValue])
  return { value, setValue, ref }
}
