import type { RefObject } from 'react'
import type { ErrorParams, ServiceFailure } from '@/shared/i18n/serviceErrors'

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

// The intermediates a lecture can lose once a later stage is made from them.
export type RemovableFile = 'video.mp4' | 'audio.mp3'

export type FileInfo = {
  exists: boolean
  size: number | null
  mtime: number | null
  url?: string
  warning?: string
  // `video.mp4` only: seconds read from the MP4 header, omitted while absent, mid-download or unreadable.
  duration?: number
}
export type FileStatus = Record<FileName, FileInfo>

// A lecture's `material.<ext>` / `material.2.<ext>` file of any type; names are never reused. `filename`
// is the original name, `source` the discovery row's `ref`; `attach` is present only once set (absent = attached).
export type MaterialInfo = {
  name: string
  size: number
  mtime: number
  source?: string
  filename?: string
  attach?: boolean
}

export type TranscribePartial = { completed: number; total: number }

export type LectureDerived = {
  files: FileStatus | null
  materials: MaterialInfo[]
  transcribePartial: TranscribePartial | null
  removed: RemovableFile[]
}

export type TimingStats =
  | { message: 'not-enough-data' }
  | { shortest: number; longest: number; average: number; estimated: number }

export interface Lecture {
  name: string
  files: FileStatus
  // Always present, [] when none, ordered by material index ascending.
  materials: MaterialInfo[]
  // Disk names attached at the last Summarize (supported, attach not false), even if skipped as empty; null when none recorded.
  summaryMaterials: string[] | null
  transcribePartial: TranscribePartial | null
  // The video/audio missing from disk while a later stage's file is there, whoever deleted it; [] otherwise.
  removed: RemovableFile[]
  // The user marked it studied; always present.
  done: boolean
  // The discovery row's `ref` its video came from; absent for a hand-placed video. Kept after the video is removed.
  videoSource?: string
}

// One file of a course assignment; `source` is the discovery row's `ref`, absent on a hand-placed file.
export type AssignmentFile = {
  name: string
  size: number
  mtime: number
  source?: string
  // Whether the file goes to Gemini when a doc is generated; true unless the user switched it off.
  attach: boolean
}

export type AssignmentDocName = 'intuition' | 'solution'
// One generated doc's files; the tree holds null for a doc with no md yet.
export type AssignmentDocInfo = {
  md_mtime: number
  pdf_mtime: number | null
  pdf_warning: string | null
}
// A chosen course-material entry, by the name and kind that locate its summary.
export type AssignmentLecture = { name: string; kind: Kind }

export interface Assignment {
  name: string
  // Marked studied by the user; a downloaded file never changes it.
  done: boolean
  files: AssignmentFile[]
  // The chosen course material, existing entries only, in selection order.
  lectures: AssignmentLecture[]
  docs: Record<AssignmentDocName, AssignmentDocInfo | null>
}

export interface Course {
  name: string
  archived: boolean
  source_url: string | null
  // The database's resolved course-structure flag: its recitations list among its lectures.
  lectures_only: boolean
  lectures: Lecture[]
  recitations: Lecture[]
  // Always present, [] when none; never folded into lectures, whatever `lectures_only` says.
  assignments: Assignment[]
  // Discovery `ref`s the user marked irrelevant (or the downloader refused); always present.
  skipped: string[]
}

export type Kind = 'lecture' | 'recitation'

export type Step = 'audio' | 'transcribe' | 'summarize' | 'pdf' | 'drive'

// The runner also runs assignments, keyed by name in the lecture slot; they are never queued.
export type RunKind = Kind | 'assignment'
export type AssignmentStep = 'intuition' | 'solution' | 'intuition_pdf' | 'solution_pdf'

export interface CourseSummary {
  name: string
  kind: Kind
  content: string
}

export type DownloadOperation = 'download:curl' | 'download:ytdlp'
export type TimingOperation =
  Step | 'summarize_materials' | 'assignment_intuition' | 'assignment_solution' | DownloadOperation

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

export type RunInitResult = { status: 'started' } | { status: 'busy' }

// `not_queued`: the lecture started or left the queue before the move landed.
export type MoveToFrontResult = { status: 'moved' } | { status: 'not_queued' }

export interface Selected {
  course: string
  lecture: string
  kind: Kind
}

export interface InFlightEntry {
  course: string
  // The assignment's name when `kind` is `assignment`.
  lecture: string
  kind: RunKind
  step: string
  startedAt: string
}

// How far an entry's trigger may take it: `full` is every remaining step, `audio` stops at audio.mp3.
export type RunDepth = 'full' | 'audio'

export interface QueueEntry {
  course: string
  lecture: string
  kind: Kind
  depth: RunDepth
}

// A heads-up from the backend that is not a failure (docs/ERROR-CODES.md `model_fallback`). `id`
// is unique across both status endpoints and increases.
export interface Notice {
  id: number
  code: string
  params: ErrorParams
}

export interface RunnerStatus {
  // lastError: an unexpected exception that aborted a sweep, not a step-level failure.
  runner: { running: boolean; total: number; done: number; lastError: ServiceFailure | null }
  inFlight: InFlightEntry[]
  // What the runner has left to take, in the order it will take them. In-memory server-side, so a
  // backend restart empties it and those lectures become "not queued".
  queue: QueueEntry[]
  // Courses with an overview generation pending or running.
  overviewRunning: string[]
  // Expected step-level failures per lecture, from any trigger; persists after the run ends.
  errors: Record<string, RunError>
  notices: Notice[]
}

// A lecture's last step failure; `step` is the backend's step name, `code`/`params` the protocol's
// (repo-root docs/ERROR-CODES.md). `provider` marks a Gemini quota, and `blocked` a lecture run-all
// stopped at summarize on another lecture's quota, without calling Gemini itself.
export interface RunError {
  step: string
  message: string
  code: string | null
  params: ErrorParams
  provider: 'gemini' | null
  blocked: boolean
  // Present only while an automatic Gemini retry waits.
  retry: RetryInfo | null
}

// A waiting auto retry: `attempt` of `of`, firing at the UTC instant `at` (ISO).
export interface RetryInfo {
  attempt: number
  of: number
  at: string
}

export type CoursePhase = 'extract' | 'analyze' | 'topics' | 'compile' | 'to_pdf'

export interface OverviewExtractor {
  slug: string
  title: string
  phases: CoursePhase[]
}

export interface CourseExtractorState {
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error'
  message?: string
  code?: string | null
  params?: ErrorParams | null
  phase?: CoursePhase | null
  // ISO stamp of when this branch's phase chain began — one per chain, not per phase.
  startedAt?: string | null
  retry?: RetryInfo | null
}

export interface CourseStatus {
  running: boolean
  extractors: Record<string, CourseExtractorState>
  notices: Notice[]
}

export interface CourseFile {
  name: string
  size: number
  mtime: number
  // Set on {slug}.pdf when it rendered despite LaTeX errors but is still usable.
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

// One external binary as a service's `GET /tools` reports it: usable, or why not (docs/ERROR-CODES.md §lib/tools).
export type ToolStatus = 'ok' | { code: string; state: string; params: ErrorParams }
export type ToolReport = Record<string, ToolStatus>
