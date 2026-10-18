import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { Kind } from '@/types'
import { fetchSummaryContent } from '@/services/database'
import { openExternalUrl } from '@/services/open'
import { saveSettings } from '@/services/settings'
import { toast } from '@/services/toaster'
import { toastFailure } from '@/shared/utils/failure'
import { useAiProvider, useSettingsContext } from '@/shared/contexts/SettingsContext'
import Icon from '@/shared/components/Icon'
import {
  AI_PROVIDER_IDS,
  AI_PROVIDERS,
  clipboardText,
  type AiProvider,
} from '@/features/lectures/utils/aiChat'
import '@/styles/button.css'
import './StudyWithAiCard.css'

interface Props {
  course: string
  lecture: string
  kind?: Kind
  summaryExists: boolean
}

// Copies a fixed study prompt plus the lecture's summary, then opens the chosen AI chat for the user
// to paste into; the provider half picks that chat and saves it as the setting. See docs/LECTURES.md.
export default function StudyWithAiCard({ course, lecture, kind, summaryExists }: Props) {
  const { t } = useLingui()
  const current = useAiProvider()
  const { setSettings } = useSettingsContext()
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const provider = AI_PROVIDERS[current].name

  // Pointerdown, not click: a click on another button would otherwise fire before the menu closes.
  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  async function openChat() {
    setBusy(true)
    try {
      let summary: string
      try {
        summary = (await fetchSummaryContent(course, lecture, kind)).content
      } catch (err) {
        toastFailure(err)
        return
      }
      const prompt = t`I want to study this lecture in depth, and soon I'll ask you specific questions about it. Its summary is below.

To start, reply with a single sentence — "What do you want to learn first?" — followed by a numbered list of 4–6 topics from the lecture to choose from.`
      try {
        await navigator.clipboard.writeText(clipboardText(prompt, course, lecture, summary))
      } catch {
        toast('error', t`Couldn't copy the summary. Try again.`)
        return
      }
      void openExternalUrl(AI_PROVIDERS[current].url)
      toast('success', t`Summary copied — paste it in the chat with Ctrl+V.`)
    } finally {
      setBusy(false)
    }
  }

  async function pick(next: AiProvider) {
    setMenuOpen(false)
    if (next === current) return
    try {
      setSettings(await saveSettings({ aiProvider: next }))
    } catch (err) {
      toastFailure(err)
    }
  }

  return (
    <section className="study-ai" data-state={summaryExists ? 'ready' : 'no-summary'}>
      <div className="study-ai-tile">
        <Icon icon="sparkle" />
      </div>
      <div className="study-ai-text">
        <h2 className="study-ai-title">
          <Trans>Study with AI</Trans>
        </h2>
        <p className="study-ai-subtitle">
          {summaryExists ? (
            <Trans>Click "Open chat" to study this lecture with {provider}.</Trans>
          ) : (
            <Trans>Available once the summary is generated.</Trans>
          )}
        </p>
      </div>
      <div className="study-ai-actions">
        <div className="study-ai-split" ref={menuRef}>
          <button
            className="btn study-ai-open"
            disabled={!summaryExists || busy}
            onClick={() => void openChat()}
          >
            <Trans>Open chat</Trans>
          </button>
          <button
            className="btn study-ai-provider"
            aria-label={t`Choose AI provider`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {provider}
            <Icon icon="chevron-down" />
          </button>
          {menuOpen && (
            <div className="study-ai-menu" role="menu" aria-label={t`Choose AI provider`}>
              {AI_PROVIDER_IDS.map((id) => (
                <button
                  key={id}
                  className="study-ai-menu-item"
                  role="menuitemradio"
                  aria-checked={id === current}
                  onClick={() => void pick(id)}
                >
                  <span className="study-ai-menu-check">
                    {id === current && <Icon icon="check" />}
                  </span>
                  {AI_PROVIDERS[id].name}
                </button>
              ))}
            </div>
          )}
        </div>
        {summaryExists && (
          <p className="study-ai-info">
            <Icon icon="info" />
            <span>
              <Trans>Paste the lecture content with Ctrl+V, we already copied it for you.</Trans>
            </span>
          </p>
        )}
      </div>
    </section>
  )
}
