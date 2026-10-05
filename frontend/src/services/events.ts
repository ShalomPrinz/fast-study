// One EventSource for all subscribers: opened on the first, closed on the last.
// Every open (first connect and each reconnect) also dispatches, so notifies missed while down are resynced.
import { databaseUrl } from './database'
import { withSecretParam } from './runtime'

type Callback = () => void

let es: EventSource | null = null
const subscribers = new Set<Callback>()

function dispatch() {
  for (const cb of subscribers) cb()
}

export function subscribeNotify(cb: Callback): () => void {
  subscribers.add(cb)

  if (!es) {
    es = new EventSource(withSecretParam(`${databaseUrl}/events`))
    es.addEventListener('notify', dispatch)
    es.addEventListener('open', dispatch)
  }

  return () => {
    subscribers.delete(cb)
    if (subscribers.size === 0 && es) {
      es.removeEventListener('notify', dispatch)
      es.removeEventListener('open', dispatch)
      es.close()
      es = null
    }
  }
}
