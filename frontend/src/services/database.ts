import type {
  FileName,
  Course,
  Kind,
  CourseFile,
  CourseSummary,
  AssignmentDocName,
  AssignmentLecture,
  OverviewMetaRaw,
  OverviewMeta,
  MergedPdf,
} from '@/types'
import {
  path,
  kindQuery,
  lectureBase,
  assignmentBase,
  courseOverviewBase,
  mergedBase,
  headingsBase,
} from '@/shared/utils/url'
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

// Sets whether Summarize sends this material to Gemini; the tree's SSE refresh brings the new state.
export async function setMaterialAttach(
  course: string,
  lecture: string,
  name: string,
  attach: boolean,
  kind?: Kind,
): Promise<void> {
  await database.patch(lectureBase(course, lecture) + path`/materials/${name}` + kindQuery(kind), {
    json: { attach },
  })
}

// One file of a course assignment, for the browser-dev new tab; packaged opens go through the bridge.
export function assignmentFileUrl(course: string, assignment: string, name: string): string {
  return database.url(assignmentBase(course, assignment) + path`/files/${name}`)
}

// One `.generated/` file of an assignment (`{doc}.pdf`), for the browser-dev new tab.
export function assignmentGeneratedUrl(course: string, assignment: string, name: string): string {
  return database.url(assignmentBase(course, assignment) + path`/generated/${name}`)
}

// Sets whether one assignment file goes to Gemini; the tree's SSE refresh brings the new state.
export async function setAssignmentFileAttach(
  course: string,
  assignment: string,
  name: string,
  attach: boolean,
): Promise<void> {
  await database.patch(assignmentBase(course, assignment) + path`/files/${name}`, {
    json: { attach },
  })
}

// Replaces the assignment's course-material selection; the tree's SSE refresh brings the new state.
export async function setAssignmentLectures(
  course: string,
  assignment: string,
  lectures: AssignmentLecture[],
): Promise<void> {
  await database.put(`${assignmentBase(course, assignment)}/lectures`, { json: { lectures } })
}

export async function fetchAssignmentDoc(
  course: string,
  assignment: string,
  doc: AssignmentDocName,
): Promise<{ content: string; hasOriginal: boolean }> {
  return database.get<{ content: string; hasOriginal: boolean }>(
    assignmentBase(course, assignment) + path`/docs/${doc}`,
  )
}

export async function saveAssignmentDoc(
  course: string,
  assignment: string,
  doc: AssignmentDocName,
  content: string,
): Promise<void> {
  await database.put(assignmentBase(course, assignment) + path`/docs/${doc}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: content,
  })
}

export async function revertAssignmentDoc(
  course: string,
  assignment: string,
  doc: AssignmentDocName,
): Promise<void> {
  await database.delete(assignmentBase(course, assignment) + path`/docs/${doc}`)
}

export async function fetchTree(): Promise<Course[]> {
  return database.get<Course[]>('/tree')
}

// The live course-structure mode, never null; only what a course the tree lacks yet would be.
export async function fetchCourseStructure(): Promise<string> {
  const raw = await database.get<{ course_structure: string }>('/course_structure')
  return raw.course_structure
}

export async function setCourseLecturesOnly(course: string, lecturesOnly: boolean): Promise<void> {
  await database.patch(path`/courses/${course}/lectures_only`, {
    json: { lectures_only: lecturesOnly },
  })
}

// Adds and removes discovery `ref`s in the course's skip set; idempotent, answers the resulting set.
export async function updateSkipped(
  course: string,
  change: { add?: string[]; remove?: string[] },
): Promise<string[]> {
  const { refs } = await database.post<{ refs: string[] }>(path`/courses/${course}/skipped`, {
    json: change,
  })
  return refs
}

/** Answers the folder name the create made, which the database may have sanitized. */
export async function createCourse(name: string, source_url?: string | null): Promise<string> {
  const res = await database.post<{ name: string }>('/courses', {
    json: { name, source_url: source_url || null },
  })
  return res.name
}

export async function setCourseSourceUrl(course: string, source_url: string | null): Promise<void> {
  await database.patch(path`/courses/${course}/source_url`, {
    json: { source_url: source_url || null },
  })
}

/** Answers the folder name the rename created, which the database may have sanitized. */
export async function renameCourse(oldName: string, newName: string): Promise<string> {
  const { name } = await database.patch<{ name: string }>(path`/courses/${oldName}`, {
    json: { name: newName },
  })
  return name
}

// Marks a lecture or recitation studied, or back to not; idempotent either way.
export async function setLectureDone(
  course: string,
  lecture: string,
  done: boolean,
  kind?: Kind,
): Promise<void> {
  const url = `${lectureBase(course, lecture)}/done${kindQuery(kind)}`
  await (done ? database.put(url) : database.delete(url))
}

// Marks a course assignment studied, or back to not; idempotent either way.
export async function setAssignmentDone(
  course: string,
  assignment: string,
  done: boolean,
): Promise<void> {
  const url = `${assignmentBase(course, assignment)}/done`
  await (done ? database.put(url) : database.delete(url))
}

/** Answers the folder name the create made, which the database may have sanitized. */
export async function createLecture(course: string, name: string, kind?: Kind): Promise<string> {
  const { name: created } = await database.post<{ name: string }>(
    path`/courses/${course}/lectures` + kindQuery(kind),
    { json: { name } },
  )
  return created
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
  // Announced here so no caller silently loses auto-run. A failed report is swallowed: the bytes are
  // stored, and the user can still run by hand.
  try {
    await reportVideoArrived(course, lecture, kind)
  } catch (err) {
    console.error('failed to report video arrival', err)
  }
}

/** Answers the folder name the rename created, which the database may have sanitized. */
export async function renameLecture(
  course: string,
  oldName: string,
  newName: string,
  kind?: Kind,
): Promise<string> {
  const { name } = await database.patch<{ name: string }>(
    `${lectureBase(course, oldName)}${kindQuery(kind)}`,
    { json: { name: newName } },
  )
  return name
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

// The names in the lecture's `figures/` folder, the only images the PDF render keeps.
export async function fetchFigureNames(
  course: string,
  lecture: string,
  kind?: Kind,
): Promise<string[]> {
  const res = await database.get<{ figures: string[] }>(
    `${lectureBase(course, lecture)}/figures${kindQuery(kind)}`,
  )
  return res.figures
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

interface RawMergedPdf {
  name: string
  title: string
  created_at: string
  stale: boolean
  parts: { name: string; kind: Kind; pdf_mtime: string; exists: boolean }[]
}

/** Each lecture's and recitation's first summary heading, keyed `kind:name` like `partKey`; items without one are absent. */
export async function fetchCourseHeadings(course: string): Promise<Record<string, string>> {
  return (await database.get<{ headings: Record<string, string> }>(headingsBase(course))).headings
}

/** A course's merged PDFs, newest first; only those whose PDF exists. */
export async function fetchMergedPdfs(course: string): Promise<MergedPdf[]> {
  const raw = await database.get<{ merged: RawMergedPdf[] }>(mergedBase(course))
  return raw.merged.map((m) => ({
    name: m.name,
    title: m.title,
    createdAt: m.created_at,
    stale: m.stale,
    parts: m.parts.map((p) => ({
      name: p.name,
      kind: p.kind,
      pdfMtime: p.pdf_mtime,
      exists: p.exists,
    })),
  }))
}

// A merged PDF by its file name, for the browser-dev new tab; packaged opens go through the bridge.
export function mergedPdfUrl(course: string, name: string): string {
  return database.url(mergedBase(course) + path`/${name}/pdf`)
}
