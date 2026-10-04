import { describe, it, expect } from 'vitest'
import type { SectionRun } from '../services/downloadServer'
import { coursesWithActiveRuns } from './SectionRunsContext'

function run(course: string, status: SectionRun['status']): SectionRun {
  return {
    id: `${course}-${status}`,
    sectionId: `${course}:video:Week 1`,
    course,
    targets: [],
    at: 1,
    total: 3,
    status,
    paused: null,
  }
}

describe('coursesWithActiveRuns', () => {
  it('names every course a running or passcode-parked run is still walking', () => {
    const active = coursesWithActiveRuns([
      run('Algo', 'running'),
      run('Logic', 'paused'),
      run('Done', 'done'),
      run('Expired', 'reconnect'),
      run('Cancelled', 'cancelled'),
    ])
    expect([...active].sort()).toEqual(['Algo', 'Logic'])
  })
})
