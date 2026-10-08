// The one Moodle lock: every outbound call to the configured site runs under it, one request at a
// time, and it frees COOLDOWN_MS after that request's work ends. See docs/GATE.md.
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { CodedError } from '../lib/errors.js';

// Sent by server/ on the calls it makes on its own (a section walk, a re-resolve, a file stream):
// those wait their turn. A browser cannot send it — CORS never allows the header.
export const WAIT_HEADER = 'X-FastStudy-Moodle-Wait';

/** A frontend request found the lock taken: refused before anything reached Moodle. */
export class MoodleBusyError extends CodedError {
  constructor() {
    super('moodle_busy', {}, 'another Moodle request is running; try again once it ends');
    this.name = 'MoodleBusyError';
  }
}

/** A Moodle call outside any gated request — a bug, aborted before anything was sent. */
export class UngatedMoodleCallError extends CodedError {
  constructor(target) {
    super('moodle_call_ungated', { target }, `Moodle call outside the gate: ${target}`);
    this.name = 'UngatedMoodleCallError';
  }
}

/** @returns {boolean} true for the gate's own refusals, which no caller may swallow. */
export function gateError(err) {
  return err instanceof MoodleBusyError || err instanceof UngatedMoodleCallError;
}

/**
 * The lock. A ticket is one request's claim, taken lazily at its first Moodle call; `holds` counts
 * its context plus every lease, and the lock enters its cooldown when the last one drops.
 */
export class MoodleGate extends EventEmitter {
  constructor({ cooldownMs = 3000 } = {}) {
    super();
    this.cooldownMs = cooldownMs;
    this._als = new AsyncLocalStorage();
    this._owner = null; // the ticket holding the lock
    this._cooling = false;
    this._waiting = []; // FIFO of { ticket, resolve, reject }
    this._lastBusy = false;
  }

  /** Locked: a request holds it, or its cooldown has not elapsed. */
  busy() {
    return this._owner !== null || this._cooling;
  }

  /**
   * Run `fn` as one request. `wait` queues it FIFO when the lock is taken instead of refusing;
   * `signal` drops a queued request whose caller went away. The lock, if taken, frees when `fn`
   * settles and every lease it took is released.
   */
  run({ wait = false, signal } = {}, fn) {
    const ticket = { wait, signal, acquired: false, holds: 1, closed: false };
    return this._als.run(ticket, async () => {
      try {
        return await fn();
      } finally {
        this._drop(ticket);
      }
    });
  }

  /** Called before anything goes to Moodle: proceed, wait (FIFO), or throw. */
  async enter(target = 'moodle') {
    const ticket = this._als.getStore();
    if (!ticket || ticket.closed) {
      console.error(`❌ Moodle call outside the gate, aborted: ${target}`);
      throw new UngatedMoodleCallError(target);
    }
    if (ticket.acquired) return;
    if (!this.busy()) return this._grant(ticket);
    if (!ticket.wait) throw new MoodleBusyError();
    ticket.signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
      const entry = { ticket, resolve, reject };
      this._waiting.push(entry);
      ticket.signal?.addEventListener(
        'abort',
        () => {
          const at = this._waiting.indexOf(entry);
          if (at < 0) return;
          this._waiting.splice(at, 1);
          reject(ticket.signal.reason);
        },
        { once: true },
      );
    });
  }

  /**
   * Keep the current request's lock past its own end (a login, a challenge window) until the lease
   * is released. `lease.run(fn)` runs `fn` as that same request, so its calls reuse the lock.
   */
  async hold(target = 'moodle hold') {
    await this.enter(target);
    const ticket = this._als.getStore();
    ticket.holds++;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this._drop(ticket);
      },
      run: (fn) => this._als.run(ticket, fn),
    };
  }

  _grant(ticket) {
    this._owner = ticket;
    ticket.acquired = true;
    this._publish();
  }

  _drop(ticket) {
    if (--ticket.holds > 0) return;
    ticket.closed = true;
    if (!ticket.acquired) return;
    ticket.acquired = false;
    this._owner = null;
    this._cooling = true;
    const free = () => {
      this._cooling = false;
      const next = this._waiting.shift();
      // Handed straight on, so `busy` never reads false between two queued requests.
      if (next) {
        this._grant(next.ticket);
        next.resolve();
      } else this._publish();
    };
    // A zero cooldown (tests) frees at once, so back-to-back requests never see a stale lock.
    if (this.cooldownMs > 0) setTimeout(free, this.cooldownMs);
    else free();
  }

  // 'change' fires only when busy() flips.
  _publish() {
    const busy = this.busy();
    if (busy === this._lastBusy) return;
    this._lastBusy = busy;
    this.emit('change', busy);
  }
}

/** The process's one gate. */
export const moodleGate = new MoodleGate();

/** Gate an outbound Moodle call: must be awaited before anything is sent to `target`. */
export function enterMoodle(target) {
  return moodleGate.enter(target);
}
