import { i18n } from '@lingui/core'

// Colon-numeric elapsed time, e.g. "5:30" / "0:45" — locale-neutral, so it reads the same in any language.
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Binary file size, one decimal above a kilobyte, e.g. "1.2 GB". Like `formatDuration` the unit
// symbols are locale-neutral, so the string reads the same in any language.
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

// English ordinal; 11th–13th break the 1st/2nd/3rd rule and are special-cased.
function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

// Short monthly date, e.g. "10th July" / "10 ביולי".
export function formatMonthDate(iso: string): string {
  const d = new Date(iso)
  // Intl has no ordinal day option, so English is built by hand to keep "10th July" rather than "10 July".
  if (i18n.locale.startsWith('en'))
    return `${ordinal(d.getDate())} ${d.toLocaleString(i18n.locale, { month: 'long' })}`
  return new Intl.DateTimeFormat(i18n.locale, { day: 'numeric', month: 'long' }).format(d)
}

// Full readable timestamp, e.g. "Friday, 10 July 2026, 14:32".
export function formatFullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(i18n.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Clock time only, e.g. "14:32".
export function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(i18n.locale, { hour: '2-digit', minute: '2-digit' })
}
