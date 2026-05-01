/// <reference types="node" />
import { defineConfig, loadEnv, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

const PREDEFINED_FILES = ['video.mp4', 'audio.mp3', 'transcript.txt', 'summary.md', 'summary.pdf']

function fsPlugin(dataRoot: string): Plugin {
  function readLectures(courseDir: string) {
    return fs
      .readdirSync(courseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((l) => {
        const lectureDir = path.join(courseDir, l.name)
        const files = Object.fromEntries(
          PREDEFINED_FILES.map((f) => [f, fs.existsSync(path.join(lectureDir, f))])
        )
        return { name: l.name, files }
      })
  }

  function readTree() {
    if (!dataRoot || !fs.existsSync(dataRoot)) return []
    return fs
      .readdirSync(dataRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((course) => ({
        name: course.name,
        lectures: readLectures(path.join(dataRoot, course.name)),
      }))
  }

  function readCourse(name: string) {
    const courseDir = path.join(dataRoot, name)
    if (!fs.existsSync(courseDir)) return null
    return { name, lectures: readLectures(courseDir) }
  }

  return {
    name: 'vite-fs',
    configureServer(server) {
      server.middlewares.use('/api/tree', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        const suffix = req.url ?? '/'

        if (req.method === 'POST') {
          const courseName = decodeURIComponent(suffix.slice(1))
          let body = ''
          req.on('data', (chunk) => { body += chunk })
          req.on('end', () => {
            try {
              const { name } = JSON.parse(body)
              fs.mkdirSync(path.join(dataRoot, courseName, name), { recursive: true })
              res.end(JSON.stringify({ ok: true }))
            } catch (e) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: String(e) }))
            }
          })
          return
        }

        if (req.method === 'PUT') {
          const [courseName, lectureName] = suffix.slice(1).split('/').map(decodeURIComponent)
          const chunks: Buffer[] = []
          req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
          req.on('end', () => {
            try {
              const lectureDir = path.join(dataRoot, courseName, lectureName)
              fs.writeFileSync(path.join(lectureDir, 'video.mp4'), Buffer.concat(chunks))
              for (const derived of ['audio.mp3', 'transcript.txt', 'summary.md', 'summary.pdf']) {
                const p = path.join(lectureDir, derived)
                if (fs.existsSync(p)) fs.unlinkSync(p)
              }
              res.end(JSON.stringify({ ok: true }))
            } catch (e) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: String(e) }))
            }
          })
          return
        }

        if (req.method === 'PATCH') {
          const [courseName, lectureName] = suffix.slice(1).split('/').map(decodeURIComponent)
          let body = ''
          req.on('data', (chunk) => { body += chunk })
          req.on('end', () => {
            try {
              const { name } = JSON.parse(body)
              fs.renameSync(
                path.join(dataRoot, courseName, lectureName),
                path.join(dataRoot, courseName, name),
              )
              res.end(JSON.stringify({ ok: true }))
            } catch (e) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: String(e) }))
            }
          })
          return
        }

        if (suffix === '/' || suffix === '') {
          res.end(JSON.stringify(readTree()))
        } else {
          const courseName = decodeURIComponent(suffix.slice(1))
          res.end(JSON.stringify(readCourse(courseName)))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), fsPlugin(env.VITE_DATA_ROOT)],
  }
})
