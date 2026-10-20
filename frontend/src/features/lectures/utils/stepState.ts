import type { RunError } from '@/types'
import type { StatusNodeState } from '@/shared/components/StatusNode'
import { isQuotaError } from '@/shared/utils/runError'

// A pipeline row's glyph: a removed file wins, then the file, then a running step, then the lecture's
// last error when its `step` names this row — the backend's word, never a guess from which file is missing.
export function stepState(
  removed: boolean,
  exists: boolean,
  isRunning: boolean,
  step: string | undefined,
  error: RunError | null,
): StatusNodeState {
  if (removed) return 'removed'
  if (exists) return 'done'
  if (isRunning) return 'running'
  if (step && error?.step === step) return isQuotaError(error.code) ? 'quota' : 'failed'
  return 'pending'
}

export type StageControl = 'removed' | 'rotate' | 'skipped' | 'run' | 'not-provided' | null

// The one thing at a pipeline row's end; a removed file shows only its label, with no action.
export function stageControl(row: {
  removed: boolean
  exists: boolean
  running: boolean
  skipped: boolean
  hasStep: boolean
  canRotate: boolean
}): StageControl {
  if (row.removed) return 'removed'
  if (row.exists) return row.hasStep && row.canRotate ? 'rotate' : null
  if (row.skipped) return row.running ? null : 'skipped'
  if (!row.hasStep) return 'not-provided'
  return row.running ? null : 'run'
}
