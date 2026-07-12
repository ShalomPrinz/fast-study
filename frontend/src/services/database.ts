import type { FileName, Course, Kind, CourseFile, OverviewMetaRaw, OverviewMeta } from '@/types'
import { path, kindQuery, lectureBase, courseOverviewBase } from '@/shared/utils/url'
import { createClient } from './http'

const database = createClient(import.meta.env.VITE_DATABASE_URL ?? 'http://localhost:8001', 'database service')

export const databaseUrl = database.url('')

export function fileUrl(course: string, lecture: string, file: FileName, kind?: Kind): string {
  return database.url(lectureBase(course, lecture) + path`/files/${file}` + kindQuery(kind))
}

export async function fetchTree(): Promise<Course[]> {
  return database.get<Course[]>('/tree')
}

export async function createCourse(name: string): Promise<void> {
  await database.post('/courses', { json: { name } })
}

export async function renameCourse(oldName: string, newName: string): Promise<void> {
  await database.patch(path`/courses/${oldName}`, { json: { name: newName } })
}

export async function setCourseArchived(course: string, archived: boolean): Promise<void> {
  await database.patch(path`/courses/${course}/archived`, { json: { archived } })
}

export async function createLecture(course: string, name: string, kind?: Kind): Promise<void> {
  await database.post(
    path`/courses/${course}/lectures` + kindQuery(kind),
    { json: { name } },
  )
}

export async function uploadVideo(course: string, lecture: string, file: File, kind?: Kind): Promise<void> {
  await database.put(
    `${lectureBase(course, lecture)}/video${kindQuery(kind)}`,
    { headers: { 'Content-Type': 'video/mp4' }, body: file },
  )
}

export async function renameLecture(course: string, oldName: string, newName: string, kind?: Kind): Promise<void> {
  await database.patch(
    `${lectureBase(course, oldName)}${kindQuery(kind)}`,
    { json: { name: newName } },
  )
}

export async function deleteFile(course: string, lecture: string, file: FileName, kind?: Kind): Promise<void> {
  await database.delete(lectureBase(course, lecture) + path`/files/${file}` + kindQuery(kind))
}

export async function fetchSummaryContent(course: string, lecture: string, kind?: Kind): Promise<{ content: string; hasOriginal: boolean }> {
  return database.get<{ content: string; hasOriginal: boolean }>(
    `${lectureBase(course, lecture)}/summary${kindQuery(kind)}`,
  )
}

export async function saveSummaryContent(course: string, lecture: string, content: string, kind?: Kind): Promise<void> {
  await database.put(
    `${lectureBase(course, lecture)}/summary${kindQuery(kind)}`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: content },
  )
}

export async function revertSummary(course: string, lecture: string, kind?: Kind): Promise<void> {
  await database.delete(`${lectureBase(course, lecture)}/summary${kindQuery(kind)}`)
}

export async function fetchCourseFiles(course: string): Promise<CourseFile[]> {
  const raw = await database.get<{ files: CourseFile[] }>(courseOverviewBase(course) + '/files')
  return raw.files
}

export async function fetchCourseMeta(course: string): Promise<OverviewMeta> {
  const raw = await database.get<{ meta: OverviewMetaRaw }>(courseOverviewBase(course) + '/meta')
  const meta: OverviewMeta = {}
  for (const [slug, entry] of Object.entries(raw.meta)) {
    meta[slug] = { lectures: entry.lectures, recitations: entry.recitations, generatedAt: entry.generated_at }
  }
  return meta
}

export function overviewFileUrl(course: string, file: string): string {
  return database.url(courseOverviewBase(course) + path`/files/${file}`)
}
