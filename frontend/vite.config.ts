/// <reference types="node" />
import { defineConfig, loadEnv, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

const VIRTUAL_ID = 'virtual:tree'
const RESOLVED_ID = '\0' + VIRTUAL_ID

function fsPlugin(dataRoot: string): Plugin {
  function readTree() {
    if (!dataRoot) return []
    return fs
      .readdirSync(dataRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((course) => {
        const lectures = fs
          .readdirSync(path.join(dataRoot, course.name), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((l) => l.name)
        return { name: course.name, lectures }
      })
  }

  return {
    name: 'vite-fs',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },
    load(id) {
      if (id === RESOLVED_ID) {
        return `export const tree = ${JSON.stringify(readTree())}`
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), fsPlugin(env.VITE_DATA_ROOT)],
  }
})
