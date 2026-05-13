import type { FileName, Course, Kind } from '../types'

const DATABASE_URL = import.meta.env.VITE_DATABASE_URL ?? 'http://localhost:8001'

function httpError(res: Response): Error {
  return new Error(`${res.status} ${res.statusText}`)
}

function kindQuery(kind: Kind | undefined): string {
  return kind === 'recitation' ? '?kind=recitation' : ''
}

export const databaseUrl = DATABASE_URL

export function fileUrl(course: string, lecture: string, file: FileName, kind?: Kind): string {
  return `${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/files/${encodeURIComponent(file)}${kindQuery(kind)}`
}

export async function fetchTree(): Promise<Course[]> {
  const res = await fetch(`${DATABASE_URL}/tree`)
  if (!res.ok) throw httpError(res)
  return res.json()
}

export async function fetchCourse(course: string): Promise<Course | null> {
  const res = await fetch(`${DATABASE_URL}/courses/${encodeURIComponent(course)}`)
  return res.json()
}

export async function createCourse(name: string): Promise<void> {
  const res = await fetch(`${DATABASE_URL}/courses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw httpError(res)
}

export async function renameCourse(oldName: string, newName: string): Promise<void> {
  const res = await fetch(`${DATABASE_URL}/courses/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  })
  if (!res.ok) throw httpError(res)
}

export async function createLecture(course: string, name: string, kind?: Kind): Promise<void> {
  const res = await fetch(`${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures${kindQuery(kind)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw httpError(res)
}

export async function uploadVideo(course: string, lecture: string, file: File, kind?: Kind): Promise<void> {
  const res = await fetch(
    `${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/video${kindQuery(kind)}`,
    { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: file },
  )
  if (!res.ok) throw new Error('Upload failed')
}

export async function renameLecture(course: string, oldName: string, newName: string, kind?: Kind): Promise<void> {
  const res = await fetch(
    `${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(oldName)}${kindQuery(kind)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    },
  )
  if (!res.ok) throw httpError(res)
}

export async function deleteFile(course: string, lecture: string, file: FileName, kind?: Kind): Promise<void> {
  await fetch(
    `${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/files/${encodeURIComponent(file)}${kindQuery(kind)}`,
    { method: 'DELETE' },
  )
}

export async function fetchSummaryContent(course: string, lecture: string, kind?: Kind): Promise<{ content: string; hasOriginal: boolean }> {
  const res = await fetch(
    `${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/summary${kindQuery(kind)}`,
  )
  if (!res.ok) throw httpError(res)
  return res.json()
}

export async function saveSummaryContent(course: string, lecture: string, content: string, kind?: Kind): Promise<boolean> {
  const res = await fetch(
    `${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/summary${kindQuery(kind)}`,
    { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: content },
  )
  const data = await res.json()
  return data.ok
}

export async function revertSummary(course: string, lecture: string, kind?: Kind): Promise<boolean> {
  const res = await fetch(
    `${DATABASE_URL}/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/summary${kindQuery(kind)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw httpError(res)
  const data = await res.json()
  return data.ok
}
