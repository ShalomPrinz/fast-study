import { Plural, Trans } from '@lingui/react/macro'
import type { Scope } from '../utils/scope'
import type { Media } from '../services/autoDownloader'
import MediaNote from './MediaNote'
import PausedRunsBanner from './PausedRunsBanner'
import './RecordingsSkeleton.css'

// Skeleton rows' name-bar widths: decreasing, for the ragged look of real titles.
const ROW_WIDTHS = [90, 70, 80, 55, 65]

// Paused runs live in a context, so the real banner is known before the course loads.
const noop = () => {}

// React 18 has no `inert` prop; the attribute takes the buttons out of the tab order and the click path.
const INERT = { inert: '' }

function InertBanner({ name, media }: { name: string; media: Media | null }) {
  return (
    <div className="sk-inert" {...INERT}>
      <PausedRunsBanner course={name} media={media} onSelectMedia={noop} />
    </div>
  )
}

// Videos, Materials and Assignments are the segments every course shows; Unknown appears only with content.
const CARDS = 3

// The panel while a course loads, built from the loaded panel's own classes: the controls row, the
// media note, a section head and cards, so its heights follow the same rules at every width.
export default function RecordingsSkeleton({
  name,
  media,
  scope,
  fresh,
}: {
  name: string
  media: Media
  scope: Scope
  // A course with no skips yet, which gets the first-load skip prompt above its list.
  fresh: boolean
}) {
  const total = 12
  return (
    <div className="recordings-panel" aria-busy="true">
      <span className="visually-hidden">
        <Trans>Loading recordings for {name}</Trans>
      </span>
      <div className="downloads-controls" aria-hidden="true">
        <div className="downloads-control">
          <span className="downloads-control-caption sk-shape sk-text">&nbsp;</span>
          <div className="mode-toggle mode-toggle--light downloads-scope-switch">
            <span className="mode-toggle-btn">
              <span className="sk-shape sk-text">&nbsp;</span>
            </span>
            <span className="mode-toggle-btn">
              <span className="sk-shape sk-text">&nbsp;</span>
            </span>
          </div>
        </div>
        <div className="downloads-control downloads-control--types">
          <span className="downloads-control-caption sk-shape sk-text">&nbsp;</span>
          {scope === 'new' ? (
            <p className="downloads-types-note">
              <span className="sk-shape sk-text">&nbsp;</span>
            </p>
          ) : (
            <div className="mode-toggle mode-toggle--cards">
              {Array.from({ length: CARDS }, (_, i) => (
                <span className="mode-toggle-btn" key={i}>
                  <span className="sk-shape sk-icon" />
                  <span className="sk-shape sk-text">&nbsp;</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {scope === 'new' ? (
        <div className="new-view" aria-hidden="true">
          <InertBanner name={name} media={null} />
          {fresh && (
            <div className="new-banner">
              <span className="new-banner-text sk-shape sk-ghost">
                <Plural
                  value={total}
                  one="This course has # item you haven't marked. Skip all old content?"
                  other="This course has # items you haven't marked. Skip all old content?"
                />
              </span>
              <span className="btn btn--ghost new-banner-skip">
                <span className="sk-shape sk-ghost">
                  <Trans>Skip all</Trans>
                </span>
              </span>
            </div>
          )}
          <section className="new-media">
            <h3 className="new-media-title">
              <span className="sk-shape sk-text">&nbsp;</span>
            </h3>
            <div className="new-section">
              <div className="new-section-head">
                <span className="new-section-title sk-shape sk-text sk-title">&nbsp;</span>
              </div>
              {ROW_WIDTHS.map((w) => (
                <div className="new-row" key={w}>
                  <span className="new-row-check sk-shape sk-icon" />
                  <div className="new-row-card">
                    <SkRow width={w} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <>
          <MediaNote media={media} ghost />
          <InertBanner name={name} media={media} />
          <div className="recordings-section" aria-hidden="true">
            <div className="group-header">
              <span className="sk-shape sk-text sk-title">&nbsp;</span>
              <span className="btn btn--ghost group-header-run">
                <span className="sk-shape sk-text">&nbsp;</span>
              </span>
            </div>
            <div className="recordings-section-body">
              {ROW_WIDTHS.map((w) => (
                <SkRow key={w} width={w} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SkRow({ width }: { width: number }) {
  return (
    <div className="sk-row">
      <span className="sk-shape sk-icon" />
      <span className="sk-shape sk-name" style={{ maxWidth: `${width}%` }} />
      <span className="sk-shape sk-action" />
    </div>
  )
}
