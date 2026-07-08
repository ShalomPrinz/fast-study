import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import type { OverviewExtractor, CourseFile, CourseStatus } from '@/types'
import { fetchOverviewExtractors, fetchCourseStatus, runOverview } from '@/services/backend'
import { fetchCourseFiles, overviewFileUrl } from '@/services/database'
import { useNotify } from '@/hooks/useNotify'
import { useLatestRequest } from '@/hooks/useLatestRequest'
import { useReportOnce } from '@/hooks/useReportOnce'
import { toast, toastInitResult } from '@/services/toaster'
import { lastGeneratedFile, generatedFiles, startedSlug } from '@/constants/overview'
import type { StartedSlug } from '@/constants/overview'
import Icon from '@/components/Icon'
import ConfirmModal from '@/components/ConfirmModal'

interface BranchStatus {
  running: boolean
  done: boolean
  error: string | null
}

function BranchIndicator({ status }: { status: BranchStatus }) {
  if (status.running) return <span className="spinner spinner--sm" />
  if (status.error) return <span className="course-stage-error" title={status.error}>⚠</span>
  if (status.done) return <span className="file-check">✓</span>
  return <span className="course-stage-dot" />
}

export default function CourseView() {
  const { course = '' } = useParams()
  const [extractors, setExtractors] = useState<OverviewExtractor[] | null>(null)
  const [files, setFiles] = useState<CourseFile[]>([])
  const [status, setStatus] = useState<CourseStatus | null>(null)
  const [regenerateTarget, setRegenerateTarget] = useState<{ slug: string; title: string } | null>(null)
  const [generateAllWarning, setGenerateAllWarning] = useState<(StartedSlug & { title: string })[] | null>(null)
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

  function branchStatus(slug: string): BranchStatus {
    const st = status?.extractors[slug]
    return {
      running: running && st?.status === 'running',
      done: files.some((f) => f.name === lastGeneratedFile(slug)),
      error: st?.status === 'error' ? (st.message ?? 'failed') : null,
    }
  }

  // A single trigger runs both phases sequentially server-side; omitting names = all.
  async function handleGenerate(names?: string[]) {
    const result = await runOverview(course, names)
    toastInitResult(result, {
      busy: 'Overview is already running for this course',
      error: 'Overview failed to start',
    })
    refresh()
  }

  function confirmRegenerate() {
    if (!regenerateTarget) return
    const { slug } = regenerateTarget
    setRegenerateTarget(null)
    handleGenerate([slug])
  }

  function handleGenerateAll() {
    const existing = new Set(files.map((f) => f.name))
    const started = (extractors ?? []).flatMap(({ slug, title }) => {
      const st = startedSlug(slug, existing)
      return st ? [{ title, ...st }] : []
    })
    if (started.length === 0) {
      handleGenerate()
    } else {
      setGenerateAllWarning(started)
    }
  }

  return (
    <main className="main-view main-view--panel">
      <div className="lecture-panel">
        <h2 className="lecture-panel-title" dir="auto">{course}</h2>

        <button
          className="run-all-btn course-global-btn"
          onClick={handleGenerateAll}
          disabled={running || extractors === null}
        >
          {running && <span className="spinner spinner--sm" />}
          {running ? 'Generating…' : 'Generate All'}
        </button>

        {extractors === null ? (
          <div className="spinner" />
        ) : (
          <div className="file-list">
            {extractors.map(({ slug, title }) => {
              const bs = branchStatus(slug)
              return (
                <div
                  key={slug}
                  className={`file-row course-branch${bs.done ? ' file-row--present' : ''}${bs.running ? ' file-row--running' : ''}`}
                >
                  <div className="course-branch-header">
                    <span className="course-branch-name">{title}</span>
                    <span className="course-branch-actions">
                      <BranchIndicator status={bs} />
                      {bs.done && (
                        <button
                          className="file-open-btn"
                          title="Open PDF in new tab"
                          onClick={() => window.open(overviewFileUrl(course, lastGeneratedFile(slug)), '_blank')}
                        >
                          <Icon icon="external-link" />
                        </button>
                      )}
                      {bs.done ? (
                        <button
                          className="file-rotate-btn"
                          title={`Re-generate ${title}`}
                          onClick={() => setRegenerateTarget({ slug, title })}
                          disabled={running}
                        >↺</button>
                      ) : (
                        <button
                          className="file-action-btn"
                          onClick={() => handleGenerate([slug])}
                          disabled={running}
                        >
                          Generate
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {regenerateTarget && (
        <ConfirmModal
          message="The following files will be re-generated:"
          detail={
            <ul className="modal-file-list">
              {generatedFiles(regenerateTarget.slug).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          }
          onConfirm={confirmRegenerate}
          onCancel={() => setRegenerateTarget(null)}
        />
      )}

      {generateAllWarning && (
        <ConfirmModal
          message="Generating all will re-generate:"
          postMessage="Are you sure you want to re-generate everything?"
          detail={
            <ul className="modal-slug-list">
              {generateAllWarning.map(({ title, willRegenerate }) => (
                <li key={title} className="modal-slug-item">
                  <span className="modal-slug-title">{title}</span>
                  <ul className="modal-file-list">
                    {willRegenerate.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          }
          onConfirm={() => {
            setGenerateAllWarning(null)
            handleGenerate()
          }}
          onCancel={() => setGenerateAllWarning(null)}
        />
      )}
    </main>
  )
}
