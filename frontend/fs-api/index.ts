import type { Plugin } from 'vite'
import { treeHandler } from './handlers/tree'
import { summaryHandler } from './handlers/summary'
import { filesHandler } from './handlers/files'
import { eventsHandler, notifyHandler } from './handlers/events'

export function fsPlugin(dataRoot: string): Plugin {
  return {
    name: 'vite-fs',
    configureServer(server) {
      server.middlewares.use('/api/summary', summaryHandler(dataRoot))
      server.middlewares.use('/api/files',   filesHandler(dataRoot))
      server.middlewares.use('/api/events',  eventsHandler())
      server.middlewares.use('/api/notify',  notifyHandler())
      server.middlewares.use('/api/tree',    treeHandler(dataRoot))
    },
  }
}
