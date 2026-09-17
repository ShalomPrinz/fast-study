import { describe, it, expect, vi, afterEach } from 'vitest'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  listeners = new Map<string, Set<() => void>>()
  closed = false

  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }

  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn)
  }

  close() {
    this.closed = true
  }

  fire(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn()
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
