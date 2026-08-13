import { createContext, useContext } from 'react'
import type { ResolvedMedia } from '../services/autoDownloader'

/** Record what a download (or its 422) proved an 'unknown' row to be, keyed by item ref. */
export type ResolveMedia = (ref: string, media: ResolvedMedia) => void

// Dispatch only, no state half: the verdict is written straight onto the owning `items` list, so a
// row keeps reading its type from `item.resolvedMedia` alone. It lives above the media segments
// because switching segment unmounts every row — anything held lower is lost on the way back.
export const ResolvedMediaContext = createContext<ResolveMedia | null>(null)

export function useResolveMedia(): ResolveMedia {
  const resolve = useContext(ResolvedMediaContext)
  if (!resolve) throw new Error('useResolveMedia must be used within a <DownloadsView>')
  return resolve
}
