import { describe, it, expect } from 'vitest'
import { createLatestGate, createNewestGate } from './useLatestRequest'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createLatestGate', () => {
  it('resolves a lone call to its value', async () => {
    const gate = createLatestGate()
    await expect(gate(Promise.resolve(7))).resolves.toBe(7)
  })

  it('drops an older call that settles after the newer one', async () => {
    const gate = createLatestGate()
    const a = deferred<string>()
    const b = deferred<string>()
    const ra = gate(a.promise)
    const rb = gate(b.promise)
    b.resolve('b')
    await expect(rb).resolves.toBe('b')
    a.resolve('a')
    await expect(ra).resolves.toBeUndefined()
  })

  it('drops an older call even when it settles first', async () => {
    const gate = createLatestGate()
    const a = deferred<string>()
    const b = deferred<string>()
    const ra = gate(a.promise)
    const rb = gate(b.promise)
    a.resolve('a')
    await expect(ra).resolves.toBeUndefined()
    b.resolve('b')
    await expect(rb).resolves.toBe('b')
  })

  it('keeps separate gates independent', async () => {
    const one = createLatestGate()
    const two = createLatestGate()
    const a = deferred<string>()
    const ra = one(a.promise)
    const rb = two(Promise.resolve('b'))
    a.resolve('a')
    await expect(ra).resolves.toBe('a')
    await expect(rb).resolves.toBe('b')
  })

  it('resolves a superseded call that rejects to undefined', async () => {
    const gate = createLatestGate()
    const a = deferred<string>()
    const ra = gate(a.promise)
    const rb = gate(Promise.resolve('b'))
    await expect(rb).resolves.toBe('b')
    a.reject(new Error('stale failure'))
    await expect(ra).resolves.toBeUndefined()
  })

  it('still rejects the newest call when it fails', async () => {
    const gate = createLatestGate()
    const a = deferred<string>()
    const b = deferred<string>()
    const ra = gate(a.promise)
    const rb = gate(b.promise)
    b.reject(new Error('fresh failure'))
    await expect(rb).rejects.toThrow('fresh failure')
    a.resolve('a')
    await expect(ra).resolves.toBeUndefined()
  })
})

describe('createNewestGate', () => {
  it('keeps an older call that settles first, then the newer one', async () => {
    const gate = createNewestGate()
    const a = deferred<string>()
    const b = deferred<string>()
    const ra = gate(a.promise)
    const rb = gate(b.promise)
    a.resolve('a')
    await expect(ra).resolves.toBe('a')
    b.resolve('b')
    await expect(rb).resolves.toBe('b')
  })

  it('never starves: each overtaken call still lands while newer ones keep starting', async () => {
    const gate = createNewestGate()
    let prev = deferred<number>()
    let pending = gate(prev.promise)
    for (let i = 1; i <= 3; i++) {
      const next = deferred<number>()
      const rNext = gate(next.promise)
      prev.resolve(i)
      await expect(pending).resolves.toBe(i)
      prev = next
      pending = rNext
    }
  })

  it('drops an older call that settles after a newer one returned', async () => {
    const gate = createNewestGate()
    const a = deferred<string>()
    const ra = gate(a.promise)
    await expect(gate(Promise.resolve('b'))).resolves.toBe('b')
    a.resolve('a')
    await expect(ra).resolves.toBeUndefined()
  })

  it('rejects only the newest call, resolving an overtaken failure to undefined', async () => {
    const gate = createNewestGate()
    const a = deferred<string>()
    const b = deferred<string>()
    const ra = gate(a.promise)
    const rb = gate(b.promise)
    a.reject(new Error('stale failure'))
    await expect(ra).resolves.toBeUndefined()
    b.reject(new Error('fresh failure'))
    await expect(rb).rejects.toThrow('fresh failure')
  })
})
