import { describe, it, expect } from 'vitest'
import { renameAndFollow } from './renameFlow'

function recorder(rename: () => Promise<string>) {
  const events: string[] = []
  const flow = {
    typed: 'Typed',
    rename: async () => {
      events.push('rename')
      return rename()
    },
    refresh: async () => {
      await Promise.resolve()
      events.push('refresh landed')
    },
    follow: (effective: string) => events.push(`follow ${effective}`),
    show: (label: string | null) => events.push(`show ${label}`),
  }
  return { events, flow }
}

describe('renameAndFollow', () => {
  it('shows the new name until the tree lands, and follows the answered name only after it', async () => {
    const { events, flow } = recorder(async () => 'Sanitized')
    await renameAndFollow(flow)
    expect(events).toEqual([
      'show Typed',
      'rename',
      'show Sanitized',
      'refresh landed',
      'follow Sanitized',
      'show null',
    ])
  })

  it('puts the old name back on a failed rename, with no refresh or follow, and rethrows', async () => {
    const { events, flow } = recorder(async () => {
      throw new Error('folder_in_use')
    })
    await expect(renameAndFollow(flow)).rejects.toThrow('folder_in_use')
    expect(events).toEqual(['show Typed', 'rename', 'show null'])
  })
})
