// Tests reach Moodle-calling code without a route around it: run each call as one gated request
// that waits its turn, on a gate with no cooldown so back-to-back calls never see a stale lock.
import { moodleGate } from '../src/moodle/gate.js';

moodleGate.cooldownMs = 0;

export const gated = (fn) => moodleGate.run({ wait: true }, fn);
