import type { Course, FileStatus, MergedPart } from '@/types'
import { lectureTrack, recitationTrack } from '@/features/lectures/utils/courseTree'
import { failureOf } from '@/shared/utils/failure'
import type { MergedPrefill } from '../types'

/** A part's identity in the picker and the sortable list: a lecture and a recitation may share a name. */
export const partKey = (part: MergedPart): string => `${part.kind}:${part.name}`

/** `ok` is mergeable; `outdated` is mergeable but its `summary.pdf` predates `summary.md`; `missing` has no PDF to merge. */
export type PdfState = 'ok' | 'outdated' | 'missing'

export function pdfState(files: Pick<FileStatus, 'summary.md' | 'summary.pdf'>): PdfState {
  const pdf = files['summary.pdf']
  if (!pdf.exists) return 'missing'
  const md = files['summary.md']
  return md.exists && md.mtime !== null && pdf.mtime !== null && pdf.mtime < md.mtime
    ? 'outdated'
    : 'ok'
}

export interface PickItem {
  part: MergedPart
  state: PdfState
}

/** The picker's lists in the sidebar's order; a lectures-only course has one (its merged lecture track) and no recitations. */
export function pickGroups(course: Course): { lectures: PickItem[]; recitations: PickItem[] } {
  const items = (list: ReturnType<typeof lectureTrack>): PickItem[] =>
    list.map((l) => ({ part: { name: l.name, kind: l.kind }, state: pdfState(l.files) }))
  return { lectures: items(lectureTrack(course)), recitations: items(recitationTrack(course)) }
}

export const mergeable = (items: PickItem[]): MergedPart[] =>
  items.filter((i) => i.state !== 'missing').map((i) => i.part)

/** A ticked part stays clickable so it can be unticked even after its PDF is gone; an unticked unmergeable one cannot be ticked. */
export const checkboxDisabled = (state: PdfState, ticked: boolean): boolean =>
  state === 'missing' && !ticked

/** Drops the ordered parts the course no longer lists at all (renamed or deleted), keeping the rest in order. */
export function pruneVanished(
  order: MergedPart[],
  items: PickItem[],
): { order: MergedPart[]; dropped: MergedPart[] } {
  const present = new Set(items.map((i) => partKey(i.part)))
  const dropped = order.filter((p) => !present.has(partKey(p)))
  return dropped.length === 0
    ? { order, dropped }
    : { order: order.filter((p) => present.has(partKey(p))), dropped }
}

/** Ticking appends at the bottom; unticking removes. */
export function toggleInOrder(order: MergedPart[], part: MergedPart, on: boolean): MergedPart[] {
  const key = partKey(part)
  const has = order.some((p) => partKey(p) === key)
  if (on) return has ? order : [...order, part]
  return has ? order.filter((p) => partKey(p) !== key) : order
}

/** The shortcut: appends every part not yet ticked, in the given order. */
export function appendMissing(order: MergedPart[], parts: MergedPart[]): MergedPart[] {
  return parts.reduce((acc, p) => toggleInOrder(acc, p, true), order)
}

/** Moves the part at `from` to index `to`; an out-of-range index leaves the order as it was. */
export function movePart(order: MergedPart[], from: number, to: number): MergedPart[] {
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < order.length
  if (!inRange(from) || !inRange(to) || from === to) return order
  const next = [...order]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

function isPart(value: unknown): value is MergedPart {
  const p = value as MergedPart | null
  return typeof p?.name === 'string' && (p.kind === 'lecture' || p.kind === 'recitation')
}

/** A Re-create hand-off read back from untyped router state, or null when there is none (a fresh page). */
export function readPrefill(state: unknown): MergedPrefill | null {
  const s = state as Partial<MergedPrefill> | null
  if (typeof s?.title !== 'string' || !Array.isArray(s.parts)) return null
  return { title: s.title, parts: s.parts.filter(isPart) }
}

/** The prefilled order keeps the parts still mergeable in the course, in their old order, and names the rest. */
export function applyPrefill(
  prefill: MergedPrefill,
  mergeableParts: MergedPart[],
): { order: MergedPart[]; dropped: MergedPart[] } {
  const ok = new Set(mergeableParts.map(partKey))
  const order: MergedPart[] = []
  const dropped: MergedPart[] = []
  for (const part of prefill.parts) {
    if (!ok.has(partKey(part))) dropped.push(part)
    else if (!order.some((p) => partKey(p) === partKey(part))) order.push(part)
  }
  return { order, dropped }
}

export const canCreate = (title: string, order: MergedPart[]): boolean =>
  title.trim() !== '' && order.length > 0

export type SubmitOutcome = { status: 'started' | 'busy' } | { error: unknown }
export type SubmitAction = 'navigate' | 'confirm-overwrite' | 'toast'

/** What the page does with the answer: an accepted or busy merge goes to the history; a first refusal for an existing title asks before replacing; anything else toasts. */
export function submitAction(outcome: SubmitOutcome, overwrite: boolean): SubmitAction {
  if ('status' in outcome) return 'navigate'
  const exists = failureOf(outcome.error).code === 'merged_pdf_exists'
  return exists && !overwrite ? 'confirm-overwrite' : 'toast'
}

/** The title the replace prompt names: the server's `title` param on `merged_pdf_exists`, else what was typed. */
export function existingTitle(outcome: SubmitOutcome, typed: string): string {
  if (!('error' in outcome)) return typed
  const title = failureOf(outcome.error).params?.title
  return typeof title === 'string' && title !== '' ? title : typed
}
