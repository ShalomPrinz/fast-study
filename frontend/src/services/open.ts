import { t } from '@lingui/core/macro'
import type { Kind } from '@/types'
import { materialUrl, overviewFileUrl } from './database'
import { runtimeBridge } from './runtime'
import type { OpenResult } from './runtime'
import { toast } from './toaster'

// Opens files and links outside the app: through the bridge when packaged, since a new window cannot
// carry the secret; a plain new tab in browser dev — see docs/SERVICES.md.

function reportFile(result: OpenResult): void {
  if (!result.ok) toast('error', t`Could not open the file: ${result.error ?? 'unknown error'}`)
}

function reportLink(result: OpenResult): void {
  if (!result.ok) toast('error', t`Could not open the link: ${result.error ?? 'unknown error'}`)
}

/** One of a lecture's files — `summary.pdf` or a material alike. `materialUrl` builds the same
 *  route as `fileUrl` and takes a runtime name, which covers both. */
export async function openLectureFile(
  course: string,
  lecture: string,
  name: string,
  kind?: Kind,
): Promise<void> {
  const bridge = runtimeBridge()
  if (!bridge) {
    window.open(materialUrl(course, lecture, name, kind), '_blank')
    return
  }
  reportFile(await bridge.open.file({ course, lecture, name, kind }))
}

/** A generated file under a course's `overview/`. */
export async function openOverviewFile(course: string, name: string): Promise<void> {
  const bridge = runtimeBridge()
  if (!bridge) {
    window.open(overviewFileUrl(course, name), '_blank')
    return
  }
  reportFile(await bridge.open.file({ course, name }))
}

/** An http(s) link; the bridge refuses and reports anything else. Call from `onClick` with
 *  `preventDefault()` — the packaged shell denies `window.open`, so `target="_blank"` does nothing. */
export async function openExternalUrl(url: string | undefined): Promise<void> {
  const bridge = runtimeBridge()
  if (!bridge) {
    window.open(url, '_blank')
    return
  }
  reportLink(await bridge.open.external(url))
}
