// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Settings } from '@/services/settings'
import { useSiteSave } from './useSiteSave'
import { accountView } from '../utils/moodleSites'

const { saveSettings } = vi.hoisted(() => ({ saveSettings: vi.fn() }))
vi.mock('@/services/settings', () => ({ saveSettings }))

const BIU = 'https://lemida.biu.ac.il'
const BGU = 'https://moodle.bgu.ac.il/moodle'
const stored = (moodleSite: string | null) => ({ moodleSite }) as Settings

function render(storedSite: string, accountConnected: boolean) {
  const onSaved = vi.fn()
  const onFailed = vi.fn()
  const hook = renderHook(() => useSiteSave({ storedSite, accountConnected, onSaved, onFailed }))
  return { hook, onSaved, onFailed }
}

// Lets every queued save land.
const settle = () => act(async () => {})

beforeEach(() => {
  saveSettings.mockReset()
  saveSettings.mockImplementation(async (patch: { moodleSite: string }) => stored(patch.moodleSite))
})

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => (resolve = res))
  return { promise, resolve }
}

describe('useSiteSave', () => {
  it('saves a confirmed site at once with nothing saved, so Connect shows without a Save', async () => {
    const { hook, onSaved } = render('', false)
    act(() => hook.result.current.pick(BIU))
    await settle()
    expect(saveSettings).toHaveBeenCalledWith({ moodleSite: BIU })
    const saved = onSaved.mock.calls[0][0] as Settings
    expect(accountView(saved.moodleSite, BIU)).toBe('connect')
  })

  it('never resends the stored site, and lands quick picks in order', async () => {
    const { hook } = render(BIU, false)
    act(() => hook.result.current.pick(BIU))
    act(() => {
      hook.result.current.pick(BGU)
      hook.result.current.pick(BGU)
    })
    await settle()
    expect(saveSettings.mock.calls).toEqual([[{ moodleSite: BGU }]])
  })

  it('asks before dropping a connected account; a cancel saves nothing and remounts the picker', async () => {
    const { hook } = render(BIU, true)
    act(() => hook.result.current.pick(BGU))
    expect(hook.result.current.asking).toBe(BGU)
    const before = hook.result.current.revision
    act(() => hook.result.current.cancel())
    await settle()
    expect(hook.result.current.asking).toBeNull()
    expect(hook.result.current.revision).not.toBe(before)
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('saves the switch, or the removal, once confirmed', async () => {
    const { hook, onSaved } = render(BIU, true)
    act(() => hook.result.current.pick(''))
    expect(hook.result.current.asking).toBe('')
    act(() => hook.result.current.confirm())
    await settle()
    expect(saveSettings).toHaveBeenCalledWith({ moodleSite: '' })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(hook.result.current.asking).toBeNull()
  })

  it('reports a failed save', async () => {
    saveSettings.mockRejectedValueOnce(new Error('down'))
    const { hook, onFailed, onSaved } = render('', false)
    act(() => hook.result.current.pick(BIU))
    await settle()
    expect(onFailed).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('saves a pick back to the stored site while a switch away is still in flight', async () => {
    const away = deferred<Settings>()
    saveSettings.mockImplementationOnce(() => away.promise)
    const { hook, onSaved } = render(BIU, false)
    act(() => hook.result.current.pick(BGU))
    act(() => hook.result.current.pick(BIU))
    await act(async () => away.resolve(stored(BGU)))
    await settle()
    expect(saveSettings.mock.calls).toEqual([[{ moodleSite: BGU }], [{ moodleSite: BIU }]])
    expect(onSaved.mock.calls.at(-1)?.[0]).toEqual(stored(BIU))
  })

  it("runs a pick after a Save already in flight, so the Save's answer never lands last", async () => {
    const form = deferred<Settings>()
    saveSettings.mockImplementationOnce(() => form.promise)
    const { hook, onSaved } = render(BIU, false)
    let landed: Settings | undefined
    act(() => {
      void hook.result.current.save({ nightlyHour: 5 }).then((s) => (landed = s))
    })
    act(() => hook.result.current.pick(BGU))
    await settle()
    // The pick waits for the Save.
    expect(saveSettings.mock.calls).toEqual([[{ nightlyHour: 5 }]])
    await act(async () => form.resolve(stored(BIU)))
    await settle()
    expect(landed).toEqual(stored(BIU))
    expect(saveSettings.mock.calls.at(-1)).toEqual([{ moodleSite: BGU }])
    expect(onSaved.mock.calls.at(-1)?.[0]).toEqual(stored(BGU))
  })

  it('saves a later pick after A, B, A, so the store ends on what the picker shows', async () => {
    const C = 'https://moodle26.technion.ac.il'
    const last = deferred<Settings>()
    saveSettings
      .mockImplementationOnce(async () => stored(BIU))
      .mockImplementationOnce(async () => stored(BGU))
      .mockImplementationOnce(() => last.promise)
    const { hook } = render(C, false)
    act(() => {
      hook.result.current.pick(BIU)
      hook.result.current.pick(BGU)
      hook.result.current.pick(BIU)
    })
    // The first two have landed; the second BIU is still in flight when BGU is picked again.
    await settle()
    act(() => hook.result.current.pick(BGU))
    await act(async () => last.resolve(stored(BIU)))
    await settle()
    expect(saveSettings.mock.calls.at(-1)).toEqual([{ moodleSite: BGU }])
  })
})
