/// <reference types="node" />
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { RECITATIONS_DIR } from '../fs-reader'

export function filesHandler(dataRoot: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const [pathPart, queryPart = ''] = (req.url ?? '/').split('?')
    const params = new URLSearchParams(queryPart)
    const isRecitation = params.get('kind') === 'recitation'
    const [courseName, lectureName, fileName] = pathPart.slice(1).split('/').map(decodeURIComponent)
    const lectureDir = isRecitation
      ? path.join(dataRoot, courseName, RECITATIONS_DIR, lectureName)
      : path.join(dataRoot, courseName, lectureName)
    const filePath = path.join(lectureDir, fileName)
    if (!fs.existsSync(filePath)) {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    if (fileName.endsWith('.pdf')) res.setHeader('Content-Type', 'application/pdf')
    fs.createReadStream(filePath).pipe(res as unknown as NodeJS.WritableStream)
  }
}
