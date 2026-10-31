import {
  AUTO_RETRY_COUNT_RANGE,
  AUTO_RETRY_DEFAULTS,
  AUTO_RETRY_MINUTES_RANGE,
  type Settings,
} from '@/services/settings'

export interface AutoRetryForm {
  on: boolean
  count: number
  minutes: number
}

/** The form's auto retry as the store has it; anything unset reads as the default. */
export function autoRetryFromStore(stored: Settings): AutoRetryForm {
  return {
    on: stored.autoRetry ?? AUTO_RETRY_DEFAULTS.on,
    count: stored.autoRetryCount ?? AUTO_RETRY_DEFAULTS.count,
    minutes: stored.autoRetryMinutes ?? AUTO_RETRY_DEFAULTS.minutes,
  }
}

/** Only the fields that differ from the store, as whole numbers and a real bool. */
export function autoRetryPatch(
  form: AutoRetryForm,
  stored: Settings,
): { autoRetry?: boolean; autoRetryCount?: number; autoRetryMinutes?: number } {
  const was = autoRetryFromStore(stored)
  const patch: ReturnType<typeof autoRetryPatch> = {}
  if (form.on !== was.on) patch.autoRetry = form.on
  if (form.count !== was.count) patch.autoRetryCount = form.count
  if (form.minutes !== was.minutes) patch.autoRetryMinutes = form.minutes
  return patch
}

/** The typed text as a whole number clamped into the range, or null while it is empty or not an integer. */
export function parseRetryInt(text: string, range: { min: number; max: number }): number | null {
  if (!/^\d+$/.test(text.trim())) return null
  return Math.min(range.max, Math.max(range.min, Number(text)))
}

export const COUNT_RANGE = AUTO_RETRY_COUNT_RANGE
export const MINUTES_RANGE = AUTO_RETRY_MINUTES_RANGE
