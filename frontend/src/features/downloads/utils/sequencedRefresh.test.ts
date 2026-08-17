import { describe, it, expect } from 'vitest'
import { sequencedRefresh } from './sequencedRefresh'

// Hand-resolved fetches, so a test can answer them in any order.
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('sequencedRefresh', () => {
  it('drops a reply that lands after a newer one', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const pending = [first, second]
    const published: string[] = []
    const refresh = sequencedRefresh(
      () => pending.shift()!.promise,
      (snap: string) => published.push(snap),
    )

    refresh()
    refresh()
    second.resolve('done')
    await second.promise
    first.resolve('running')
    await first.promise.catch(() => {})
    await Promise.resolve()

    expect(published).toEqual(['done'])
  })

  it('publishes in order when replies do not overlap', async () => {
    const snapshots = ['a', 'b']
    const published: string[] = []
    const refresh = sequencedRefresh(
      () => Promise.resolve(snapshots.shift()!),
      (snap: string) => published.push(snap),
    )

    refresh()
    await Promise.resolve()
    refresh()
    await Promise.resolve()
    await Promise.resolve()

    expect(published).toEqual(['a', 'b'])
  })

  it('swallows a failed fetch and keeps accepting later replies', async () => {
    const published: string[] = []
    let fail = true
    const refresh = sequencedRefresh(
      () => (fail ? Promise.reject(new Error('offline')) : Promise.resolve('ok')),
      (snap: string) => published.push(snap),
    )

    refresh()
    await Promise.resolve()
    fail = false
    refresh()
    await Promise.resolve()
    await Promise.resolve()

    expect(published).toEqual(['ok'])
  })
})
