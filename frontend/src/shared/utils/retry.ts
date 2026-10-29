import { formatDuration } from './format'

/** Whole seconds until `at` (an ISO instant), never below zero; an unreadable stamp reads as due. */
export function secondsUntil(at: string, now: number): number {
  const target = Date.parse(at)
  return Number.isNaN(target) ? 0 : Math.max(0, Math.ceil((target - now) / 1000))
}

/** The countdown as m:ss. */
export function formatCountdown(seconds: number): string {
  return formatDuration(Math.max(0, seconds))
}
