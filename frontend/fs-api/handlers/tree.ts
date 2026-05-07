/// <reference types="node" />
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { readTree, readCourse } from '../fs-reader'

function handleGet(dataRoot: string, suffix: string, res: ServerResponse) {
  if (suffix === '/' || suffix === '') {
    res.end(JSON.stringify(readTree(dataRoot)))
  } else {
    res.end(JSON.stringify(readCourse(dataRoot, decodeURIComponent(suffix.slice(1)))))
  }
}

function handlePost(dataRoot: string, suffix: string, req: IncomingMessage, res: ServerResponse) {
  const courseName = decodeURIComponent(suffix.slice(1))
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    try {
      const { name } = JSON.parse(body)
      const target = courseName
        ? path.join(dataRoot, courseName, name)
        : path.join(dataRoot, name)
      fs.mkdirSync(target, { recursive: true })
      res.end(JSON.stringify({ ok: true }))
    } catch (e) {
      res.statusCode = 400
      res.end(JSON.stringify({ ok: false, error: String(e) }))
    }
  })
}

function handlePut(dataRoot: string, suffix: string, req: IncomingMessage, res: ServerResponse) {
  const [courseName, lectureName] = suffix.slice(1).split('/').map(decodeURIComponent)
  const chunks: Buffer[] = []
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  req.on('end', () => {
    try {
      const lectureDir = path.join(dataRoot, courseName, lectureName)
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

function handleDelete(dataRoot: string, suffix: string, res: ServerResponse) {
  const [courseName, lectureName, fileName] = suffix.slice(1).split('/').map(decodeURIComponent)
  try {
    const filePath = path.join(dataRoot, courseName, lectureName, fileName)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    res.end(JSON.stringify({ ok: true }))
  } catch (e) {
    res.statusCode = 400
    res.end(JSON.stringify({ ok: false, error: String(e) }))
  }
}

function handlePatch(dataRoot: string, suffix: string, req: IncomingMessage, res: ServerResponse) {
  const [courseName, lectureName] = suffix.slice(1).split('/').map(decodeURIComponent)
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    try {
      const { name } = JSON.parse(body)
      if (lectureName) {
        fs.renameSync(
          path.join(dataRoot, courseName, lectureName),
          path.join(dataRoot, courseName, name),
        )
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
    const suffix = req.url ?? '/'
    if (req.method === 'GET')    return handleGet(dataRoot, suffix, res)
    if (req.method === 'POST')   return handlePost(dataRoot, suffix, req, res)
    if (req.method === 'PUT')    return handlePut(dataRoot, suffix, req, res)
    if (req.method === 'DELETE') return handleDelete(dataRoot, suffix, res)
    if (req.method === 'PATCH')  return handlePatch(dataRoot, suffix, req, res)
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
  }
}
