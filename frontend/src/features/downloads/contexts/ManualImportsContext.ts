import { useSyncExternalStore } from 'react'
import type { Kind } from '@/types'
import { importVideo, uploadVideoWithProgress } from '@/services/database'
import { reportVideoArrived } from '@/services/backend'
import { runtimeBridge } from '@/services/runtime'
import { failureOf } from '@/shared/utils/failure'
import type { ServiceFailure } from '@/shared/i18n/serviceErrors'
import { importRoute, pathOf, type ImportMode } from '@/features/downloads/utils/fileImport'

// One local-file import this session. `key` is stable across retries; `file` stays for Retry.
export interface ImportEntry {
  key: number
  file: File
  mode: ImportMode
  course: string
  lecture: string
  kind: Kind
  status: 'running' | 'done' | 'error' | 'cancelled'
  copied: number
  total: number
  originalKept: boolean
  failure: ServiceFailure | null
}

export type ImportRequest = Pick<ImportEntry, 'file' | 'mode' | 'course' | 'lecture' | 'kind'>

// Module store, newest first, so an import runs on while the user is on other pages.
let entries: readonly ImportEntry[] = []
let nextKey = 0
const listeners = new Set<() => void>()
const controllers = new Map<number, AbortController>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(next: readonly ImportEntry[]) {
  entries = next
  for (const listener of listeners) listener()
}

function patch(key: number, change: Partial<ImportEntry>) {
  publish(entries.map((e) => (e.key === key ? { ...e, ...change } : e)))
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

async function run(key: number) {
  const entry = entries.find((e) => e.key === key)
  if (!entry) return
  const { file, mode, course, lecture, kind } = entry
  const controller = new AbortController()
  controllers.set(key, controller)
  patch(key, {
    status: 'running',
    copied: 0,
    total: file.size,
    originalKept: false,
    failure: null,
  })
  const onProgress = (copied: number, total: number) => patch(key, { copied, total })
  const opts = { signal: controller.signal, onProgress }
  try {
    const path = pathOf(file, runtimeBridge())
    let originalKept = false
    if (importRoute(mode, path) === 'path') {
      originalKept = (await importVideo(course, lecture, { path, mode }, kind, opts)).originalKept
    } else {
      await uploadVideoWithProgress(course, lecture, file, kind, opts)
    }
    // The bytes are stored, so a failed report leaves the user to run by hand, as `uploadVideo` does.
    try {
      await reportVideoArrived(course, lecture, kind)
    } catch (err) {
      console.error('failed to report video arrival', err)
    }
    patch(key, { status: 'done', copied: file.size, total: file.size, originalKept })
  } catch (err) {
    if (isAbort(err) || controller.signal.aborted) patch(key, { status: 'cancelled' })
    else patch(key, { status: 'error', failure: failureOf(err) })
  } finally {
    controllers.delete(key)
  }
}

// Begins an import at once; the caller has already created the course and confirmed any overwrite.
export function startImport(request: ImportRequest): number {
  const key = nextKey++
  publish([
    {
      ...request,
      key,
      status: 'running',
      copied: 0,
      total: request.file.size,
      originalKept: false,
      failure: null,
    },
    ...entries,
  ])
  void run(key)
  return key
}

export function retryImport(key: number) {
  if (controllers.has(key)) return
  void run(key)
}

export function cancelImport(key: number) {
  controllers.get(key)?.abort()
}

export function importEntries(): readonly ImportEntry[] {
  return entries
}

export function useImportEntries(): readonly ImportEntry[] {
  return useSyncExternalStore(subscribe, importEntries)
}

// The names running and done imports hold, for `suggestManualName` — a running one isn't in the tree yet.
export function claimedByImports(
  list: readonly ImportEntry[],
): { course: string; lecture: string; kind: Kind }[] {
  return list
    .filter((e) => e.status === 'running' || e.status === 'done')
    .map(({ course, lecture, kind }) => ({ course, lecture, kind }))
}
