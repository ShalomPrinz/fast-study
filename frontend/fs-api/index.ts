import type { Plugin } from 'vite'
import { treeHandler } from './handlers/tree'
import { summaryHandler } from './handlers/summary'
import { filesHandler } from './handlers/files'

export function fsPlugin(dataRoot: string): Plugin {
  return {
    name: 'vite-fs',
    configureServer(server) {
      server.middlewares.use('/api/summary', summaryHandler(dataRoot))
      server.middlewares.use('/api/files',   filesHandler(dataRoot))
      server.middlewares.use('/api/tree',    treeHandler(dataRoot))
    },
  }
}
