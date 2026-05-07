/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'
import type { Course, Lecture } from '../src/types'

export const PREDEFINED_FILES = ['video.mp4', 'audio.mp3', 'transcript.txt', 'summary.md', 'summary.pdf', 'drive_url.txt']

export function readLectures(courseDir: string): Lecture[] {
  return fs
    .readdirSync(courseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((l) => {
      const lectureDir = path.join(courseDir, l.name)
      const files = Object.fromEntries(
        PREDEFINED_FILES.map((f) => {
          const p = path.join(lectureDir, f)
          const stat = fs.existsSync(p) ? fs.statSync(p) : null
          const url = (f === 'drive_url.txt' && stat) ? fs.readFileSync(p, 'utf-8').trim() : undefined
          return [f, { exists: !!stat, size: stat?.size ?? null, url }]
        })
      )
      return { name: l.name, files } as Lecture
    })
}

export function readTree(dataRoot: string): Course[] {
  if (!dataRoot || !fs.existsSync(dataRoot)) return []
  return fs
    .readdirSync(dataRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((course) => ({
      name: course.name,
      lectures: readLectures(path.join(dataRoot, course.name)),
    }))
}

export function readCourse(dataRoot: string, name: string): Course | null {
  const courseDir = path.join(dataRoot, name)
  if (!fs.existsSync(courseDir)) return null
  return { name, lectures: readLectures(courseDir) }
}
