import { describe, it, expect, vi, afterEach } from 'vitest'
import { uploadVideo } from './database'

// Minimal stand-ins for the parts of Response the http client touches.
function noContent(): Response {
  return {
    ok: true,
    status: 204,
    headers: { get: () => null },
  } as unknown as Response
}

function failed(status: number): Response {
  return {
    ok: false,
    status,
    statusText: 'Error',
    headers: { get: () => null },
    text: async () => '',
  } as unknown as Response
}

const VIDEO = new File([''], 'video.mp4')
const PUT_VIDEO = 'PUT http://localhost:8001/courses/C/lectures/L/video'
const POST_ARRIVED = 'POST http://localhost:8000/courses/C/lectures/L/video-arrived'

// Records every request and answers each by the caller's own `respond`.
function stubFetch(respond: (url: string) => Response) {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`)
      return respond(url)
    }),
  )
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('uploadVideo', () => {
  it('reports the arrival to the backend once the PUT resolves', async () => {
    const calls = stubFetch(() => noContent())

    await uploadVideo('C', 'L', VIDEO)

    expect(calls).toEqual([PUT_VIDEO, POST_ARRIVED])
  })

  it('carries the kind through to both services', async () => {
    const calls = stubFetch(() => noContent())

    await uploadVideo('C', 'L', VIDEO, 'recitation')

    expect(calls).toEqual([`${PUT_VIDEO}?kind=recitation`, `${POST_ARRIVED}?kind=recitation`])
  })

  it('does not report when the PUT fails', async () => {
    const calls = stubFetch(() => failed(400))

    await expect(uploadVideo('C', 'L', VIDEO)).rejects.toThrow()

    expect(calls).toEqual([PUT_VIDEO])
  })

  it('resolves anyway when the report fails — the bytes are already stored', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const calls = stubFetch((url) => (url.includes('video-arrived') ? failed(500) : noContent()))

    await expect(uploadVideo('C', 'L', VIDEO)).resolves.toBeUndefined()

    expect(calls).toEqual([PUT_VIDEO, POST_ARRIVED])
    expect(error).toHaveBeenCalled()
  })
})
