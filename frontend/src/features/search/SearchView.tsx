import { useEffect, useMemo, useState } from 'react'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { useCourseTreeContext } from '@/shared/contexts/CourseTreeContext'
import Icon from '@/shared/components/Icon'
import PageHeader from '@/shared/components/PageHeader'
import type { CourseSummary } from '@/types'
import { useCourseSummaries } from './hooks/useCourseSummaries'
import { buildHit, findMatches, groupMatches, type Hit, type MatchGroup } from './utils/search'
import SearchResult from './components/SearchResult'
import '@/styles/panel.css'
import '@/styles/button.css'
import '@/styles/pipeline-card.css'
import './SearchView.css'

const COURSE_STORAGE_KEY = 'fastStudySearchCourse'

// Findings per page. Snippets are built only for what's on screen, so "Show more" stays cheap.
const PAGE_SIZE = 20

// Client-side search over one course's summaries. See docs/search.md.
export default function SearchView() {
  const { t } = useLingui()
  const { courses } = useCourseTreeContext()
  const active = courses.filter((c) => !c.archived)

  const [chosen, setChosen] = useState(() => localStorage.getItem(COURSE_STORAGE_KEY))
  const [query, setQuery] = useState('')
  const [wholeWord, setWholeWord] = useState(false)
  const [includeLectures, setIncludeLectures] = useState(true)
  const [includeRecitations, setIncludeRecitations] = useState(true)
  const [shown, setShown] = useState(PAGE_SIZE)

  // Derived rather than stored, so a stale stored name (or a tree that hasn't loaded) falls back.
  const course = active.find((c) => c.name === chosen)?.name ?? active[0]?.name ?? null
  const { summaries, loading, error } = useCourseSummaries(course)

  function selectCourse(name: string) {
    setChosen(name)
    localStorage.setItem(COURSE_STORAGE_KEY, name)
  }

  const matches = useMemo(() => {
    const scope = summaries.filter((s) =>
      s.kind === 'lecture' ? includeLectures : includeRecitations,
    )
    return findMatches(scope, query, { wholeWord })
  }, [summaries, query, wholeWord, includeLectures, includeRecitations])

  const groups = useMemo(() => groupMatches(matches), [matches])

  // Paging counts findings, but a group is never split: the group crossing the threshold is included
  // whole, so every occurrence inside a rendered snippet's text is highlighted. Pages are therefore
  // 20-or-slightly-more findings.
  const visible = useMemo(() => {
    const out: MatchGroup[] = []
    let n = 0
    for (const group of groups) {
      if (n >= shown) break
      out.push(group)
      n += group.matches.length
    }
    return out
  }, [groups, shown])

  // Rendering is per lecture: the visible groups are regrouped by summary every render so a lecture
  // straddling a page boundary keeps one title block that simply grows.
  const blocks = useMemo(() => {
    const out: { summary: CourseSummary; hits: Hit[] }[] = []
    for (const group of visible) {
      const last = out[out.length - 1]
      if (last && last.summary === group.summary) last.hits.push(buildHit(group))
      else out.push({ summary: group.summary, hits: [buildHit(group)] })
    }
    return out
  }, [visible])

  const shownFindings = visible.reduce((n, g) => n + g.matches.length, 0)
  const lectures = groups.reduce(
    (n, g, i) => (i > 0 && groups[i - 1].summary === g.summary ? n : n + 1),
    0,
  )

  // A new search must not inherit the previous one's expanded page.
  useEffect(
    () => setShown(PAGE_SIZE),
    [query, wholeWord, includeLectures, includeRecitations, course],
  )

  // Which lectures have a summary.pdf to open, straight off the live tree.
  const withPdf = useMemo(() => {
    const node = courses.find((c) => c.name === course)
    const keys = new Set<string>()
    for (const kind of ['lecture', 'recitation'] as const) {
      for (const l of (kind === 'lecture' ? node?.lectures : node?.recitations) ?? []) {
        if (l.files['summary.pdf'].exists) keys.add(`${kind}:${l.name}`)
      }
    }
    return keys
  }, [courses, course])

  const searched = !loading && !error && query.trim().length > 0

  return (
    <main className="main-view main-view--page">
      <PageHeader
        title={t`Search summaries`}
        meta={
          <span>
            <Trans>
              Searches the generated summaries of one course — the one picked in the field
            </Trans>
          </span>
        }
      />

      <div className="page-body">
        <div className="page-column">
          {/* The course picker rides inside the field: switching course mid-search is rare, so the
              course reads as scope on the query rather than a control standing beside it. */}
          <div className="search-field">
            <span className="search-field-icon">
              <Icon icon="search" />
            </span>
            <input
              className="search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t`Search this course's summaries…`}
              dir="auto"
              autoFocus
            />
            <span className="search-field-divider" />
            <span className="search-course">
              <select
                className="search-course-select"
                value={course ?? ''}
                onChange={(e) => selectCourse(e.target.value)}
                aria-label={t`Course`}
                dir="auto"
              >
                {active.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <span className="search-course-chevron" aria-hidden="true">
                ▾
              </span>
            </span>
          </div>

          <div className="search-pills">
            <button
              className="search-pill"
              role="switch"
              aria-checked={includeLectures}
              onClick={() => setIncludeLectures((v) => !v)}
            >
              <Trans>Lectures</Trans>
            </button>
            <button
              className="search-pill"
              role="switch"
              aria-checked={includeRecitations}
              onClick={() => setIncludeRecitations((v) => !v)}
            >
              <Trans>Recitations</Trans>
            </button>
            <button
              className="search-pill"
              role="switch"
              aria-checked={wholeWord}
              onClick={() => setWholeWord((w) => !w)}
              title={t`Match whole word`}
            >
              <Trans>Whole word only</Trans>
            </button>
          </div>

          {loading && (
            <div className="search-status">
              <Trans>Loading summaries…</Trans>
            </div>
          )}
          {error && <div className="search-status search-status--error">{error}</div>}

          {searched && matches.length > 0 && (
            <div className="section-head">
              <h2 className="section-title">
                <Trans>Results</Trans>
              </h2>
              {/* Two counts, so two messages: one message would need a plural nested in a plural,
                  and each half already reads as a phrase on its own. */}
              <span className="section-count">
                <Plural value={matches.length} one="# result" other="# results" />{' '}
                <Plural value={lectures} one="in # lecture" other="in # lectures" />
                {shownFindings < matches.length && <Trans> — showing {shownFindings}</Trans>}
              </span>
            </div>
          )}

          {searched && matches.length === 0 && (
            <div className="search-empty">
              <div className="empty-state">
                <span className="empty-state-icon">
                  <Icon icon="search" />
                </span>
                <p className="empty-state-title">
                  <Trans>Nothing matched this search</Trans>
                </p>
              </div>
            </div>
          )}

          <div className="search-results">
            {blocks.map((block) => (
              <SearchResult
                key={`${block.summary.kind}:${block.summary.name}`}
                summary={block.summary}
                hits={block.hits}
                course={course ?? ''}
                hasPdf={withPdf.has(`${block.summary.kind}:${block.summary.name}`)}
              />
            ))}
          </div>

          {/* Advances from what's rendered, not the old threshold: a group overshooting the threshold
              would otherwise be re-selected unchanged and the click would do nothing. */}
          {shownFindings < matches.length && (
            <button
              className="btn btn--ghost search-more"
              onClick={() => setShown(shownFindings + PAGE_SIZE)}
            >
              <Trans>Show more</Trans>
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
