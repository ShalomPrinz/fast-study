import { t } from '@lingui/core/macro'
import type { Kind } from '@/types'
import { assignmentFileUrl, materialUrl, overviewFileUrl } from './database'
import { runtimeBridge } from './runtime'
import { toast } from './toaster'

// Opens files and links outside the app: through the bridge when packaged, since a new window cannot
// carry the secret; a plain new tab in browser dev — see docs/SERVICES.md.

async function openFile(call: Promise<void>): Promise<void> {
  try {
    await call
  } catch (e) {
    // The bridge carries a `code` but no params, so the shared `file_not_found` row (which names the
    // file) cannot render; this sentence stands in for it.
    if ((e as { code?: string }).code === 'file_not_found') {
      toast('error', t`Could not open the file: it no longer exists.`)
    } else {
      toast('error', t`Could not open the file: ${(e as Error).message}`)
    }
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

/** One file of a course assignment: the OS default app packaged, a new tab in browser dev. */
export async function openAssignmentFile(
  course: string,
  assignment: string,
  name: string,
): Promise<void> {
  const bridge = runtimeBridge()
  if (!bridge) {
    window.open(assignmentFileUrl(course, assignment, name), '_blank')
    return
  }
  await openFile(bridge.open.file({ course, assignment, name }))
}

/** The OS's "Open with…" picker for an assignment file; callers gate on `canOpenWith`. */
export async function openAssignmentFileWith(
  course: string,
  assignment: string,
  name: string,
): Promise<void> {
  const fileWith = runtimeBridge()?.open.fileWith
  if (!fileWith) return
  await openFile(fileWith({ course, assignment, name }))
}

/** Whether the launcher can show a file in its folder; browser dev and older launchers cannot. */
export function canReveal(): boolean {
  return !!runtimeBridge()?.open.reveal
}

/** Shows an assignment file in the OS file manager; callers gate on `canReveal`. */
export async function revealAssignmentFile(
  course: string,
  assignment: string,
  name: string,
): Promise<void> {
  const reveal = runtimeBridge()?.open.reveal
  if (!reveal) return
  await openFile(reveal({ course, assignment, name }))
}
