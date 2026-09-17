import { describe, it, expect } from 'vitest'
import { createLatestGate } from './useLatestRequest'

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

  it('still propagates a superseded call that rejects', async () => {
    const gate = createLatestGate()
    const a = deferred<string>()
    const ra = gate(a.promise)
    const rb = gate(Promise.resolve('b'))
    await expect(rb).resolves.toBe('b')
    a.reject(new Error('stale failure'))
    await expect(ra).rejects.toThrow('stale failure')
  })
})
