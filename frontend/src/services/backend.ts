import type {
  Step,
  RunInitResult,
  TimingStats,
  TimingOperation,
  Kind,
  RunnerStatus,
  OverviewExtractor,
  CoursePhase,
  CourseExtractorState,
  CourseStatus,
} from '@/types'
import {
  kindQuery,
  lectureBase,
  courseOverviewBase,
  overviewGenerateQuery,
} from '@/shared/utils/url'
import { createClient } from './http'

const backend = createClient(
  import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
  'backend service',
)

export async function runStep(
  course: string,
  lecture: string,
  step: Step,
  kind?: Kind,
): Promise<RunInitResult> {
  return backend.post<RunInitResult>(
    `${lectureBase(course, lecture)}/run/${step}${kindQuery(kind)}`,
  )
}

export async function runPipeline(
  course: string,
  lecture: string,
  kind?: Kind,
): Promise<RunInitResult> {
  return backend.post<RunInitResult>(`${lectureBase(course, lecture)}/pipeline${kindQuery(kind)}`)
}

export async function fetchTimingStats(
  operation: TimingOperation,
  fileSizeBytes: number,
): Promise<TimingStats> {
  return backend.get<TimingStats>(`/timing/${operation}?file_size_bytes=${fileSizeBytes}`)
}

interface RawInFlightEntry {
  course: string
  lecture: string
  kind: Kind
  step: string
  started_at: string
  sleeping_until: string | null
  progress: { completed: number; total: number } | null
}

interface RawRunnerStatus {
  runner: { running: boolean; total: number; done: number; last_error: string | null }
  in_flight?: RawInFlightEntry[]
  errors?: Record<string, string>
}

function normalizeRunner(raw: RawRunnerStatus): RunnerStatus {
  return {
    runner: {
      running: raw.runner.running,
      total: raw.runner.total,
      done: raw.runner.done,
      lastError: raw.runner.last_error,
    },
    inFlight: (raw.in_flight ?? []).map((e) => ({
      course: e.course,
      lecture: e.lecture,
      kind: e.kind,
      step: e.step,
      startedAt: e.started_at,
      sleepingUntil: e.sleeping_until,
      progress: e.progress,
    })),
    errors: raw.errors ?? {},
  }
}

export async function runAll(): Promise<RunnerStatus | 'empty_queue' | 'all_in_flight'> {
  const raw = await backend.post<RawRunnerStatus & { status?: string }>('/run-all')
  if (raw.status === 'empty_queue') return 'empty_queue'
  if (raw.status === 'all_in_flight') return 'all_in_flight'
  return normalizeRunner(raw)
}

export async function fetchRunnerStatus(): Promise<RunnerStatus> {
  return normalizeRunner(await backend.get<RawRunnerStatus>('/status'))
}

interface RawOverviewExtractor {
  slug: string
  title: string
  phases?: CoursePhase[]
}

export async function fetchOverviewExtractors(): Promise<OverviewExtractor[]> {
  const raw = await backend.get<{ extractors: RawOverviewExtractor[] }>('/overview/extractors')
  return raw.extractors.map((e) => ({ slug: e.slug, title: e.title, phases: e.phases ?? [] }))
}

export async function runOverview(
  course: string,
  extractors?: string[],
  fromPhase?: CoursePhase,
  skipExisting?: boolean,
): Promise<RunInitResult> {
  return backend.post<RunInitResult>(
    courseOverviewBase(course) +
      '/generate' +
      overviewGenerateQuery(extractors, fromPhase, skipExisting),
  )
}

type RawCourseExtractorState = Omit<CourseExtractorState, 'startedAt'> & {
  started_at?: string | null
}

interface RawCourseStatus {
  running: boolean
  extractors?: Record<string, RawCourseExtractorState>
}

export async function fetchCourseStatus(course: string): Promise<CourseStatus> {
  const raw = await backend.get<RawCourseStatus>(courseOverviewBase(course) + '/status')
  return {
    running: raw.running,
    extractors: Object.fromEntries(
      Object.entries(raw.extractors ?? {}).map(([slug, { started_at, ...rest }]) => [
        slug,
        { ...rest, startedAt: started_at ?? null },
      ]),
    ),
  }
}
