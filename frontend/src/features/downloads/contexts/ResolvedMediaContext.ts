import { createContext, useContext } from 'react'
import type { ResolvedMedia } from '../services/autoDownloader'

/** Record what a download (or its 422) proved an 'unknown' row to be, keyed by item ref. */
export type ResolveMedia = (ref: string, media: ResolvedMedia) => void

// Dispatch only: the verdict is stamped onto the item itself. Provided above the media segments,
// since a segment switch unmounts every row.
export const ResolvedMediaContext = createContext<ResolveMedia | null>(null)

export function useResolveMedia(): ResolveMedia {
  const resolve = useContext(ResolvedMediaContext)
  if (!resolve) throw new Error('useResolveMedia must be used within a <DownloadsView>')
  return resolve
}
