import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BlockedError, UnsupportedError } from '@/features/downloads/services/autoDownloader'
import { toastDownloadError } from './downloadErrors'

// The toaster is the boundary under observation: what reaches it is the whole assertion.
// `vi.hoisted` because the mock factory is lifted above the imports it feeds.
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/services/toaster', () => ({ toast }))

const BLOCKED_COPY =
  'The university site is temporarily refusing automated requests. Wait a few minutes and try again.'

beforeEach(() => {
  toast.mockClear()
})

describe('toastDownloadError', () => {
  it('shows the wait-and-retry copy for a blocked error, never the server message', () => {
    toastDownloadError('Lecture 3', new BlockedError())

    expect(toast).toHaveBeenCalledWith('error', BLOCKED_COPY)
  })

  it('routes an unsupported source through the resolver, so its own code names it', () => {
    const err = new UnsupportedError('That link is a .zip.', 'link_not_a_video', {
      source: 'link',
      url: 'http://x/y.zip',
      ext: 'zip',
    })

    toastDownloadError('Lecture 3', err)

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][1].props.failure).toBe(err)
  })

  it('falls back to the generic copy for anything else', () => {
    toastDownloadError('Lecture 3', new Error('HTTP 500'))

    expect(toast.mock.calls[0][1]).toContain('Lecture 3')
    expect(toast.mock.calls[0][1]).not.toBe(BLOCKED_COPY)
  })
})
