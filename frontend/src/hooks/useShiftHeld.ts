import { useState, useEffect } from 'react'

// Tracks whether the Shift key is currently held, so the UI can reflect it live.
// Returns state only — UI lives in components, not hooks.
export function useShiftHeld(): boolean {
  const [shiftHeld, setShiftHeld] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true) }
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false) }
    // The window can lose focus mid-hold (alt-tab) and never see keyup; reset on blur.
    const onBlur = () => setShiftHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return shiftHeld
}
