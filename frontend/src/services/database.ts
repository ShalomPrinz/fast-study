import type { FileName, Course, Kind } from '../types'
import { createClient, httpError, kindQuery } from './http'

const database = createClient(import.meta.env.VITE_DATABASE_URL ?? 'http://localhost:8001')

export const databaseUrl = database.url('')

export function fileUrl(course: string, lecture: string, file: FileName, kind?: Kind): string {
  return database.url(
    `/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/files/${encodeURIComponent(file)}${kindQuery(kind)}`,
  )
}

export async function fetchTree(): Promise<Course[]> {
  return database.get<Course[]>('/tree')
}

export async function fetchCourse(course: string): Promise<Course | null> {
  return database.get<Course | null>(`/courses/${encodeURIComponent(course)}`)
}

export async function createCourse(name: string): Promise<void> {
  await database.post<unknown>('/courses', { json: { name } })
}

export async function renameCourse(oldName: string, newName: string): Promise<void> {
  const res = await database.request(`/courses/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    json: { name: newName },
  })
  if (!res.ok) throw httpError(res)
}

export async function createLecture(course: string, name: string, kind?: Kind): Promise<void> {
  await database.post<unknown>(
    `/courses/${encodeURIComponent(course)}/lectures${kindQuery(kind)}`,
    { json: { name } },
  )
}

export async function uploadVideo(course: string, lecture: string, file: File, kind?: Kind): Promise<void> {
  const res = await database.request(
    `/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/video${kindQuery(kind)}`,
    { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: file },
  )
  if (!res.ok) throw new Error('Upload failed')
}

export async function renameLecture(course: string, oldName: string, newName: string, kind?: Kind): Promise<void> {
  const res = await database.request(
    `/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(oldName)}${kindQuery(kind)}`,
    { method: 'PATCH', json: { name: newName } },
  )
  if (!res.ok) throw httpError(res)
}

export async function deleteFile(course: string, lecture: string, file: FileName, kind?: Kind): Promise<void> {
  await database.delete<{ ok: boolean }>(
    `/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/files/${encodeURIComponent(file)}${kindQuery(kind)}`,
  )
}

export async function fetchSummaryContent(course: string, lecture: string, kind?: Kind): Promise<{ content: string; hasOriginal: boolean }> {
  return database.get<{ content: string; hasOriginal: boolean }>(
    `/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/summary${kindQuery(kind)}`,
  )
}

export async function saveSummaryContent(course: string, lecture: string, content: string, kind?: Kind): Promise<boolean> {
  const data = await database.put<{ ok: boolean }>(
    `/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/summary${kindQuery(kind)}`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: content },
  )
  return data.ok
}

export async function revertSummary(course: string, lecture: string, kind?: Kind): Promise<boolean> {
  const data = await database.delete<{ ok: boolean }>(
    `/courses/${encodeURIComponent(course)}/lectures/${encodeURIComponent(lecture)}/summary${kindQuery(kind)}`,
  )
  return data.ok
}
