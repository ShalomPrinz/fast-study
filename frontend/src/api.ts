const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export type FileName = 'video.mp4' | 'audio.mp3' | 'transcript.txt' | 'summary.md' | 'summary.pdf'
export type FileInfo = { exists: boolean; size: number | null }
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

export type Step = 'audio' | 'transcribe' | 'summarize' | 'pdf'

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

export async function createLecture(course: string, name: string): Promise<void> {
  await fetch(`/api/tree/${encodeURIComponent(course)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function uploadVideo(course: string, lecture: string, file: File): Promise<void> {
  const res = await fetch(
    `/api/tree/${encodeURIComponent(course)}/${encodeURIComponent(lecture)}`,
    { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: file },
  )
  if (!res.ok) throw new Error('Upload failed')
}

export async function renameLecture(course: string, oldName: string, newName: string): Promise<void> {
  await fetch(`/api/tree/${encodeURIComponent(course)}/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  })
}

export async function runStep(course: string, lecture: string, step: Step): Promise<StepResult> {
  const res = await fetch(
    `${API_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/run/${step}`,
    { method: 'POST' },
  )
  return res.json()
}

export async function fetchTimingStats(operation: string, fileSizeBytes: number): Promise<TimingStats> {
  const res = await fetch(`${API_URL}/timing/${operation}?file_size_bytes=${fileSizeBytes}`)
  return res.json()
}
