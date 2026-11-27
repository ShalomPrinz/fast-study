export type ImportMode = 'copy' | 'move'

// Same rule as the sidebar's drop: the name or the type says .mp4.
export function isMp4(file: Pick<File, 'name' | 'type'>): boolean {
  return file.name.toLowerCase().endsWith('.mp4') || file.type === 'video/mp4'
}

export type DropVerdict =
  { kind: 'file'; file: File } | { kind: 'none' } | { kind: 'many' } | { kind: 'not-mp4' }

// What a drop does to the tab: one .mp4 is taken, anything else says why not.
export function classifyDrop(files: readonly File[]): DropVerdict {
  if (files.length === 0) return { kind: 'none' }
  if (files.length > 1) return { kind: 'many' }
  return isMp4(files[0]) ? { kind: 'file', file: files[0] } : { kind: 'not-mp4' }
}

// How an import reaches the database: by path (the desktop app), by uploading the bytes (a plain
// browser's Copy), or not at all (a plain browser's Move — there is no path to move).
export type ImportRoute = 'path' | 'upload' | 'unavailable'

export function importRoute(mode: ImportMode, path: string): ImportRoute {
  if (path) return 'path'
  return mode === 'copy' ? 'upload' : 'unavailable'
}

// The File's absolute path through the preload bridge; '' in a plain browser.
export function pathOf(
  file: File,
  bridge: { pathForFile?: (file: File) => string } | undefined,
): string {
  return bridge?.pathForFile?.(file) ?? ''
}

export type ImportBlocker =
  'no-file' | 'no-course' | 'no-name' | 'busy' | 'importing' | 'desktop-only'

// Whether an import of this status already targets the lecture; names compare casefolded and trimmed.
// A done import counts only if it finished after `treeAt`: once the tree has refreshed, the tree is the truth.
export function importsInto(
  list: readonly {
    course: string
    lecture: string
    kind: string
    status: ImportStatus
    doneAt: number | null
  }[],
  target: { course: string; lecture: string; kind: string },
  status: ImportStatus,
  treeAt = 0,
): boolean {
  const norm = (s: string) => s.trim().toLowerCase()
  return list.some(
    (e) =>
      e.status === status &&
      (status !== 'done' || (e.doneAt ?? 0) > treeAt) &&
      e.kind === target.kind &&
      norm(e.course) === norm(target.course) &&
      norm(e.lecture) === norm(target.lecture),
  )
}

// The first reason Copy or Move is disabled, in the order the user can fix them; null when ready.
export function importBlocker(s: {
  hasFile: boolean
  course: string
  name: string
  busy: boolean
  importing: boolean
  route: ImportRoute
}): ImportBlocker | null {
  if (!s.hasFile) return 'no-file'
  if (!s.course) return 'no-course'
  if (!s.name.trim()) return 'no-name'
  if (s.busy) return 'busy'
  if (s.importing) return 'importing'
  if (s.route === 'unavailable') return 'desktop-only'
  return null
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

// 1536 -> "1.5 KB"; one decimal below 10, none above.
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`
}

// Whole percent, 0 while the total is unknown, never past 100.
export function percentOf(copied: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.floor((copied / total) * 100))
}

export type ImportStatus = 'running' | 'done' | 'error' | 'cancelled'

// What the polite live region says when an entry moves from `prev` (undefined = just added, running again = a retry) to `next`:
// start, done and failure only — never progress, never a cancel the user just asked for.
export function importAnnouncement(
  prev: ImportStatus | undefined,
  next: ImportStatus,
): 'start' | 'done' | 'error' | null {
  if (prev === next) return null
  if (next === 'running') return 'start'
  return next === 'done' || next === 'error' ? next : null
}

// Once every byte is copied or sent the video is stored, so Cancel would only mislabel a success.
export function canCancelImport(copied: number, total: number): boolean {
  return total <= 0 || copied < total
}

// The statuses already on screen at mount, so only transitions seen while mounted are announced.
export function seenAtMount(list: readonly { key: number; status: ImportStatus }[]) {
  return new Map<number, ImportStatus>(list.map((e) => [e.key, e.status]))
}
