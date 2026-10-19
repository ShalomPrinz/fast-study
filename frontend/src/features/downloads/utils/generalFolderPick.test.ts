import { describe, it, expect, vi } from 'vitest'
import { createGeneralFolderPick } from './generalFolderPick'

describe('createGeneralFolderPick', () => {
  it('opens at the current folder and saves the chosen one', async () => {
    const pick = vi.fn().mockResolvedValue('/home/u/Videos')
    const save = vi.fn().mockResolvedValue(undefined)
    await createGeneralFolderPick(pick, save, vi.fn())('/home/u/Downloads')
    expect(pick).toHaveBeenCalledWith('/home/u/Downloads')
    expect(save).toHaveBeenCalledWith('/home/u/Videos')
  })

  it('saves nothing on cancel', async () => {
    const save = vi.fn()
    await createGeneralFolderPick(vi.fn().mockResolvedValue(null), save, vi.fn())('/d')
    expect(save).not.toHaveBeenCalled()
  })

  it('ignores a second request while the dialog is open', async () => {
    let close: (v: string | null) => void = () => {}
    const pick = vi.fn(() => new Promise<string | null>((r) => (close = r)))
    const save = vi.fn().mockResolvedValue(undefined)
    const onPick = createGeneralFolderPick(pick, save, vi.fn())
    const first = onPick('/d')
    await onPick('/d')
    close('/e')
    await first
    expect(pick).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('hands a refused save to onError, and opens again afterwards', async () => {
    const refusal = Object.assign(new Error('nope'), { code: 'general_folder_not_writable' })
    const pick = vi.fn().mockResolvedValue('/ro')
    const onError = vi.fn()
    const onPick = createGeneralFolderPick(pick, vi.fn().mockRejectedValue(refusal), onError)
    await onPick('/d')
    expect(onError).toHaveBeenCalledWith(refusal)
    await onPick('/d')
    expect(pick).toHaveBeenCalledTimes(2)
  })

  it('opens with no start folder when the server named none', async () => {
    const pick = vi.fn().mockResolvedValue(null)
    await createGeneralFolderPick(pick, vi.fn(), vi.fn())(undefined)
    expect(pick).toHaveBeenCalledWith(undefined)
  })
})
