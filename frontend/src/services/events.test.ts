import { describe, it, expect, vi, afterEach } from 'vitest'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, Set<(e: { data?: string }) => void>>()
  closed = false

  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: (e: { data?: string }) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }

  removeEventListener(type: string, fn: (e: { data?: string }) => void) {
    this.listeners.get(type)?.delete(fn)
  }

  close() {
    this.closed = true
  }

  fire(type: string, data?: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data })
  }
}

// The shared EventSource and subscriber set are module state, so every test imports a fresh copy.
async function importEvents(secret?: string) {
  vi.resetModules()
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  if (secret) vi.stubGlobal('window', { faststudy: { secret } })
  return import('./events')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('subscribeNotify', () => {
  it('shares one EventSource and fans a notify out to every subscriber', async () => {
    const { subscribeNotify } = await importEvents()
    const a = vi.fn()
    const b = vi.fn()
    subscribeNotify(a)
    subscribeNotify(b)

    expect(FakeEventSource.instances).toHaveLength(1)
    FakeEventSource.instances[0].fire('notify')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('makes every subscriber refetch on each open, so a reconnect resyncs missed notifies', async () => {
    const { subscribeNotify } = await importEvents()
    const a = vi.fn()
    const b = vi.fn()
    subscribeNotify(a)
    subscribeNotify(b)

    const es = FakeEventSource.instances[0]
    es.fire('open')
    es.fire('open')
    expect(a).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('stays open while any subscriber remains', async () => {
    const { subscribeNotify } = await importEvents()
    const offA = subscribeNotify(vi.fn())
    const b = vi.fn()
    subscribeNotify(b)

    offA()
    const es = FakeEventSource.instances[0]
    expect(es.closed).toBe(false)
    es.fire('notify')
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('closes and detaches on the last unsubscribe, and reopens on the next subscribe', async () => {
    const { subscribeNotify } = await importEvents()
    const off = subscribeNotify(vi.fn())
    const first = FakeEventSource.instances[0]

    off()
    expect(first.closed).toBe(true)
    expect(first.listeners.get('notify')?.size ?? 0).toBe(0)
    expect(first.listeners.get('open')?.size ?? 0).toBe(0)

    subscribeNotify(vi.fn())
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(FakeEventSource.instances[1]).not.toBe(first)
  })

  it('opens the database /events stream, with the secret as a query parameter', async () => {
    const { subscribeNotify } = await importEvents('s3cret')
    subscribeNotify(vi.fn())
    const { url } = FakeEventSource.instances[0]
    expect(url.split('?')[0]).toMatch(/\/events$/)
    expect(url).toContain('?secret=s3cret')
  })
})

const tagged = (...topics: string[]) => JSON.stringify({ topics })

describe('topic filtering', () => {
  it('calls a topic subscriber only with the topics the event carried', async () => {
    const { subscribeNotify } = await importEvents()
    const runner = vi.fn()
    const both = vi.fn()
    subscribeNotify(runner, ['runner'])
    subscribeNotify(both, ['runner', 'tree'])

    FakeEventSource.instances[0].fire('notify', tagged('tree'))
    expect(runner).not.toHaveBeenCalled()
    expect(both).toHaveBeenLastCalledWith(['tree'])

    FakeEventSource.instances[0].fire('notify', tagged('tree', 'runner', 'drive'))
    expect(runner).toHaveBeenLastCalledWith(['runner'])
    expect(both).toHaveBeenLastCalledWith(['runner', 'tree'])
  })

  it('gives a subscriber without topics every event', async () => {
    const { subscribeNotify } = await importEvents()
    const all = vi.fn()
    subscribeNotify(all)
    FakeEventSource.instances[0].fire('notify', tagged('drive'))
    expect(all).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['untagged', '{}'],
    ['no data', undefined],
    ['empty topics', '{"topics":[]}'],
    ['an unknown topic beside a known one', tagged('tree', 'nope')],
    ['unparsable data', 'not json'],
  ])('fires every subscriber with all its topics on %s', async (_name, data) => {
    const { subscribeNotify } = await importEvents()
    const a = vi.fn()
    subscribeNotify(a, ['settings', 'drive'])
    FakeEventSource.instances[0].fire('notify', data)
    expect(a).toHaveBeenCalledWith(['settings', 'drive'])
  })

  it('fires every subscriber with all its topics on each open', async () => {
    const { subscribeNotify } = await importEvents()
    const a = vi.fn()
    subscribeNotify(a, ['drive'])
    FakeEventSource.instances[0].fire('open')
    expect(a).toHaveBeenCalledWith(['drive'])
  })
})

describe('matchTopics', () => {
  it('intersects a tagged event with the subscription, and passes an untagged one whole', async () => {
    const { matchTopics } = await importEvents()
    expect(matchTopics(['runner', 'tree'], ['tree'])).toEqual(['tree'])
    expect(matchTopics(['runner'], ['drive'])).toEqual([])
    expect(matchTopics(['runner'], null)).toEqual(['runner'])
    expect(matchTopics(undefined, ['drive'])).toEqual(['drive'])
    expect(matchTopics(undefined, null)).toEqual(['runner', 'tree', 'settings', 'drive'])
  })
})
