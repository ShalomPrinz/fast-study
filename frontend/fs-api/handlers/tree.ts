/// <reference types="node" />
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { readTree, readCourse, RECITATIONS_DIR } from '../fs-reader'

function parseUrl(rawUrl: string): { suffix: string; isRecitation: boolean } {
  const [pathPart, queryPart = ''] = rawUrl.split('?')
  const params = new URLSearchParams(queryPart)
  return { suffix: pathPart, isRecitation: params.get('kind') === 'recitation' }
}

function resolveCourseTarget(dataRoot: string, courseName: string, isRecitation: boolean): string {
  return isRecitation
    ? path.join(dataRoot, courseName, RECITATIONS_DIR)
    : path.join(dataRoot, courseName)
}

function resolveLectureTarget(
  dataRoot: string,
  courseName: string,
  lectureName: string,
  isRecitation: boolean,
): string {
  return isRecitation
    ? path.join(dataRoot, courseName, RECITATIONS_DIR, lectureName)
    : path.join(dataRoot, courseName, lectureName)
}

function handleGet(dataRoot: string, suffix: string, res: ServerResponse) {
  if (suffix === '/' || suffix === '') {
    res.end(JSON.stringify(readTree(dataRoot)))
  } else {
    res.end(JSON.stringify(readCourse(dataRoot, decodeURIComponent(suffix.slice(1)))))
  }
}

function handlePost(
  dataRoot: string,
  suffix: string,
  isRecitation: boolean,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const courseName = decodeURIComponent(suffix.slice(1))
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    try {
      const { name } = JSON.parse(body)
      let target: string
      if (courseName) {
        const parent = resolveCourseTarget(dataRoot, courseName, isRecitation)
        if (isRecitation) fs.mkdirSync(parent, { recursive: true })
        target = path.join(parent, name)
      } else {
        target = path.join(dataRoot, name)
      }
      fs.mkdirSync(target, { recursive: true })
      res.end(JSON.stringify({ ok: true }))
    } catch (e) {
      res.statusCode = 400
      res.end(JSON.stringify({ ok: false, error: String(e) }))
    }
  })
}

function handlePut(
  dataRoot: string,
  suffix: string,
  isRecitation: boolean,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const [courseName, lectureName] = suffix.slice(1).split('/').map(decodeURIComponent)
  const chunks: Buffer[] = []
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  req.on('end', () => {
    try {
      const lectureDir = resolveLectureTarget(dataRoot, courseName, lectureName, isRecitation)
      fs.writeFileSync(path.join(lectureDir, 'video.mp4'), Buffer.concat(chunks))
      for (const derived of ['audio.mp3', 'transcript.txt', 'summary.md', 'summary.pdf', 'drive_url.txt']) {
        const p = path.join(lectureDir, derived)
        if (fs.existsSync(p)) fs.unlinkSync(p)
      }
      res.end(JSON.stringify({ ok: true }))
    } catch (e) {
      res.statusCode = 400
      res.end(JSON.stringify({ ok: false, error: String(e) }))
    }
  })
}

function handleDelete(dataRoot: string, suffix: string, isRecitation: boolean, res: ServerResponse) {
  const [courseName, lectureName, fileName] = suffix.slice(1).split('/').map(decodeURIComponent)
  try {
    const lectureDir = resolveLectureTarget(dataRoot, courseName, lectureName, isRecitation)
    const filePath = path.join(lectureDir, fileName)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    res.end(JSON.stringify({ ok: true }))
  } catch (e) {
    res.statusCode = 400
    res.end(JSON.stringify({ ok: false, error: String(e) }))
  }
}

function handlePatch(
  dataRoot: string,
  suffix: string,
  isRecitation: boolean,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const [courseName, lectureName] = suffix.slice(1).split('/').map(decodeURIComponent)
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    try {
      const { name } = JSON.parse(body)
      if (lectureName) {
        const oldPath = resolveLectureTarget(dataRoot, courseName, lectureName, isRecitation)
        const newPath = resolveLectureTarget(dataRoot, courseName, name, isRecitation)
        fs.renameSync(oldPath, newPath)
      } else {
        fs.renameSync(path.join(dataRoot, courseName), path.join(dataRoot, name))
      }
      res.end(JSON.stringify({ ok: true }))
    } catch (e) {
      res.statusCode = 400
      res.end(JSON.stringify({ ok: false, error: String(e) }))
    }
  })
}

export function treeHandler(dataRoot: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json')
    const { suffix, isRecitation } = parseUrl(req.url ?? '/')
    if (req.method === 'GET')    return handleGet(dataRoot, suffix, res)
    if (req.method === 'POST')   return handlePost(dataRoot, suffix, isRecitation, req, res)
    if (req.method === 'PUT')    return handlePut(dataRoot, suffix, isRecitation, req, res)
    if (req.method === 'DELETE') return handleDelete(dataRoot, suffix, isRecitation, res)
    if (req.method === 'PATCH')  return handlePatch(dataRoot, suffix, isRecitation, req, res)
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
  }
}
