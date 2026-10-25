import { afterEach, describe, expect, it, vi } from 'vitest'
import { canOpenWith, canReveal } from './open'

afterEach(() => vi.unstubAllGlobals())

const bridge = (open: object, platform?: string) =>
  vi.stubGlobal('window', {
    faststudy: { open: { file: vi.fn(), external: vi.fn(), ...open }, platform },
  })

describe('canReveal', () => {
  it('is false in browser dev, where "Show in folder" stays disabled', () => {
    expect(canReveal()).toBe(false)
  })

  it('is false on a launcher that predates open.reveal', () => {
    bridge({})
    expect(canReveal()).toBe(false)
  })

  it('is true once the bridge offers it', () => {
    bridge({ reveal: vi.fn() })
    expect(canReveal()).toBe(true)
  })
})

describe('canOpenWith', () => {
  it('needs both the bridge call and Windows', () => {
    bridge({ fileWith: vi.fn() }, 'linux')
    expect(canOpenWith()).toBe(false)
    bridge({ fileWith: vi.fn() }, 'win32')
    expect(canOpenWith()).toBe(true)
  })
})
