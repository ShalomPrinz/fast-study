import { t } from '@lingui/core/macro'
import type { Kind } from '@/types'
import { materialUrl, overviewFileUrl } from './database'
import { runtimeBridge } from './runtime'
import { toast } from './toaster'

// Opens files and links outside the app: through the bridge when packaged, since a new window cannot
// carry the secret; a plain new tab in browser dev — see docs/SERVICES.md.

async function openFile(call: Promise<void>): Promise<void> {
  try {
    await call
  } catch (e) {
    toast('error', t`Could not open the file: ${(e as Error).message}`)
  }
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
  await openFile(bridge.open.file({ course, lecture, name, kind }))
}

/** Whether the launcher can offer "Open with…": the bridge has it and the OS is Windows. */
export function canOpenWith(): boolean {
  const bridge = runtimeBridge()
  return !!bridge?.open.fileWith && bridge.platform === 'win32'
}

/** The OS's "Open with…" picker for a lecture file; no browser fallback, so callers gate on `canOpenWith`. */
export async function openLectureFileWith(
  course: string,
  lecture: string,
  name: string,
  kind?: Kind,
): Promise<void> {
  const fileWith = runtimeBridge()?.open.fileWith
  if (!fileWith) return
  await openFile(fileWith({ course, lecture, name, kind }))
}

/** A generated file under a course's `overview/`. */
export async function openOverviewFile(course: string, name: string): Promise<void> {
  const bridge = runtimeBridge()
  if (!bridge) {
    window.open(overviewFileUrl(course, name), '_blank')
    return
  }
  await openFile(bridge.open.file({ course, name }))
}

/** An http(s) link; the bridge refuses and reports anything else. Call from `onClick` with
 *  `preventDefault()` — the packaged shell denies `window.open`, so `target="_blank"` does nothing. */
export async function openExternalUrl(url: string | undefined): Promise<void> {
  const bridge = runtimeBridge()
  if (!bridge) {
    window.open(url, '_blank')
    return
  }
  try {
    await bridge.open.external(url)
  } catch (e) {
    toast('error', t`Could not open the link: ${(e as Error).message}`)
  }
}
