// Module-level singleton: one EventSource for all subscribers.
// Opens lazily on the first subscriber and closes when the last one unsubscribes.
import { databaseUrl } from './database'

type Callback = () => void

let es: EventSource | null = null
const subscribers = new Set<Callback>()

function dispatch() {
  for (const cb of subscribers) cb()
}

export function subscribeNotify(cb: Callback): () => void {
  subscribers.add(cb)

  // Open the EventSource lazily on the first subscriber
  if (!es) {
    es = new EventSource(`${databaseUrl}/events`)
    es.addEventListener('notify', dispatch)
  }

  // Unsubscribe function
  return () => {
    subscribers.delete(cb)

    // Close the EventSource if there are no more subscribers
    if (subscribers.size === 0 && es) {
      es.removeEventListener('notify', dispatch)
      es.close()
      es = null
    }
  }
}
