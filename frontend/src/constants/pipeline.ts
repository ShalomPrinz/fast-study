import type { Step, FileName } from '../types'

export const PIPELINE: Array<{ file: FileName; step?: Step; actionLabel?: string; prereq?: FileName }> = [
  { file: 'video.mp4' },
  { file: 'audio.mp3',      step: 'audio',      actionLabel: 'Extract Audio',   prereq: 'video.mp4'      },
  { file: 'transcript.txt', step: 'transcribe', actionLabel: 'Transcribe',      prereq: 'audio.mp3'      },
  { file: 'summary.md',     step: 'summarize',  actionLabel: 'Summarize',       prereq: 'transcript.txt' },
  { file: 'summary.pdf',    step: 'pdf',        actionLabel: 'Export PDF',      prereq: 'summary.md'     },
  { file: 'drive_url.txt',  step: 'drive',      actionLabel: 'Upload to Drive', prereq: 'summary.pdf'    },
]

export const STEP_FILE = Object.fromEntries(
  PIPELINE.flatMap(p => p.step ? [[p.step, p.file]] : [])
) as Partial<Record<Step, FileName>>

export const STEP_INPUT_FILE = Object.fromEntries(
  PIPELINE.flatMap(p => p.step && p.prereq ? [[p.step, p.prereq]] : [])
) as Partial<Record<Step, FileName>>

export const STEP_LABEL = Object.fromEntries(
  PIPELINE.flatMap(p => p.step && p.actionLabel ? [[p.step, p.actionLabel]] : [])
) as Partial<Record<Step, string>>

export const STEP_ERROR_LABEL: Record<Step, string> = {
  audio:      'Audio extraction failed',
  transcribe: 'Transcription failed',
  summarize:  'Summarization failed',
  pdf:        'PDF export failed',
  drive:      'Drive upload failed',
}

export const STEP_SET: Set<string> = new Set(
  PIPELINE.flatMap(p => p.step ? [p.step] : [])
)
