import { isMoodleBusyError } from '@/services/http'

// What the page knows about the Moodle lock: the service's pushed `moodleBusy`, and how many calls this
// tab has in flight through `run` — counted at once, so a double click can't send two before the push lands.
export interface MoodleLockState {
  busy: boolean
  claimed: boolean
}

// `stale` is checked before a waiting call goes out: true abandons it with a MoodleLockAbandoned.
export type WithMoodleLock = <T>(
  fn: () => Promise<T>,
  opts?: { wait?: boolean; stale?: () => boolean },
) => Promise<T>

// A waiting call its caller no longer wanted, dropped before it spent a lock turn.
export class MoodleLockAbandoned extends Error {
  constructor() {
    super('Moodle call abandoned before it was sent.')
    this.name = 'MoodleLockAbandoned'
  }
}

// The one lock decision for a Moodle button. `exempt` is a button the lock's holder needs — Complete and
// Connect while a challenge window holds it — which only this tab's own call in flight disables.
export function moodleLocked(lock: MoodleLockState, exempt = false): boolean {
  return lock.claimed || (lock.busy && !exempt)
}

// A discovery row's buttons: only a row auto flagged as reaching Moodle waits out the lock.
export function rowLocked(moodle: boolean, lock: MoodleLockState): boolean {
  return moodle && moodleLocked(lock)
}

// The lock as a small store, one per `AuthStatusProvider`. `run` is the one way any Moodle-reaching call
// leaves the page; see docs/DOWNLOADS.md §The Moodle lock.
export function createMoodleLock() {
  let pushed = false
  let claims = 0
  // Bumped on every pushed flip and on every frame, so a 429 can tell whether its busy frame has landed yet.
  let flips = 0
  let frames = 0
  let state: MoodleLockState = { busy: false, claimed: false }
  const listeners = new Set<() => void>()
  let waiters: (() => void)[] = []

  function emit() {
    const busy = pushed || claims > 0
    const claimed = claims > 0
    // A repeated frame keeps the state's identity, so no subscriber re-renders for it.
    if (busy !== state.busy || claimed !== state.claimed) {
      state = { busy, claimed }
      listeners.forEach((l) => l())
    }
    const woken = waiters
    waiters = []
    woken.forEach((w) => w())
  }

  const changed = () => new Promise<void>((resolve) => waiters.push(resolve))

  function claim(delta: number) {
    claims += delta
    emit()
  }

  // A button call (the default) runs at once: its button is disabled while locked, and a 429 it races into
  // rethrows for the caller to swallow. `wait` is a call nobody pressed: it waits for the lock to free and
  // asks again after a 429, rather than failing.
  const run: WithMoodleLock = async (fn, { wait = false, stale } = {}) => {
    for (;;) {
      while (wait && state.busy) await changed()
      if (stale?.()) throw new MoodleLockAbandoned()
      const start = flips
      claim(1)
      try {
        return await fn()
      } catch (err) {
        if (!wait || !isMoodleBusyError(err)) throw err
      } finally {
        claim(-1)
      }
      // Refused, yet no busy frame has arrived since the call left: it is still on its way. Any next
      // frame wakes it — a stream that reconnects after the lock freed repeats `false`, never flips.
      const seen = frames
      while (flips === start && frames === seen && !pushed) await changed()
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    // Called on every `/auth/events` frame, a repeat of the current value included.
    frame(busy: boolean) {
      frames += 1
      if (busy !== pushed) flips += 1
      pushed = busy
      emit()
    },
    run,
  }
}

export type MoodleLock = ReturnType<typeof createMoodleLock>
