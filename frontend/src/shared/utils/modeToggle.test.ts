import { describe, it, expect } from 'vitest'
import { effectiveMode, storedMode } from './modeToggle'

describe('effectiveMode', () => {
  const modes = { video: 1, material: 2 }

  it('keeps a mode the switch still shows', () => {
    expect(effectiveMode<string>(modes, 'material')).toBe('material')
  })

  it('falls back to the first mode when the chosen one is hidden', () => {
    expect(effectiveMode<string>(modes, 'unknown')).toBe('video')
  })
})

describe('storedMode', () => {
  const modes = { video: 1, material: 2 }

  it('keeps a stored key the switch hides now, so it returns with its segment', () => {
    expect(storedMode<string>('unknown', modes)).toBe('unknown')
  })

  it('starts on the first mode when nothing is stored', () => {
    expect(storedMode<string>(null, modes)).toBe('video')
    expect(storedMode<string>('', modes)).toBe('video')
  })
})
