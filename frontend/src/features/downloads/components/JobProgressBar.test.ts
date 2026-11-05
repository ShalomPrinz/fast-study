// @vitest-environment jsdom
import { createElement } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { stallLatched } from '@/features/downloads/utils/stallNote'
import { JobProgressBar } from './RecordingJobList'

vi.mock('@/shared/hooks/useTimingStats', () => ({ useTimingStats: () => ({ message: 'x' }) }))
vi.mock('@/shared/contexts/SettingsContext', () => ({
  useSettingsContext: () => ({ settings: null }),
}))

i18n.load('en', {})
i18n.activate('en')
afterEach(cleanup)

const JOB = {
  id: 'latched-1',
  title: 'T',
  status: 'running' as const,
  startedAt: 1,
  expectedBytes: null,
  operation: 'download' as never,
  stalled: true,
  source: 'other' as const,
}

function bar(stallNote?: boolean) {
  return render(
    createElement(
      I18nProvider,
      { i18n },
      createElement(JobProgressBar, { job: JOB, showTitle: false, stallNote }),
    ),
  )
}

describe('JobProgressBar stall note', () => {
  it('shows for a latched id and hides when stallNote is false', () => {
    stallLatched(JOB)
    expect(bar().container.querySelector('.recording-stall-note')).not.toBeNull()
    cleanup()
    expect(bar(false).container.querySelector('.recording-stall-note')).toBeNull()
  })
})
