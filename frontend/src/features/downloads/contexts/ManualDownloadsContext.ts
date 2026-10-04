import { useSyncExternalStore } from 'react'
import type { UrlDownload } from '@/features/downloads/services/downloadServer'
import type { StoredTarget } from '@/features/downloads/utils/manualDownload'

// One manual download this session: the body a retry re-posts, the job it currently follows, and
// where the server stored it. `key` is stable across retries, which swap in a new job.
export interface ManualEntry {
  key: number
  request: UrlDownload
  jobId: string
  target: StoredTarget
}

// Module store of this app session's manual downloads, newest first. The jobs carry `ref: null`, so
// nothing on the server ties them to the form — this list is the only link.
let entries: readonly ManualEntry[] = []
let nextKey = 0
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(next: readonly ManualEntry[]) {
  entries = next
  for (const listener of listeners) listener()
}

export function addManualEntry(request: UrlDownload, jobId: string, target: StoredTarget) {
  publish([{ key: nextKey++, request, jobId, target }, ...entries])
}

// A retry's new job replaces the entry's old one; the server already superseded it.
export function retargetManualEntry(key: number, jobId: string, target: StoredTarget) {
  publish(entries.map((e) => (e.key === key ? { ...e, jobId, target } : e)))
}

// Whether a job id belongs to the manual form — its failures read differently (a refused link is
// not an expired account).
export function isManualJob(id: string): boolean {
  return entries.some((e) => e.jobId === id)
}

export function manualEntries(): readonly ManualEntry[] {
  return entries
}

export function useManualEntries(): readonly ManualEntry[] {
  return useSyncExternalStore(subscribe, manualEntries)
}
