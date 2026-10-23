import { describe, expect, it } from 'vitest'
import { mediaNote, noteLinksSettings } from './mediaNote'

describe('mediaNote', () => {
  it('follows AUTO_RUN on the video side', () => {
    expect(mediaNote('video', 'full')).toBe('video-full')
    expect(mediaNote('video', 'audio')).toBe('video-audio')
    expect(mediaNote('video', 'off')).toBe('video-off')
  })

  it('ignores AUTO_RUN on the other sides', () => {
    for (const autoRun of ['full', 'audio', 'off'] as const) {
      expect(mediaNote('material', autoRun)).toBe('material')
      expect(mediaNote('unknown', autoRun)).toBe('unknown')
    }
  })

  it('links Settings only from a video note', () => {
    expect(noteLinksSettings('video-off')).toBe(true)
    expect(noteLinksSettings('material')).toBe(false)
    expect(noteLinksSettings('unknown')).toBe(false)
  })
})
