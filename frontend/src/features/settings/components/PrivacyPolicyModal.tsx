import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { Trans } from '@lingui/react/macro'
import { openExternalUrl } from '@/services/open'
import { readToEnd } from '../utils/privacy'
import '@/styles/modal.css'
import '@/styles/button.css'
import './PrivacyPolicyModal.css'

const ISSUES_URL = 'https://github.com/ShalomPrinz/fast-study/issues'

interface Props {
  // true for Confirm, false for Decline; both answer the policy.
  onAnswer: (confirmed: boolean) => void
  // Esc or a click outside: no answer at all.
  onClose: () => void
}

// The privacy policy, which must be scrolled to its end before Confirm unlocks. See docs/SETTINGS.md.
export default function PrivacyPolicyModal({ onAnswer, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [read, setRead] = useState(false)

  // Measured, not assumed: a tall window shows the whole policy without a scroll event ever firing.
  useLayoutEffect(() => {
    const check = () => {
      if (body.current && readToEnd(body.current)) setRead(true)
    }
    check()
    // Focused first, so the arrow and page keys scroll the policy straight away.
    body.current?.focus()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Esc closes without an answer; Tab cycles inside the dialog so focus never reaches the page behind.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab' || !dialog.current) return
      const focusable = dialog.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], [tabindex="0"]',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return ReactDOM.createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialog}
        className="modal privacy-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-title"
        data-privacy-read={read}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={body}
          className="privacy-body"
          tabIndex={0}
          onScroll={(e) => {
            if (readToEnd(e.currentTarget)) setRead(true)
          }}
        >
          <h2 id="privacy-title" className="privacy-title">
            <Trans>FastStudy privacy policy</Trans>
          </h2>
          <p>
            <Trans>
              FastStudy runs on your computer. Your lectures, transcripts and summaries stay in the
              folder you chose. There are no accounts, ads or usage tracking, and nothing is sold.
            </Trans>
          </p>

          <h3 className="privacy-heading">
            <Trans>Services you connect</Trans>
          </h3>
          <p>
            <Trans>FastStudy sends data only to services you set up yourself:</Trans>
          </p>
          <ul className="privacy-list">
            <li>
              <Trans>Groq gets a lecture's audio to transcribe it.</Trans>
            </li>
            <li>
              <Trans>Gemini gets the transcript and any PDFs you add, to write the summary.</Trans>
            </li>
            <li>
              <Trans>
                Google Drive gets the summary PDF, and only if you turned Drive upload on.
              </Trans>
            </li>
            <li>
              <Trans>Lecture sites are contacted only when you download from them.</Trans>
            </li>
          </ul>
          <p>
            <Trans>
              Each service handles the data under its own privacy policy, and your API keys are
              stored encrypted on this computer.
            </Trans>
          </p>

          <h3 className="privacy-heading">
            <Trans>Error reports</Trans>
          </h3>
          <p>
            <Trans>
              When something fails, FastStudy sends a report to Sentry. It contains the error, where
              in the code it happened, the app version, your operating system and the end of the
              app's log. Folder paths, Hebrew text, your user and computer names and API keys are
              removed before it's sent. Reports are used only to fix bugs, and Sentry keeps them for
              a limited time. You can turn them off at any time in Settings, and nothing more is
              sent from that moment on.
            </Trans>
          </p>

          <h3 className="privacy-heading">
            <Trans>Updates</Trans>
          </h3>
          <p>
            <Trans>Each time it starts, FastStudy checks GitHub for a new version.</Trans>
          </p>

          <h3 className="privacy-heading">
            <Trans>Contact</Trans>
          </h3>
          <p>
            <Trans>
              Questions go to the project's GitHub issues page:{' '}
              <a
                className="privacy-link"
                href={ISSUES_URL}
                dir="ltr"
                onClick={(e) => {
                  e.preventDefault()
                  void openExternalUrl(ISSUES_URL)
                }}
              >
                github.com/ShalomPrinz/fast-study/issues
              </a>
            </Trans>
          </p>
        </div>

        <div className="modal-actions privacy-actions">
          {!read && (
            <span className="privacy-scroll-hint">
              <Trans>Scroll to the end to confirm.</Trans>
            </span>
          )}
          <button
            className="btn btn--primary"
            data-privacy="confirm"
            disabled={!read}
            onClick={() => onAnswer(true)}
          >
            <Trans context="privacy policy">Confirm</Trans>
          </button>
          <button className="btn btn--ghost" data-privacy="decline" onClick={() => onAnswer(false)}>
            <Trans context="privacy policy">Decline</Trans>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
