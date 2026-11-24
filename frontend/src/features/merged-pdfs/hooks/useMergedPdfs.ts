import { useEffect, useRef, useState } from 'react'
import type { MergedPdf } from '@/types'
import { fetchMergedPdfs } from '@/services/database'
import { useNotify } from '@/shared/hooks/useNotify'
import { useNewestRequest } from '@/shared/hooks/useLatestRequest'

/** A course's stored merged PDFs, newest first; `null` until the first answer. Refetched on each SSE notify, which the backend pings when a merge ends. */
export function useMergedPdfs(course: string): MergedPdf[] | null {
  const [items, setItems] = useState<MergedPdf[] | null>(null)
  const newest = useNewestRequest()
  const shown = useRef(course)

  async function refresh() {
    try {
      const list = await newest(fetchMergedPdfs(course))
      if (list && course === shown.current) setItems(list)
    } catch {
      // The http client already toasted it; the last list stays.
    }
  }

  useEffect(() => {
    shown.current = course
    setItems(null)
    void refresh()
  }, [course])

  useNotify(() => void refresh(), ['tree'])
  return items
}
