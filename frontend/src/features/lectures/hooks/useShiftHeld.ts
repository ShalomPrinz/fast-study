import { useState, useEffect } from 'react'

// Whether Shift is held, so the UI can reflect it live.
export function useShiftHeld(): boolean {
  const [shiftHeld, setShiftHeld] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true) }
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false) }
    // An alt-tab mid-hold never delivers keyup, so reset on blur.
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
