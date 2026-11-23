// One EventSource for all subscribers: opened on the first, closed on the last.
// Every open (first connect and each reconnect) also dispatches, so notifies missed while down are resynced.
// Topic vocabulary and contract: database/docs/EVENTS.md.
import { databaseUrl } from './database'
import { withSecretParam } from './runtime'

export const TOPICS = ['runner', 'tree', 'settings', 'drive'] as const
export type Topic = (typeof TOPICS)[number]

type Callback = (matched: Topic[]) => void

interface Subscriber {
  cb: Callback
  topics?: readonly Topic[]
}

let es: EventSource | null = null
const subscribers = new Set<Subscriber>()

// The topics an event's `data` carries; null means everything (untagged, empty, unparsable, or any unknown topic).
export function parseTopics(data: unknown): Topic[] | null {
  if (typeof data !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  const topics = (parsed as { topics?: unknown } | null)?.topics
  if (!Array.isArray(topics) || topics.length === 0) return null
  if (!topics.every((t): t is Topic => TOPICS.includes(t))) return null
  return topics
}

// The subscriber's topics an event carried, or [] when it carries none of them (skip the callback).
export function matchTopics(
  subscribed: readonly Topic[] | undefined,
  carried: readonly Topic[] | null,
): Topic[] {
  const wanted = subscribed ?? TOPICS
  return carried === null ? [...wanted] : wanted.filter((t) => carried.includes(t))
}

function dispatch(e?: Event) {
  const carried = parseTopics((e as MessageEvent | undefined)?.data)
  for (const { cb, topics } of subscribers) {
    const matched = matchTopics(topics, carried)
    if (matched.length > 0) cb(matched)
  }
}

// An open carries no topics, so it refires everyone.
function dispatchAll() {
  dispatch()
}

export function subscribeNotify(cb: Callback, topics?: readonly Topic[]): () => void {
  const sub: Subscriber = { cb, topics }
  subscribers.add(sub)

  if (!es) {
    es = new EventSource(withSecretParam(`${databaseUrl}/events`))
    es.addEventListener('notify', dispatch)
    es.addEventListener('open', dispatchAll)
  }

  return () => {
    subscribers.delete(sub)
    if (subscribers.size === 0 && es) {
      es.removeEventListener('notify', dispatch)
      es.removeEventListener('open', dispatchAll)
      es.close()
      es = null
    }
  }
}
