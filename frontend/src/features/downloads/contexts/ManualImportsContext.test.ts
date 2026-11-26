import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RequestError } from '@/services/http'

const { importVideo, uploadVideoWithProgress, reportVideoArrived, bridge } = vi.hoisted(() => ({
  importVideo: vi.fn(),
  uploadVideoWithProgress: vi.fn(),
  reportVideoArrived: vi.fn(),
  bridge: { current: undefined as { pathForFile?: (f: File) => string } | undefined },
}))
vi.mock('@/services/database', () => ({ importVideo, uploadVideoWithProgress }))
vi.mock('@/services/backend', () => ({ reportVideoArrived }))
vi.mock('@/services/runtime', async (orig) => ({
  ...(await orig<typeof import('@/services/runtime')>()),
  runtimeBridge: () => bridge.current,
}))

import {
  cancelImport,
  claimedByImports,
  importEntries,
  retryImport,
  startImport,
} from './ManualImportsContext'

const file = new File(['abcd'], 'lecture.mp4')
const request = {
  file,
  mode: 'copy' as const,
  course: 'Algo',
  lecture: 'L1',
  kind: 'lecture' as const,
}
const settle = () => new Promise((r) => setTimeout(r, 0))
const entry = (key: number) => importEntries().find((e) => e.key === key)!

beforeEach(() => {
  vi.resetAllMocks()
  bridge.current = undefined
  reportVideoArrived.mockResolvedValue(undefined)
})

describe('the import store', () => {
  it('uploads the bytes in a plain browser, follows progress, and reports the arrival on success', async () => {
    let progress: (c: number, t: number) => void = () => {}
    uploadVideoWithProgress.mockImplementation(async (_c, _l, _f, _k, o) => {
      progress = o.onProgress
      await settle()
    })
    const key = startImport(request)
    expect(entry(key).status).toBe('running')
    await Promise.resolve()
    progress(2, 4)
    expect(entry(key)).toMatchObject({ copied: 2, total: 4 })
    await settle()
    await settle()
    expect(entry(key).status).toBe('done')
    expect(reportVideoArrived).toHaveBeenCalledWith('Algo', 'L1', 'lecture')
    expect(importVideo).not.toHaveBeenCalled()
  })

  it('imports by path on the desktop, keeping the original-kept flag', async () => {
    bridge.current = { pathForFile: () => '/tmp/lecture.mp4' }
    importVideo.mockResolvedValue({ originalKept: true })
    const key = startImport({ ...request, mode: 'move' })
    await settle()
    expect(importVideo).toHaveBeenCalledWith(
      'Algo',
      'L1',
      { path: '/tmp/lecture.mp4', mode: 'move' },
      'lecture',
      expect.anything(),
    )
    expect(entry(key)).toMatchObject({ status: 'done', originalKept: true })
  })

  it('still ends done when reporting the arrival fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    uploadVideoWithProgress.mockResolvedValue(undefined)
    reportVideoArrived.mockRejectedValue(new Error('down'))
    const key = startImport(request)
    await settle()
    expect(entry(key).status).toBe('done')
  })

  it('keeps the coded failure, and a retry runs it again from the same file', async () => {
    uploadVideoWithProgress.mockRejectedValueOnce(
      new RequestError('nope', 'import_source_missing', { file: 'lecture.mp4' }),
    )
    const key = startImport(request)
    await settle()
    expect(entry(key)).toMatchObject({
      status: 'error',
      failure: { code: 'import_source_missing' },
    })
    expect(reportVideoArrived).not.toHaveBeenCalled()
    uploadVideoWithProgress.mockResolvedValueOnce(undefined)
    retryImport(key)
    await settle()
    expect(entry(key)).toMatchObject({ status: 'done', failure: null })
    expect(entry(key).file).toBe(file)
  })

  it('cancels a running import without reporting an arrival', async () => {
    uploadVideoWithProgress.mockImplementation(
      (_c, _l, _f, _k, o) =>
        new Promise((_, reject) =>
          o.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))),
        ),
    )
    const key = startImport(request)
    await settle()
    cancelImport(key)
    await settle()
    expect(entry(key).status).toBe('cancelled')
    expect(reportVideoArrived).not.toHaveBeenCalled()
  })

  it('claims the names of running and done imports only', async () => {
    uploadVideoWithProgress.mockRejectedValue(new Error('x'))
    const failed = startImport({ ...request, lecture: 'Failed' })
    await settle()
    uploadVideoWithProgress.mockResolvedValue(undefined)
    startImport({ ...request, lecture: 'Done' })
    await settle()
    const names = claimedByImports(importEntries()).map((c) => c.lecture)
    expect(names).toContain('Done')
    expect(names).not.toContain('Failed')
    expect(entry(failed).status).toBe('error')
  })
})
