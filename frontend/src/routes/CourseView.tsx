import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import type { OverviewExtractor, CourseFile, CourseStatus, CoursePhase } from '@/types'
import { fetchOverviewExtractors, fetchCourseStatus, runOverviewExtract, runOverviewAnalyze } from '@/services/backend'
import { fetchCourseFiles, overviewFileUrl } from '@/services/database'
import { useNotify } from '@/hooks/useNotify'
import { useLatestRequest } from '@/hooks/useLatestRequest'
import { useReportOnce } from '@/hooks/useReportOnce'
import { toast, toastInitResult } from '@/services/toaster'
import { formatSize } from '@/utils/format'
import { PHASE_LABEL, stageFileName } from '@/constants/overview'

interface StageInfo {
  fileName: string
  file: CourseFile | null
  isRunning: boolean
  error: string | null
}

function StageChip({ course, label, stage }: { course: string; label: string; stage: StageInfo }) {
  const { fileName, file, isRunning, error } = stage
  return (
    <span className={`course-stage${file ? ' course-stage--done' : ''}`}>
      {isRunning ? (
        <span className="spinner spinner--sm" />
      ) : error ? (
        <span className="course-stage-error" title={error}>⚠</span>
      ) : file ? (
        <span className="file-check">✓</span>
      ) : (
        <span className="course-stage-dot" />
      )}
      {file ? (
        <a
          className="course-stage-link"
          href={overviewFileUrl(course, fileName)}
          target="_blank"
          rel="noreferrer"
        >
          {label}
          <span className="course-stage-size">{formatSize(file.size)}</span>
        </a>
      ) : (
        <span className="course-stage-label">{label}</span>
      )}
    </span>
  )
}

export default function CourseView() {
  const { course = '' } = useParams()
  const [extractors, setExtractors] = useState<OverviewExtractor[] | null>(null)
  const [files, setFiles] = useState<CourseFile[]>([])
  const [status, setStatus] = useState<CourseStatus | null>(null)
  const latestFiles = useLatestRequest()
  const latestStatus = useLatestRequest()
  const { report: reportError, prune: pruneErrors } = useReportOnce((msg) => toast('error', msg))

  useEffect(() => {
    fetchOverviewExtractors()
      .then(setExtractors)
      .catch(() => {}) // connection errors are toasted centrally by the http client
  }, [])

  async function refresh() {
    try {
      const [f, s] = await Promise.all([
        latestFiles(fetchCourseFiles(course)),
        latestStatus(fetchCourseStatus(course)),
      ])
      if (f) setFiles(f)
      if (s) setStatus(s)
    } catch {
      // connection errors are toasted centrally; SSE fires again on the next transition
    }
  }

  useEffect(() => {
    setFiles([])
    setStatus(null)
    refresh()
  }, [course])

  // Refresh status and files on each backend notify event
  useNotify(refresh)

  // Toast each extractor error once per (course, slug, message). Status is keyed by
  // slug; show the friendlier title when we have the extractor list loaded.
  useEffect(() => {
    if (!status) return
    const titleBySlug = new Map(extractors?.map((e) => [e.slug, e.title]))
    const valid = new Set<string>()
    for (const [slug, st] of Object.entries(status.extractors)) {
      if (st.status !== 'error') continue
      const key = `${course}/${slug}`
      valid.add(key)
      reportError(key, `${titleBySlug.get(slug) ?? slug}: ${st.message ?? 'failed'}`)
    }
    pruneErrors(valid)
  }, [status, course, extractors])

  if (!course) return null

  const running = status?.running ?? false

  function findFile(name: string): CourseFile | null {
    return files.find((f) => f.name === name) ?? null
  }

  function stageFor(slug: string, phase: CoursePhase): StageInfo {
    const fileName = stageFileName(slug, phase)
    const st = status?.extractors[slug]
    // Errors attribute to the phase the run was in — the extractors map always
    // describes the current/last run, whose phase is status.phase.
    return {
      fileName,
      file: findFile(fileName),
      isRunning: running && status?.phase === phase && st?.status === 'running',
      error: st?.status === 'error' && status?.phase === phase ? (st.message ?? 'failed') : null,
    }
  }

  async function handleExtract(names?: string[]) {
    const result = await runOverviewExtract(course, names)
    toastInitResult(result, { busy: 'Overview is already running for this course', error: 'Extraction failed to start' })
    refresh()
  }

  async function handleAnalyze(names?: string[]) {
    const result = await runOverviewAnalyze(course, names)
    toastInitResult(result, { busy: 'Overview is already running for this course', error: 'Analysis failed to start' })
    refresh()
  }

  const allTxt = extractors?.every((e) => findFile(stageFileName(e.slug, 'extract'))) ?? false
  const allMd = extractors?.every((e) => findFile(stageFileName(e.slug, 'analyze'))) ?? false
  const globalLabel = !allTxt ? 'Extract all' : allMd ? 'Regenerate notes' : 'Generate notes'

  return (
    <main className="main-view main-view--panel">
      <div className="lecture-panel">
        <h2 className="lecture-panel-title" dir="auto">{course}</h2>

        <button
          className="run-all-btn course-global-btn"
          onClick={() => (allTxt ? handleAnalyze() : handleExtract())}
          disabled={running || extractors === null}
        >
          {running && <span className="spinner spinner--sm" />}
          {running ? (status?.phase === 'analyze' ? 'Generating notes…' : 'Extracting…') : globalLabel}
        </button>

        {extractors === null ? (
          <div className="spinner" />
        ) : (
          <div className="file-list">
            {extractors.map(({ slug, title }) => {
              const snippets = stageFor(slug, 'extract')
              const notes = stageFor(slug, 'analyze')
              return (
                <div
                  key={slug}
                  className={`file-row course-branch${snippets.file && notes.file ? ' file-row--present' : ''}${snippets.isRunning || notes.isRunning ? ' file-row--running' : ''}`}
                >
                  <div className="course-branch-header">
                    <span className="course-branch-name">{title}</span>
                    <span className="course-branch-actions">
                      <button
                        className="file-action-btn"
                        onClick={() => handleExtract([slug])}
                        disabled={running}
                      >
                        Extract
                      </button>
                      <button
                        className="file-action-btn"
                        onClick={() => handleAnalyze([slug])}
                        disabled={running || !snippets.file}
                      >
                        Generate
                      </button>
                    </span>
                  </div>
                  <div className="course-stages">
                    <StageChip course={course} label={PHASE_LABEL.extract} stage={snippets} />
                    <span className="course-stage-arrow">→</span>
                    <StageChip course={course} label={PHASE_LABEL.analyze} stage={notes} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
