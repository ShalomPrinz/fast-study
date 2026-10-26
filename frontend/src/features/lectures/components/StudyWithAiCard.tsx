import { useEffect, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { openExternalUrl } from '@/services/open'
import { saveSettings } from '@/services/settings'
import { toast } from '@/services/toaster'
import { toastFailure } from '@/shared/utils/failure'
import { useAiProvider, useSettingsContext } from '@/shared/contexts/SettingsContext'
import Icon from '@/shared/components/Icon'
import Tooltip from '@/shared/components/Tooltip'
import { AI_PROVIDER_IDS, AI_PROVIDERS, type AiProvider } from '@/features/lectures/utils/aiChat'
import '@/styles/button.css'
import './StudyWithAiCard.css'

// What differs between the lecture page's card and the assignment page's: only its words.
export interface StudyWithAiCopy {
  subtitle: (provider: string) => string
  emptySubtitle: string
  // The disabled button's hint.
  hint: string
  info: string
  copied: string
  copyFailed: string
}

interface Props {
  // Whether there is anything to copy; the button waits otherwise.
  ready: boolean
  copy: StudyWithAiCopy
  // Builds the clipboard text; a rejection toasts as a service failure.
  collect: () => Promise<string>
}

// Copies the text `collect` builds, then opens the chosen AI chat for the user to paste into; the
// provider half picks that chat and saves it as the setting. See docs/LECTURES.md.
export default function StudyWithAiCard({ ready, copy, collect }: Props) {
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
      let text: string
      try {
        text = await collect()
      } catch (err) {
        toastFailure(err)
        return
      }
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        toast('error', copy.copyFailed)
        return
      }
      void openExternalUrl(AI_PROVIDERS[current].url)
      toast('success', copy.copied)
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
    <div className="study-ai-block">
      <section className="study-ai" data-state={ready ? 'ready' : 'no-summary'}>
        <div className="study-ai-tile">
          <Icon icon="sparkle" />
        </div>
        <h2 className="study-ai-title">
          <Trans>Study with AI</Trans>
        </h2>
        <p className="study-ai-subtitle">{ready ? copy.subtitle(provider) : copy.emptySubtitle}</p>
        <div className="study-ai-split" ref={menuRef}>
          <Tooltip content={ready ? undefined : copy.hint}>
            <button
              className="btn study-ai-open"
              disabled={!ready || busy}
              onClick={() => void openChat()}
            >
              <Trans>Open chat</Trans>
            </button>
          </Tooltip>
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
      </section>
      {ready && (
        <p className="study-ai-info">
          <Icon icon="info" />
          <span>{copy.info}</span>
        </p>
      )}
    </div>
  )
}
