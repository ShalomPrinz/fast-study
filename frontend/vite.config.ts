/// <reference types="node" />
import { defineConfig, loadEnv, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

const PREDEFINED_FILES = ['video.mp4', 'audio.mp3', 'transcript.txt', 'summary.md', 'summary.pdf']

function fsPlugin(dataRoot: string): Plugin {
  function readTree() {
    if (!dataRoot || !fs.existsSync(dataRoot)) return []
    return fs
      .readdirSync(dataRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((course) => {
        const lectures = fs
          .readdirSync(path.join(dataRoot, course.name), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((l) => {
            const lectureDir = path.join(dataRoot, course.name, l.name)
            const files = Object.fromEntries(
              PREDEFINED_FILES.map((f) => [f, fs.existsSync(path.join(lectureDir, f))])
            )
            return { name: l.name, files }
          })
        return { name: course.name, lectures }
      })
  }

  return {
    name: 'vite-fs',
    configureServer(server) {
      server.middlewares.use('/api/tree', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(readTree()))
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
