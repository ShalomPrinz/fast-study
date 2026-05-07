export type FileName = 'video.mp4' | 'audio.mp3' | 'transcript.txt' | 'summary.md' | 'summary.pdf' | 'drive_url.txt'
export type FileInfo = { exists: boolean; size: number | null; url?: string }
export type FileStatus = Record<FileName, FileInfo>

export type TimingStats =
  | { message: 'not-enough-data' }
  | { shortest: number; longest: number; average: number; estimated: number }

export interface Lecture {
  name: string
  files: FileStatus
}

export interface Course {
  name: string
  lectures: Lecture[]
}

export type Step = 'audio' | 'transcribe' | 'summarize' | 'pdf' | 'drive'

export interface StepResult {
  status: 'done' | 'error'
  message?: string
  url?: string
}

export interface Selected {
  course: string
  lecture: string
}
