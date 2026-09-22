import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BlockedError,
  ReconnectError,
  UnsupportedError,
} from '@/features/downloads/services/autoDownloader'
import { ConnectionError, RequestError } from '@/services/http'
import { expandErrorText, toastDownloadError } from './downloadErrors'

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

  it('stays silent on a ConnectionError, which the client already toasted', () => {
    toastDownloadError('Lecture 3', new ConnectionError('downloader server', 'http://x'))

    expect(toast).not.toHaveBeenCalled()
  })

  it("renders a coded refusal in the service's words, led by the row name", () => {
    toastDownloadError('Lecture 3', new RequestError('Moodle said no', 'moodle_ws_error', {}))

    expect(toast).toHaveBeenCalledTimes(1)
    const node = toast.mock.calls[0][1]
    expect(node.props.failure.code).toBe('moodle_ws_error')
    expect(node.props.lead).toBe('Lecture 3')
  })

  it('keeps the generic copy for a codeless refusal', () => {
    toastDownloadError('Lecture 3', new RequestError('500 Internal Server Error'))

    expect(typeof toast.mock.calls[0][1]).toBe('string')
  })
})

describe('expandErrorText', () => {
  const GENERIC = expandErrorText(new Error('boom'))

  it('says nothing in the row for a reconnect — the account chip reports it', () => {
    expect(expandErrorText(new ReconnectError())).toBeNull()
  })

  it("resolves a coded refusal to the service's sentence, not the generic line", () => {
    const err = new RequestError('Moodle said no', 'moodle_ws_error', {})

    expect(expandErrorText(err)).not.toBe(GENERIC)
    expect(expandErrorText(err)).not.toBe('Moodle said no')
  })

  it('resolves an unsupported source even without a code', () => {
    expect(expandErrorText(new UnsupportedError('That host is not supported.'))).toBe(
      'That host is not supported.',
    )
  })

  it('keeps the generic line for a codeless refusal', () => {
    expect(expandErrorText(new RequestError('500 Internal Server Error'))).toBe(GENERIC)
  })
})
