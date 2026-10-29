// @vitest-environment jsdom
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SectionRun } from '../services/downloadServer'
import { playlistRunId } from '../utils/sections'
import { coursesWithActiveRuns, engagedRefs, nestedRuns } from './SectionRunsContext'

const noop = () => {}

function run(course: string, status: SectionRun['status']): SectionRun {
  return {
    id: `${course}-${status}`,
    sectionId: `${course}:video:Week 1`,
    scope: 'section',
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

describe('nestedRuns', () => {
  it('files each playlist run under its section and leaves section runs out', () => {
    const section = run('Algo', 'done')
    const playlist = {
      ...run('Algo', 'running'),
      sectionId: playlistRunId(section.sectionId, 'pl1'),
    }
    const nested = nestedRuns([section, playlist])
    expect([...nested.keys()]).toEqual([section.sectionId])
    expect(nested.get(section.sectionId)).toEqual([playlist])
  })
})

describe('passcode dismissal', () => {
  it('forgets a dismissal once its run leaves the gate', async () => {
    vi.resetModules()
    let snapshot: SectionRun[] = [run('Logic', 'paused')]
    let ping = () => {}
    vi.doMock('../services/downloadServer', () => ({
      fetchRuns: () => Promise.resolve(snapshot),
      subscribeRuns: (onChange: () => void) => {
        ping = onChange
        onChange()
        return () => {}
      },
    }))
    vi.doMock('./DownloadsSessionContext', () => ({
      useDownloadsActions: () => ({ reconnectHint: noop }),
    }))
    const ctx = await import('./SectionRunsContext')
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ctx.SectionRunsProvider, null, children)
    const { result } = renderHook(() => ctx.usePasscodeDismissed('Logic-paused'), { wrapper })
    await act(async () => {})
    expect(result.current).toBe(false)
    act(() => ctx.dismissPasscode('Logic-paused'))
    expect(result.current).toBe(true)
    act(() => ctx.reopenPasscode('Logic-paused'))
    expect(result.current).toBe(false)
    act(() => ctx.dismissPasscode('Logic-paused'))
    snapshot = [run('Logic', 'running')]
    await act(async () => ping())
    snapshot = [run('Logic', 'paused')]
    await act(async () => ping())
    expect(result.current).toBe(false)
  })
})

describe('engagedRefs', () => {
  const target = (ref: string, disposition: SectionRun['targets'][number]['disposition']) =>
    ({
      ref,
      name: ref,
      kind: 'lecture',
      media: 'video',
      disposition,
    }) as SectionRun['targets'][number]

  it('holds the unreached and started rows of a walking run, per course', () => {
    const walking = {
      ...run('A', 'running'),
      targets: [target('p', 'pending'), target('q', 'queued'), target('s', 'skipped')],
    }
    const done = { ...run('B', 'done'), targets: [target('x', 'queued')] }
    const refs = engagedRefs([walking, done])
    expect([...(refs.get('A') ?? [])]).toEqual(['p', 'q'])
    expect(refs.has('B')).toBe(false)
  })
})
