/// <reference types="node" />
import type { IncomingMessage, ServerResponse } from 'node:http'

const subscribers = new Set<ServerResponse>()

function handleEvents(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write(': connected\n\n')
  subscribers.add(res)
  const cleanup = () => { subscribers.delete(res) }
  res.on('close', cleanup)
  res.on('error', cleanup)
}

function handleNotify(req: IncomingMessage, res: ServerResponse) {
  req.on('data', () => {})
  req.on('end', () => {
    for (const sub of subscribers) {
      try { sub.write('event: notify\ndata: {}\n\n') } catch {}
    }
    res.statusCode = 204
    res.end()
  })
}

export function eventsHandler() {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET') return handleEvents(req, res)
    res.statusCode = 405
    res.end()
  }
}

export function notifyHandler() {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST') return handleNotify(req, res)
    res.statusCode = 405
    res.end()
  }
}
