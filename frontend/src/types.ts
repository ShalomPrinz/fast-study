export type FileName =
  | 'video.mp4'
  | 'audio.mp3'
  | 'transcript.txt'
  | 'transcript.partial.txt'
  | 'summary.md'
  | 'summary.pdf'
  | 'drive_url.txt'
export type FileInfo = { exists: boolean; size: number | null; url?: string }
export type FileStatus = Record<FileName, FileInfo>

export type TimingStats =
  | { message: 'not-enough-data' }
  | { shortest: number; longest: number; average: number; estimated: number }

export interface Lecture {
  name: string
  files: FileStatus
  transcribePartial: { completed: number; total: number } | null
}

export interface Course {
  name: string
  lectures: Lecture[]
  recitations: Lecture[]
}

export type Kind = 'lecture' | 'recitation'

export type Step = 'audio' | 'transcribe' | 'summarize' | 'pdf' | 'drive'

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

export type StepResult =
  | { status: 'done'; url?: string }
  | { status: 'error'; message: string }
  | { status: 'rate_limited'; rateLimit: RateLimitInfo; progress: RateLimitProgress }

export interface Selected {
  course: string
  lecture: string
  kind: Kind
}

export interface ResumeStatus {
  running: boolean
  total: number
  done: number
  current: { course: string; lecture: string; kind: Kind; step: string } | null
  sleepingUntil: string | null
  lastError: string | null
}

export interface LectureContext {
  files: FileStatus | null
  transcribePartial: { completed: number; total: number } | null
  refreshCourses: () => void
  kind: Kind
}
