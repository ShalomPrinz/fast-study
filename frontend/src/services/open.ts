import { t } from '@lingui/core/macro'
import type { Kind } from '@/types'
import { materialUrl, overviewFileUrl } from './database'
import { runtimeBridge } from './runtime'
import type { OpenResult } from './runtime'
import { toast } from './toaster'

// The single boundary for opening something outside the app. In the packaged app a fresh browser
// navigation cannot set `X-FastStudy-Secret`, so a service URL opened that way is a 401 and a blank
// window; the bridge resolves the file through `database/` and lets the OS open it instead. No
// bridge is browser dev, where nothing enforces a secret and a new tab is still the right answer.

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

/** An http(s) link — the Drive URL today. `url` is optional because the tree types it so; the
 *  bridge refuses anything that is not a URL, and reports it. */
export async function openExternalUrl(url: string | undefined): Promise<void> {
  const bridge = runtimeBridge()
  if (!bridge) {
    window.open(url, '_blank')
    return
  }
  reportLink(await bridge.open.external(url))
}
