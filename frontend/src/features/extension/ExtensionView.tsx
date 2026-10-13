import { useState, type ReactNode } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Link } from 'react-router-dom'
import PageHeader from '@/shared/components/PageHeader'
import { runtimeBridge } from '@/services/runtime'
import { toast } from '@/services/toaster'
import { ROUTES } from '@/shared/utils/routes'
import '@/styles/panel.css'
import '@/styles/button.css'
import './ExtensionView.css'

// Chrome's own extensions page; the bridge's `open.external` refuses it, so the user pastes it.
export const EXTENSIONS_URL = 'chrome://extensions'

// Every PNG dropped into `assets/extension-guide/` is picked up by name; a step whose file is
// missing renders a placeholder of the same box, so adding the screenshots changes no code.
const SHOTS = import.meta.glob<string>('../../assets/extension-guide/*.png', {
  eager: true,
  import: 'default',
})

function shotUrl(name: string): string | undefined {
  return SHOTS[`../../assets/extension-guide/${name}.png`]
}

// Copies `text` and confirms in place for a moment; a refused clipboard asks for a manual copy.
function CopyButton({ text, label }: { text: string; label: ReactNode }) {
  const { t } = useLingui()
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      toast('error', t`Could not copy. Select the text and copy it by hand.`)
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button className="btn btn--ghost extension-copy" onClick={() => void copy()}>
      {copied ? t`Copied!` : label}
    </button>
  )
}

// The extension folder with Copy and Open folder, or a note where there is no desktop bridge.
function FolderBlock() {
  const extension = runtimeBridge()?.extension
  if (!extension) {
    return (
      <p className="extension-note extension-note--no-bridge">
        <Trans>The folder path and its buttons are available in the FastStudy desktop app.</Trans>
      </p>
    )
  }
  return (
    <div className="extension-folder">
      <code className="extension-path" dir="ltr">
        {extension.path}
      </code>
      <div className="extension-actions">
        <CopyButton text={extension.path} label={<Trans>Copy path</Trans>} />
        <button className="btn btn--ghost extension-reveal" onClick={() => void extension.reveal()}>
          <Trans>Open folder</Trans>
        </button>
      </div>
    </div>
  )
}

interface Step {
  shot: string
  title: ReactNode
  body: ReactNode
}

function steps(): Step[] {
  return [
    {
      shot: '1-open-extensions',
      title: <Trans>Open Chrome's extensions page</Trans>,
      body: (
        <>
          <p>
            <Trans>
              Open Google Chrome, paste this address into the address bar at the top and press
              Enter:
            </Trans>
          </p>
          <div className="extension-folder">
            <code className="extension-path" dir="ltr">
              {EXTENSIONS_URL}
            </code>
            <div className="extension-actions">
              <CopyButton text={EXTENSIONS_URL} label={<Trans>Copy address</Trans>} />
            </div>
          </div>
        </>
      ),
    },
    {
      shot: '2-developer-mode',
      title: <Trans>Turn on Developer mode</Trans>,
      body: (
        <p>
          <Trans>
            At the top of the page, turn on the "Developer mode" switch. A row of new buttons
            appears.
          </Trans>
        </p>
      ),
    },
    {
      shot: '3-load-unpacked',
      title: <Trans>Load the FastStudy folder</Trans>,
      body: (
        <>
          <p>
            <Trans>
              Click "Load unpacked". In the window that opens, paste the folder path below into the
              address bar at the top, press Enter, then click "Select Folder".
            </Trans>
          </p>
          <FolderBlock />
        </>
      ),
    },
    {
      shot: '4-pin',
      title: <Trans>Pin FastStudy to the toolbar</Trans>,
      body: (
        <p>
          <Trans>
            Click the puzzle-piece icon next to the address bar, then click the pin beside
            FastStudy. Its icon now stays in the toolbar.
          </Trans>
        </p>
      ),
    },
    {
      shot: '5-use',
      title: <Trans>Download a lecture</Trans>,
      body: (
        <p>
          <Trans>
            Open a lecture on the course site and press play. Click the FastStudy icon, choose the
            course and the lecture, then click "Download". The download shows on the{' '}
            <Link to={ROUTES.downloads}>Downloads</Link> page.
          </Trans>
        </p>
      ),
    },
  ]
}

// The screenshot for a step, or a same-sized blank box until the file lands.
function Shot({ name, step }: { name: string; step: number }) {
  const { t } = useLingui()
  const url = shotUrl(name)
  if (!url) return <div className="extension-shot extension-shot--placeholder" aria-hidden="true" />
  return (
    <img className="extension-shot" src={url} alt={t`Screenshot of step ${step}`} loading="lazy" />
  )
}

// A one-time walkthrough for loading the shipped Chrome extension unpacked — see docs/EXTENSION.md.
export default function ExtensionView() {
  const { t } = useLingui()
  return (
    <main className="main-view main-view--page extension-page">
      <PageHeader
        title={t`Chrome extension`}
        meta={<Trans>A one-time setup of about three minutes.</Trans>}
      />
      <div className="page-body">
        <div className="page-column">
          <ol className="extension-steps">
            {steps().map((s, i) => (
              <li key={s.shot} className="extension-step">
                <span className="extension-step-num" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="extension-step-body">
                  <h2 className="extension-step-title">{s.title}</h2>
                  {s.body}
                  <Shot name={s.shot} step={i + 1} />
                </div>
              </li>
            ))}
          </ol>
          <aside className="extension-notes">
            <p>
              <Trans>
                Updates arrive with the app: when FastStudy updates, the extension updates itself,
                so you set it up only once.
              </Trans>
            </p>
            <p>
              <Trans>
                If Chrome shows FastStudy with an error, open{' '}
                <code dir="ltr">{EXTENSIONS_URL}</code> and click the reload arrow on the FastStudy
                card.
              </Trans>
            </p>
          </aside>
        </div>
      </div>
    </main>
  )
}
