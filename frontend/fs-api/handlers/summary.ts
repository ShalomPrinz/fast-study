/// <reference types="node" />
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

function handleGet(summaryPath: string, originalPath: string, res: ServerResponse) {
  try {
    const content = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf-8') : ''
    const hasOriginal = fs.existsSync(originalPath)
    res.end(JSON.stringify({ content, hasOriginal }))
  } catch (e) {
    res.statusCode = 500
    res.end(JSON.stringify({ ok: false, error: String(e) }))
  }
}

function handlePut(summaryPath: string, originalPath: string, req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = []
  req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  req.on('end', () => {
    try {
      const content = Buffer.concat(chunks).toString('utf-8')
      if (!fs.existsSync(originalPath) && fs.existsSync(summaryPath)) {
        fs.renameSync(summaryPath, originalPath)
      }
      fs.writeFileSync(summaryPath, content, 'utf-8')
      res.end(JSON.stringify({ ok: true }))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ ok: false, error: String(e) }))
    }
  })
}

function handleDelete(summaryPath: string, originalPath: string, res: ServerResponse) {
  try {
    if (fs.existsSync(originalPath)) {
      fs.copyFileSync(originalPath, summaryPath)
      fs.unlinkSync(originalPath)
    }
    res.end(JSON.stringify({ ok: true }))
  } catch (e) {
    res.statusCode = 500
    res.end(JSON.stringify({ ok: false, error: String(e) }))
  }
}

export function summaryHandler(dataRoot: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json')
    const [courseName, lectureName] = (req.url ?? '/').slice(1).split('/').map(decodeURIComponent)
    const lectureDir = path.join(dataRoot, courseName, lectureName)
    const summaryPath = path.join(lectureDir, 'summary.md')
    const originalPath = path.join(lectureDir, 'original_summary.md')

    if (req.method === 'GET')    return handleGet(summaryPath, originalPath, res)
    if (req.method === 'PUT')    return handlePut(summaryPath, originalPath, req, res)
    if (req.method === 'DELETE') return handleDelete(summaryPath, originalPath, res)
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
  }
}
