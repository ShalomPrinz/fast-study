/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'
import type { Course, Lecture } from '../src/types'

export const PREDEFINED_FILES = ['video.mp4', 'audio.mp3', 'transcript.txt', 'transcript.partial.txt', 'summary.md', 'summary.pdf', 'drive_url.txt']

export const RECITATIONS_DIR = 'Recitations'

function readTranscribePartial(lectureDir: string): { completed: number; total: number } | null {
  const metaPath = path.join(lectureDir, 'transcript.partial.meta.json')
  if (!fs.existsSync(metaPath)) return null
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    if (typeof meta.completed_chunks === 'number' && typeof meta.total_chunks === 'number') {
      return { completed: meta.completed_chunks, total: meta.total_chunks }
    }
    return null
  } catch {
    return null
  }
}

function readLectureDir(lectureDir: string, name: string): Lecture {
  const files = Object.fromEntries(
    PREDEFINED_FILES.map((f) => {
      const p = path.join(lectureDir, f)
      const stat = fs.existsSync(p) ? fs.statSync(p) : null
      const url = (f === 'drive_url.txt' && stat) ? fs.readFileSync(p, 'utf-8').trim() : undefined
      return [f, { exists: !!stat, size: stat?.size ?? null, url }]
    })
  )
  return { name, files, transcribePartial: readTranscribePartial(lectureDir) } as Lecture
}

export function readLectures(courseDir: string): Lecture[] {
  return fs
    .readdirSync(courseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== RECITATIONS_DIR)
    .map((l) => readLectureDir(path.join(courseDir, l.name), l.name))
}

export function readRecitations(courseDir: string): Lecture[] {
  const recDir = path.join(courseDir, RECITATIONS_DIR)
  if (!fs.existsSync(recDir)) return []
  return fs
    .readdirSync(recDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((l) => readLectureDir(path.join(recDir, l.name), l.name))
}

export function readTree(dataRoot: string): Course[] {
  if (!dataRoot || !fs.existsSync(dataRoot)) return []
  return fs
    .readdirSync(dataRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((course) => {
      const courseDir = path.join(dataRoot, course.name)
      return {
        name: course.name,
        lectures: readLectures(courseDir),
        recitations: readRecitations(courseDir),
      }
    })
}

export function readCourse(dataRoot: string, name: string): Course | null {
  const courseDir = path.join(dataRoot, name)
  if (!fs.existsSync(courseDir)) return null
  return { name, lectures: readLectures(courseDir), recitations: readRecitations(courseDir) }
}
