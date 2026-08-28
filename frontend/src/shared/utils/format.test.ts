import { i18n } from '@lingui/core'
import { describe, it, expect } from 'vitest'
import {
  formatBytes,
  formatClockTime,
  formatDuration,
  formatFullTimestamp,
  formatMonthDate,
} from '@/shared/utils/format'

// The helpers read only i18n.locale, so an empty catalog is enough to switch them over.
const activate = (locale: string) => i18n.loadAndActivate({ locale, messages: {} })

const iso = '2026-07-10T14:32:00'

describe('formatDuration', () => {
  it('pads seconds under a minute', () => {
    expect(formatDuration(45)).toBe('0:45')
    expect(formatDuration(5)).toBe('0:05')
  })

  it('splits minutes and seconds above a minute', () => {
    expect(formatDuration(330)).toBe('5:30')
    expect(formatDuration(3600)).toBe('60:00')
  })
})

describe('formatBytes', () => {
  it('keeps raw bytes whole and rounds larger units to one decimal', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.2 GB')
  })
})

describe('formatMonthDate', () => {
  it('keeps the English ordinal in en', () => {
    activate('en')
    expect(formatMonthDate(iso)).toBe('10th July')
  })

  it('renders the Hebrew month name in he', () => {
    activate('he')
    const out = formatMonthDate(iso)
    expect(out).toContain('10')
    expect(out).toContain('יולי')
    expect(out).not.toContain('July')
  })
})

describe('formatFullTimestamp', () => {
  it('uses English names in en', () => {
    activate('en')
    const out = formatFullTimestamp(iso)
    expect(out).toContain('Friday')
    expect(out).toContain('July')
    expect(out).toContain('2026')
  })

  it('uses Hebrew names in he', () => {
    activate('he')
    const out = formatFullTimestamp(iso)
    expect(out).toContain('יולי')
    expect(out).toContain('2026')
    expect(out).not.toContain('Friday')
  })
})

describe('formatClockTime', () => {
  it('renders hour and minute in both locales', () => {
    activate('en')
    expect(formatClockTime(iso)).toContain('32')
    activate('he')
    expect(formatClockTime(iso)).toBe('14:32')
  })
})
