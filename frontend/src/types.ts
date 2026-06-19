import type { RefObject } from 'react'

export interface InlineEdit {
  value: string
  setValue: (v: string) => void
  ref: RefObject<HTMLInputElement>
}

export type FileName =
  | 'video.mp4'
  | 'audio.mp3'
  | 'transcript.txt'
  | 'transcript.partial.txt'
  | 'summary.md'
  | 'summary.pdf'
  | 'drive_url.txt'
  | 'material.pdf'
export type FileInfo = { exists: boolean; size: number | null; mtime: number | null; url?: string }
export type FileStatus = Record<FileName, FileInfo>

export type TranscribePartial = { completed: number; total: number }

export type LectureDerived = {
  files: FileStatus | null
  transcribePartial: TranscribePartial | null
}

export type TimingStats =
  | { message: 'not-enough-data' }
  | { shortest: number; longest: number; average: number; estimated: number }

export interface Lecture {
  name: string
  files: FileStatus
  transcribePartial: TranscribePartial | null
}

export interface Course {
  name: string
  archived: boolean
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

export type RunInitResult =
  | { status: 'started' }
  | { status: 'busy' }
  | { status: 'error'; message: string }

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
  // runner.lastError: unexpected exception that aborted a lecture's pipeline mid-sweep
  runner: { running: boolean; total: number; done: number; lastError: string | null }
  inFlight: InFlightEntry[]
  // expected step-level failures, per lecture, from any trigger
  errors: Record<string, string>
}

