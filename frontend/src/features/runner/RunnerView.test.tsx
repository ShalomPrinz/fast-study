// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { RunnerStatus } from '@/types'
import RunnerView from './RunnerView'

const { status } = vi.hoisted(() => ({ status: { current: null as unknown } }))
vi.mock('@/shared/contexts/RunnerStatusContext', () => ({
  useRunnerStatus: () => ({ status: status.current, trigger: vi.fn() }),
}))
vi.mock('@/shared/contexts/CourseTreeContext', () => ({
  useCourseTreeContext: () => ({ courses: [] }),
}))
vi.mock('@/shared/contexts/SettingsContext', () => ({
  useAutoRun: () => 'off',
  useDriveEnabled: () => false,
}))
vi.mock('@/shared/contexts/SupportedMaterialsContext', () => ({
  useSupportedMaterials: () => ({}),
}))
vi.mock('@/services/backend', () => ({ moveToFront: vi.fn(), runPipeline: vi.fn() }))

describe('RunnerView', () => {
  it('lists an assignment run as a link to its page, with no action to run or move it', () => {
    status.current = {
      runner: { running: false, total: 0, done: 0, lastError: null },
      inFlight: [
        { course: 'C', lecture: 'A 1', kind: 'assignment', step: 'solution_pdf', startedAt: '' },
      ],
      queue: [],
      overviewRunning: [],
      notices: [],
      errors: {},
    } satisfies RunnerStatus
    const { container } = render(
      <MemoryRouter>
        <RunnerView />
      </MemoryRouter>,
    )
    const row = container.querySelector('.runner-row')
    expect(row?.getAttribute('href')).toBe('/course/C/assignment/A%201')
    expect(row?.textContent).toContain('Assignment · A 1')
    expect(row?.textContent).toContain('PDF')
    expect(container.querySelector('.runner-row-main, .runner-row--split')).toBeNull()
    expect(container.querySelector('.focus-card')).toBeNull()
  })
})
