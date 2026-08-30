import { msg } from '@lingui/core/macro'
import type { MessageDescriptor } from '@lingui/core'
import type { Step, FileName, FileStatus } from '@/types'

// Labels are message descriptors, not strings: this table is module-level, so it is built once,
// before a locale exists. Rendering sites resolve them against the active catalog.

// `stageLabel` names the stage both pending and done; `runningLabel` replaces it only while the step
// is in flight. There is deliberately no past-tense third form — a done row reuses `stageLabel`.
export const PIPELINE: Array<{
  file: FileName
  stageLabel: MessageDescriptor
  step?: Step
  runningLabel?: MessageDescriptor
  actionLabel?: MessageDescriptor
  prereq?: FileName
}> = [
  { file: 'video.mp4', stageLabel: msg`Video` },
  {
    file: 'audio.mp3',
    stageLabel: msg`Audio`,
    step: 'audio',
    runningLabel: msg`Extracting audio`,
    actionLabel: msg`Extract Audio`,
    prereq: 'video.mp4',
  },
  {
    file: 'transcript.txt',
    stageLabel: msg`Transcript`,
    step: 'transcribe',
    runningLabel: msg`Transcribing`,
    actionLabel: msg`Transcribe`,
    prereq: 'audio.mp3',
  },
  {
    file: 'summary.md',
    stageLabel: msg`Summary`,
    step: 'summarize',
    runningLabel: msg`Summarizing`,
    actionLabel: msg`Summarize`,
    prereq: 'transcript.txt',
  },
  {
    file: 'summary.pdf',
    stageLabel: msg`PDF`,
    step: 'pdf',
    runningLabel: msg`Exporting PDF`,
    actionLabel: msg`Export PDF`,
    prereq: 'summary.md',
  },
  {
    file: 'drive_url.txt',
    stageLabel: msg`Drive`,
    step: 'drive',
    runningLabel: msg`Uploading to Drive`,
    actionLabel: msg`Upload to Drive`,
    prereq: 'summary.pdf',
  },
]

// The stages a lecture actually shows. Drive is dropped when the setting is off — the backend
// rejects `run/drive` and stops counting it towards completion — but a lecture uploaded while it was
// on keeps the row, so its result stays reachable.
export function visiblePipeline(driveEnabled: boolean, files: FileStatus): typeof PIPELINE {
  if (driveEnabled || files['drive_url.txt'].exists) return PIPELINE
  return PIPELINE.filter((p) => p.step !== 'drive')
}

const STEP_FILE_MUT: Partial<Record<Step, FileName>> = {}
const STEP_INPUT_FILE_MUT: Partial<Record<Step, FileName>> = {}
const STEP_LABEL_MUT: Partial<Record<Step, MessageDescriptor>> = {}
const STEP_SET_MUT = new Set<string>()

for (const p of PIPELINE) {
  if (!p.step) continue
  STEP_FILE_MUT[p.step] = p.file
  if (p.prereq) STEP_INPUT_FILE_MUT[p.step] = p.prereq
  if (p.actionLabel) STEP_LABEL_MUT[p.step] = p.actionLabel
  STEP_SET_MUT.add(p.step)
}

export const STEP_FILE: Partial<Record<Step, FileName>> = STEP_FILE_MUT
export const STEP_INPUT_FILE: Partial<Record<Step, FileName>> = STEP_INPUT_FILE_MUT
export const STEP_LABEL: Partial<Record<Step, MessageDescriptor>> = STEP_LABEL_MUT
export const STEP_SET: Set<string> = STEP_SET_MUT

export const STEP_ERROR_LABEL: Record<Step, MessageDescriptor> = {
  audio: msg`Audio extraction failed`,
  transcribe: msg`Transcription failed`,
  summarize: msg`Summarization failed`,
  pdf: msg`PDF export failed`,
  drive: msg`Drive upload failed`,
}
