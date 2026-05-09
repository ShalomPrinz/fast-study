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
}

export type Step = 'audio' | 'transcribe' | 'summarize' | 'pdf' | 'drive'

export interface RateLimitInfo {
  limit: number | null
  used: number | null
  requested: number | null
  retryAfterSeconds: number | null
  message: string
  upgradeUrl: string | null
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
}

export interface LectureContext {
  files: FileStatus | null
  transcribePartial: { completed: number; total: number } | null
  refreshCourses: () => void
}
