import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useLingui } from '@lingui/react/macro'
import Icon from '@/shared/components/Icon'
import Tooltip from '@/shared/components/Tooltip'
import './SettingsSearchBar.css'

interface Props {
  query: string
  onQuery: (query: string) => void
  current: number
  count: number
  onStep: (direction: 1 | -1) => void
}

// The pinned find box of `/settings`: counter, previous/next, and Ctrl/Cmd+F while it is mounted.
export default function SettingsSearchBar({ query, onQuery, current, count, onStep }: Props) {
  const { t } = useLingui()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyF') {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      onStep(e.shiftKey ? -1 : 1)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      onStep(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Escape') {
      if (query) onQuery('')
      else input.current?.blur()
    }
  }

  const searched = query.trim().length > 0
  const none = searched && count === 0
  const previous = t`Previous match`
  const next = t`Next match`

  return (
    <div
      className="settings-search"
      data-settings-search={none ? 'none' : searched ? 'found' : 'idle'}
    >
      <div className="settings-search-field">
        <span className="settings-search-icon">
          <Icon icon="search" />
        </span>
        <input
          ref={input}
          className="settings-search-input"
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t`Search settings`}
          aria-label={t`Search settings`}
          dir="auto"
          spellCheck={false}
        />
      </div>
      {searched && (
        <span className="settings-search-count" aria-live="polite">
          {none ? t`No matches` : <bdi dir="ltr">{t`${current + 1} / ${count}`}</bdi>}
        </span>
      )}
      <Tooltip content={previous}>
        <button
          className="settings-search-step settings-search-step--up"
          disabled={count === 0}
          onClick={() => onStep(-1)}
          aria-label={previous}
        >
          <Icon icon="chevron-down" />
        </button>
      </Tooltip>
      <Tooltip content={next}>
        <button
          className="settings-search-step"
          disabled={count === 0}
          onClick={() => onStep(1)}
          aria-label={next}
        >
          <Icon icon="chevron-down" />
        </button>
      </Tooltip>
    </div>
  )
}
