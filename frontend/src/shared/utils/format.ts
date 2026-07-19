export function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// English ordinal; 11th–13th break the 1st/2nd/3rd rule and are special-cased.
function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

// Short monthly date, e.g. "10th July".
export function formatMonthDate(iso: string): string {
  const d = new Date(iso)
  return `${ordinal(d.getDate())} ${d.toLocaleString('en-GB', { month: 'long' })}`
}

// Full readable timestamp, e.g. "Friday, 10 July 2026, 14:32".
export function formatFullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
