import { useRef, useState } from 'react'
import {
  saveSettings,
  type SavedSettings,
  type Settings,
  type SettingsPatch,
} from '@/services/settings'

interface Options {
  // The site the store held when the page loaded, `''` for none.
  storedSite: string
  // A connected, unexpired account: a switch would drop it, so it waits for a confirm.
  accountConnected: boolean
  onSaved: (saved: Settings) => void
  onFailed: (err: unknown) => void
}

// `/settings`' picked site, saved alone the moment it is chosen, so its account can be connected
// without a Save. Every save of the page runs on one chain, so none lands out of order. See docs/SETTINGS.md.
export function useSiteSave({ storedSite, accountConnected, onSaved, onFailed }: Options) {
  const saves = useRef<Promise<unknown>>(Promise.resolve())
  // The site the store holds as of the last landed save, and the one it will once the chain drains;
  // `null` until this page writes one.
  const savedSite = useRef<string | null>(null)
  const queuedSite = useRef<string | null>(null)
  const lastTask = useRef(0)
  // The pick waiting on the switch confirm.
  const [asking, setAsking] = useState<string | null>(null)
  // Bumped on a cancelled switch: the picker's key, so it remounts on the stored site.
  const [revision, setRevision] = useState(0)
  const latest = useRef({ storedSite, onSaved, onFailed })
  latest.current = { storedSite, onSaved, onFailed }

  const saved = () => savedSite.current ?? latest.current.storedSite
  const queued = () => queuedSite.current ?? saved()

  // Runs one save after every queued one; `site` is what it stores, if anything.
  function enqueue<T>(site: string | undefined, task: () => Promise<T>): Promise<T> {
    if (site !== undefined) queuedSite.current = site
    const id = ++lastTask.current
    // Only the last task drains the queue; an earlier one storing the same site must not clear it.
    const run = saves.current.then(task).finally(() => {
      if (id === lastTask.current) queuedSite.current = null
    })
    saves.current = run.catch(() => {})
    return run
  }

  // The whole form's Save, on the same chain as the picks.
  function save(patch: SettingsPatch): Promise<SavedSettings> {
    return enqueue(patch.moodleSite, async () => {
      const result = await saveSettings(patch)
      savedSite.current = result.moodleSite ?? ''
      return result
    })
  }

  function write(site: string) {
    void enqueue(site, async () => {
      // Checked here, not at the pick: an earlier save still queued may change what the store holds.
      if (site === saved()) return
      try {
        const result = await saveSettings({ moodleSite: site })
        savedSite.current = result.moodleSite ?? ''
        latest.current.onSaved(result)
      } catch (err) {
        latest.current.onFailed(err)
      }
    })
  }

  function pick(site: string) {
    if (site === queued()) return
    if (accountConnected) setAsking(site)
    else write(site)
  }

  function confirm() {
    if (asking !== null) write(asking)
    setAsking(null)
  }

  function cancel() {
    setAsking(null)
    setRevision((r) => r + 1)
  }

  return { pick, asking, confirm, cancel, revision, save }
}
