import { describe, it, expect, vi, afterEach } from 'vitest'
import { createFolderPick } from './folderPick'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('createFolderPick', () => {
  it('opens at the current folder and hands on the chosen path', async () => {
    const pick = vi.fn().mockResolvedValue('/home/u/Lectures')
    const onPicked = vi.fn()
    await createFolderPick(pick)('/data', onPicked)
    expect(pick).toHaveBeenCalledWith('/data')
    expect(onPicked).toHaveBeenCalledWith('/home/u/Lectures')
  })

  it('opens with no start folder when the field is empty', async () => {
    const pick = vi.fn().mockResolvedValue(null)
    await createFolderPick(pick)('', vi.fn())
    expect(pick).toHaveBeenCalledWith(undefined)
  })

  it('leaves the value untouched on cancel', async () => {
    const onPicked = vi.fn()
    await createFolderPick(vi.fn().mockResolvedValue(null))('/data', onPicked)
    expect(onPicked).not.toHaveBeenCalled()
  })

  it('drops a second open while a dialog is up, and allows one after it closes', async () => {
    let close: (v: string | null) => void = () => {}
    const pick = vi.fn(() => new Promise<string | null>((r) => (close = r)))
    const open = createFolderPick(pick)
    const first = open('/data', vi.fn())
    await open('/data', vi.fn())
    expect(pick).toHaveBeenCalledTimes(1)
    close(null)
    await first
    void open('/data', vi.fn())
    expect(pick).toHaveBeenCalledTimes(2)
  })

  it('reopens after a dialog that failed', async () => {
    const pick = vi.fn().mockRejectedValueOnce(new Error('ipc')).mockResolvedValue(null)
    const open = createFolderPick(pick)
    await expect(open('/data', vi.fn())).rejects.toThrow('ipc')
    await open('/data', vi.fn())
    expect(pick).toHaveBeenCalledTimes(2)
  })
})

// The field is read-only with a picker exactly when the bridge offers one, else a typed path.
describe('pickFolder from the bridge', () => {
  it('is absent with no bridge — browser dev keeps the editable input', async () => {
    const { pickFolder } = await import('@/services/runtime')
    expect(pickFolder).toBeUndefined()
  })

  it('is absent on a bridge that predates it', async () => {
    vi.resetModules()
    vi.stubGlobal('window', { faststudy: {} })
    const { pickFolder } = await import('@/services/runtime')
    expect(pickFolder).toBeUndefined()
  })

  it('is the bridge method when the launcher has one', async () => {
    vi.resetModules()
    const bridgePick = vi.fn().mockResolvedValue('C:\\Lectures')
    vi.stubGlobal('window', { faststudy: { pickFolder: bridgePick } })
    const { pickFolder } = await import('@/services/runtime')
    expect(await pickFolder?.('C:\\data')).toBe('C:\\Lectures')
    expect(bridgePick).toHaveBeenCalledWith('C:\\data')
  })
})
