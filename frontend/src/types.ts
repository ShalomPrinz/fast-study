import type { RefObject } from 'react'

export interface InlineEdit {
  value: string
  setValue: (v: string) => void
  ref: RefObject<HTMLInputElement>
}

export interface ExpandHandle {
  isOpen: boolean
  toggle: () => void
  open: () => void
}

export type FileName =
  | 'video.mp4'
  | 'audio.mp3'
  | 'transcript.txt'
  | 'transcript.partial.txt'
  | 'summary.md'
  | 'summary.pdf'
  | 'drive_url.txt'

export type FileInfo = {
  exists: boolean
  size: number | null
  mtime: number | null
  url?: string
  warning?: string
}
export type FileStatus = Record<FileName, FileInfo>

// One of a lecture's `material.pdf`, `material.2.pdf`, … — presence in the list is existence,
// and names are never reused, so a URL held by name stays valid after a sibling is deleted.
export type MaterialInfo = { name: string; size: number; mtime: number }

export type TranscribePartial = { completed: number; total: number }

export type LectureDerived = {
  files: FileStatus | null
  materials: MaterialInfo[]
  transcribePartial: TranscribePartial | null
}

export type TimingStats =
  | { message: 'not-enough-data' }
  | { shortest: number; longest: number; average: number; estimated: number }

export interface Lecture {
  name: string
  files: FileStatus
  // Always present, [] when none, ordered by material index ascending.
  materials: MaterialInfo[]
  transcribePartial: TranscribePartial | null
}

export interface Course {
  name: string
  archived: boolean
  source_url: string | null
  lectures: Lecture[]
  recitations: Lecture[]
}

export type Kind = 'lecture' | 'recitation'

export type Step = 'audio' | 'transcribe' | 'summarize' | 'pdf' | 'drive'

export interface CourseSummary {
  name: string
  kind: Kind
  content: string
}

export type DownloadOperation = 'download:curl' | 'download:ytdlp'
export type TimingOperation = Step | DownloadOperation

export interface RateLimitInfo {
  limit: number | null
  used: number | null
  requested: number | null
  retryAfterSeconds: number | null
}

export interface RateLimitProgress {
  completed: number | null
  total: number | null
}

export type RunInitResult =
  { status: 'started' } | { status: 'busy' } | { status: 'error'; message: string }

export interface Selected {
  course: string
  lecture: string
  kind: Kind
}

export interface InFlightEntry {
  course: string
  lecture: string
  kind: Kind
  step: string
  startedAt: string
  sleepingUntil: string | null
  progress: { completed: number; total: number } | null
}

export interface RunnerStatus {
  // lastError: an unexpected exception that aborted a sweep, not a step-level failure.
  runner: { running: boolean; total: number; done: number; lastError: string | null }
  inFlight: InFlightEntry[]
  // Expected step-level failures per lecture, from any trigger; persists after the run ends.
  errors: Record<string, string>
}

export type AppMode = 'lectures' | 'courses'

export type CoursePhase = 'extract' | 'analyze' | 'topics' | 'compile' | 'to_pdf'

export interface OverviewExtractor {
  slug: string
  title: string
  phases: CoursePhase[]
}

export interface CourseExtractorState {
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error'
  message?: string
  phase?: CoursePhase | null
}

export interface CourseStatus {
  running: boolean
  extractors: Record<string, CourseExtractorState>
}

export interface CourseFile {
  name: string
  size: number
  mtime: number
  // Set on {slug}.pdf when it rendered despite XeLaTeX errors but is still usable.
  warning?: string
}

// Non-fatal marker shown on a rendered PDF: bad render, or out of sync with its source.
export type PdfBadge = { kind: 'warning' | 'stale'; title: string }

export type OverviewRange = { start: string; end: string } | null

export type OverviewMetaRaw = Record<
  string /* slug */,
  { lectures: OverviewRange; recitations: OverviewRange; generated_at: string }
>

export type OverviewMeta = Record<
  string /* slug */,
  { lectures: OverviewRange; recitations: OverviewRange; generatedAt: string }
>
