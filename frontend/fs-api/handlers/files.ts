/// <reference types="node" />
import type { IncomingMessage, ServerResponse } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

export function filesHandler(dataRoot: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const suffix = (req.url ?? '/').split('?')[0]
    const [courseName, lectureName, fileName] = suffix.slice(1).split('/').map(decodeURIComponent)
    const filePath = path.join(dataRoot, courseName, lectureName, fileName)
    if (!fs.existsSync(filePath)) {
      res.statusCode = 404
      res.end('Not found')
      return
    }
    if (fileName.endsWith('.pdf')) res.setHeader('Content-Type', 'application/pdf')
    fs.createReadStream(filePath).pipe(res as unknown as NodeJS.WritableStream)
  }
}
