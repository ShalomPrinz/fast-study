import { describe, it, expect } from 'vitest'
import { MoodleBusyError } from '@/services/http'
import { createMoodleLock, MoodleLockAbandoned, moodleLocked, rowLocked } from './moodleLock'

const flush = () => new Promise((r) => setTimeout(r, 0))

function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('moodleLocked', () => {
  it('locks every button while the service says busy', () => {
    expect(moodleLocked({ busy: true, claimed: false })).toBe(true)
    expect(moodleLocked({ busy: false, claimed: false })).toBe(false)
  })

  it('leaves an exempt button enabled under a pushed lock, but not under its own call', () => {
    expect(moodleLocked({ busy: true, claimed: false }, true)).toBe(false)
    expect(moodleLocked({ busy: true, claimed: true }, true)).toBe(true)
  })
})

describe('rowLocked', () => {
  const busy = { busy: true, claimed: false }

  it('locks a row auto flagged as reaching Moodle while the lock is busy', () => {
    expect(rowLocked(true, busy)).toBe(true)
    expect(rowLocked(true, { busy: false, claimed: false })).toBe(false)
  })

  it('never locks a row that does not reach Moodle (Zoom, YouTube, Drive)', () => {
    expect(rowLocked(false, busy)).toBe(false)
    expect(rowLocked(false, { busy: true, claimed: true })).toBe(false)
  })
})

describe('createMoodleLock', () => {
  it('locks at once on a call, before any push lands, and frees when it settles', async () => {
    const lock = createMoodleLock()
    const call = deferred()
    const running = lock.run(() => call.promise)

    expect(lock.getState()).toEqual({ busy: true, claimed: true })
    call.resolve()
    await running
    expect(lock.getState()).toEqual({ busy: false, claimed: false })
  })

  it('stays busy after the call while the service still holds the lock', async () => {
    const lock = createMoodleLock()
    await lock.run(async () => lock.frame(true))

    expect(lock.getState()).toEqual({ busy: true, claimed: false })
    lock.frame(false)
    expect(lock.getState().busy).toBe(false)
  })

  it('rethrows a button call refused busy, for its caller to swallow', async () => {
    const lock = createMoodleLock()
    const err = await lock
      .run(() => Promise.reject(new MoodleBusyError('taken')))
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MoodleBusyError)
    expect(lock.getState().claimed).toBe(false)
  })

  it('holds a waiting call until the lock frees, then runs it', async () => {
    const lock = createMoodleLock()
    lock.frame(true)
    let ran = false
    const waiting = lock.run(
      async () => {
        ran = true
        return 'ok'
      },
      { wait: true },
    )

    await flush()
    expect(ran).toBe(false)
    lock.frame(false)
    expect(await waiting).toBe('ok')
  })

  it('lets only one of two waiting calls through when the lock frees', async () => {
    const lock = createMoodleLock()
    lock.frame(true)
    const first = deferred()
    let started = 0
    const a = lock.run(
      () => {
        started += 1
        return first.promise
      },
      { wait: true },
    )
    const b = lock.run(
      async () => {
        started += 1
      },
      { wait: true },
    )

    lock.frame(false)
    await flush()
    expect(started).toBe(1)
    first.resolve()
    await Promise.all([a, b])
    expect(started).toBe(2)
  })

  it('asks a waiting call again after a 429 whose busy frame had not landed yet', async () => {
    const lock = createMoodleLock()
    let calls = 0
    const waiting = lock.run(
      async () => {
        calls += 1
        if (calls === 1) throw new MoodleBusyError('taken')
        return 'ok'
      },
      { wait: true },
    )

    await flush()
    expect(calls).toBe(1)
    // The late frame, then the cooldown's end.
    lock.frame(true)
    await flush()
    expect(calls).toBe(1)
    lock.frame(false)
    expect(await waiting).toBe('ok')
    expect(calls).toBe(2)
  })

  it('asks again on a repeated free frame, as a reconnected stream sends after the lock freed', async () => {
    const lock = createMoodleLock()
    let calls = 0
    const waiting = lock.run(
      async () => {
        calls += 1
        if (calls === 1) throw new MoodleBusyError('taken')
        return 'ok'
      },
      { wait: true },
    )

    await flush()
    expect(calls).toBe(1)
    lock.frame(false)
    expect(await waiting).toBe('ok')
  })

  it('drops a waiting call that went stale before it was sent', async () => {
    const lock = createMoodleLock()
    lock.frame(true)
    let stale = false
    let ran = false
    const waiting = lock
      .run(
        async () => {
          ran = true
        },
        { wait: true, stale: () => stale },
      )
      .catch((e: unknown) => e)

    stale = true
    lock.frame(false)
    expect(await waiting).toBeInstanceOf(MoodleLockAbandoned)
    expect(ran).toBe(false)
    expect(lock.getState()).toEqual({ busy: false, claimed: false })
  })

  it('rethrows any other failure of a waiting call', async () => {
    const lock = createMoodleLock()
    const err = await lock
      .run(() => Promise.reject(new Error('boom')), { wait: true })
      .catch((e: unknown) => e)

    expect((err as Error).message).toBe('boom')
  })
})
