const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export type FileName = 'video.mp4' | 'audio.mp3' | 'transcript.txt' | 'summary.md' | 'summary.pdf'
export type FileStatus = Record<FileName, boolean>

export interface Lecture {
  name: string
  files: FileStatus
}

export interface Course {
  name: string
  lectures: Lecture[]
}

export type Step = 'audio' | 'transcribe' | 'summarize' | 'pdf' | 'all'

export interface StepResult {
  status: 'done' | 'error'
  message?: string
}

export async function fetchTree(): Promise<Course[]> {
  const res = await fetch('/api/tree')
  return res.json()
}

export async function fetchCourse(course: string): Promise<Course | null> {
  const res = await fetch(`/api/tree/${encodeURIComponent(course)}`)
  return res.json()
}

export async function runStep(course: string, lecture: string, step: Step): Promise<StepResult> {
  const res = await fetch(
    `${API_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/run/${step}`,
    { method: 'POST' },
  )
  return res.json()
}
