import { afterEach, describe, expect, it, vi } from 'vitest'
import { canOpenWith, canReveal, openExternalUrl, openLectureFile } from './open'

const toast = vi.hoisted(() => vi.fn())
vi.mock('./toaster', () => ({ toast }))

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

describe('openLectureFile failure', () => {
  const rejecting = (err: Error) => bridge({ file: vi.fn().mockRejectedValue(err) })

  it('toasts the translated sentence for file_not_found', async () => {
    toast.mockClear()
    rejecting(Object.assign(new Error('database answered 404'), { code: 'file_not_found' }))
    await openLectureFile('c', 'l', 'a.pdf')
    expect(toast).toHaveBeenCalledWith('error', 'Could not open the file: it no longer exists.')
  })

  it('toasts the message when the failure has no code', async () => {
    toast.mockClear()
    rejecting(new Error('no app'))
    await openLectureFile('c', 'l', 'a.pdf')
    expect(toast).toHaveBeenCalledWith('error', 'Could not open the file: no app')
  })
})

describe('a bridge without open (partial stub)', () => {
  const stub = () => {
    const windowOpen = vi.fn()
    vi.stubGlobal('window', { faststudy: { services: {} }, open: windowOpen })
    return windowOpen
  }

  it('opens through window.open like no bridge', async () => {
    const windowOpen = stub()
    await openLectureFile('c', 'l', 'a.pdf')
    await openExternalUrl('https://example.com')
    expect(windowOpen).toHaveBeenCalledTimes(2)
  })

  it('offers neither open-with nor reveal, without throwing', () => {
    stub()
    expect(canOpenWith()).toBe(false)
    expect(canReveal()).toBe(false)
  })
})

describe('a full bridge', () => {
  it('routes openers to bridge.open.file, not window.open', async () => {
    const file = vi.fn().mockResolvedValue(undefined)
    const windowOpen = vi.fn()
    vi.stubGlobal('window', { faststudy: { open: { file, external: vi.fn() } }, open: windowOpen })
    await openLectureFile('c', 'l', 'a.pdf')
    expect(file).toHaveBeenCalledWith({ course: 'c', lecture: 'l', name: 'a.pdf', kind: undefined })
    expect(windowOpen).not.toHaveBeenCalled()
  })
})
