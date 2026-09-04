import type {
  FileName,
  Course,
  Kind,
  CourseFile,
  CourseSummary,
  OverviewMetaRaw,
  OverviewMeta,
} from '@/types'
import { path, kindQuery, lectureBase, courseOverviewBase } from '@/shared/utils/url'
import { createClient } from './http'
import { reportVideoArrived } from './backend'
import { DATABASE_URL } from './runtime'

const database = createClient(DATABASE_URL, 'database service')

export const databaseUrl = database.url('')

export function fileUrl(course: string, lecture: string, file: FileName, kind?: Kind): string {
  return database.url(lectureBase(course, lecture) + path`/files/${file}` + kindQuery(kind))
}

// Materials are named at upload time (material.pdf, material.2.pdf, …), so they address the same
// per-file routes by a runtime name rather than a FileName from the fixed predefined set.
export function materialUrl(course: string, lecture: string, name: string, kind?: Kind): string {
  return database.url(lectureBase(course, lecture) + path`/files/${name}` + kindQuery(kind))
}

export async function deleteMaterial(
  course: string,
  lecture: string,
  name: string,
  kind?: Kind,
): Promise<void> {
  await database.delete(lectureBase(course, lecture) + path`/files/${name}` + kindQuery(kind))
}

export async function fetchTree(): Promise<Course[]> {
  return database.get<Course[]>('/tree')
}

export async function createCourse(name: string, source_url?: string | null): Promise<void> {
  await database.post('/courses', { json: { name, source_url: source_url || null } })
}

export async function setCourseSourceUrl(course: string, source_url: string | null): Promise<void> {
  await database.patch(path`/courses/${course}/source_url`, {
    json: { source_url: source_url || null },
  })
}

export async function renameCourse(oldName: string, newName: string): Promise<void> {
  await database.patch(path`/courses/${oldName}`, { json: { name: newName } })
}

export async function setCourseArchived(course: string, archived: boolean): Promise<void> {
  await database.patch(path`/courses/${course}/archived`, { json: { archived } })
}

export async function createLecture(course: string, name: string, kind?: Kind): Promise<void> {
  await database.post(path`/courses/${course}/lectures` + kindQuery(kind), { json: { name } })
}

export async function uploadVideo(
  course: string,
  lecture: string,
  file: File,
  kind?: Kind,
): Promise<void> {
  await database.put(`${lectureBase(course, lecture)}/video${kindQuery(kind)}`, {
    headers: { 'Content-Type': 'video/mp4' },
    body: file,
  })
  // Uploading a video means announcing it too, or the next call site silently loses auto-run — a
  // concern spanning both services by design, like the settings boundary in `settings.ts`.
  // A failed report is swallowed: the bytes are stored, and the user can still run by hand.
  try {
    await reportVideoArrived(course, lecture, kind)
  } catch (err) {
    console.error('failed to report video arrival', err)
  }
}

export async function renameLecture(
  course: string,
  oldName: string,
  newName: string,
  kind?: Kind,
): Promise<void> {
  await database.patch(`${lectureBase(course, oldName)}${kindQuery(kind)}`, {
    json: { name: newName },
  })
}

export async function deleteFile(
  course: string,
  lecture: string,
  file: FileName,
  kind?: Kind,
): Promise<void> {
  await database.delete(lectureBase(course, lecture) + path`/files/${file}` + kindQuery(kind))
}

export async function fetchSummaryContent(
  course: string,
  lecture: string,
  kind?: Kind,
): Promise<{ content: string; hasOriginal: boolean }> {
  return database.get<{ content: string; hasOriginal: boolean }>(
    `${lectureBase(course, lecture)}/summary${kindQuery(kind)}`,
  )
}

export async function saveSummaryContent(
  course: string,
  lecture: string,
  content: string,
  kind?: Kind,
): Promise<void> {
  await database.put(`${lectureBase(course, lecture)}/summary${kindQuery(kind)}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: content,
  })
}

export async function revertSummary(course: string, lecture: string, kind?: Kind): Promise<void> {
  await database.delete(`${lectureBase(course, lecture)}/summary${kindQuery(kind)}`)
}

export async function fetchCourseSummaries(course: string): Promise<CourseSummary[]> {
  const raw = await database.get<{ summaries: CourseSummary[] }>(path`/courses/${course}/summaries`)
  return raw.summaries
}

export async function fetchCourseFiles(course: string): Promise<CourseFile[]> {
  const raw = await database.get<{ files: CourseFile[] }>(courseOverviewBase(course) + '/files')
  return raw.files
}

export async function fetchCourseMeta(course: string): Promise<OverviewMeta> {
  const raw = await database.get<{ meta: OverviewMetaRaw }>(courseOverviewBase(course) + '/meta')
  const meta: OverviewMeta = {}
  for (const [slug, entry] of Object.entries(raw.meta)) {
    meta[slug] = {
      lectures: entry.lectures,
      recitations: entry.recitations,
      generatedAt: entry.generated_at,
    }
  }
  return meta
}

export function overviewFileUrl(course: string, file: string): string {
  return database.url(courseOverviewBase(course) + path`/files/${file}`)
}
