import Tooltip from '@/shared/components/Tooltip'
import { useLingui } from '@lingui/react/macro'
import type { MaterialInfo, Kind } from '@/types'
import Icon from '@/shared/components/Icon'
import { toastFailure } from '@/shared/utils/failure'
import { setMaterialAttach } from '@/services/database'
import { canOpenWith, openLectureFile, openLectureFileWith } from '@/services/open'
import { useSupportedMaterials } from '@/shared/contexts/SupportedMaterialsContext'
import {
  displayName,
  materialAttached,
  materialSupported,
  materialTooLarge,
} from '@/features/lectures/utils/materials'
import OpenWithMenu from './OpenWithMenu'
import '@/styles/chip.css'
import './MaterialChip.css'

// The file's name as a button that opens it in the OS default app; an assignment file row reuses it.
export function MaterialNameButton({
  label,
  hint,
  onOpen,
}: {
  label: string
  hint: string
  onOpen: () => void
}) {
  return (
    <Tooltip content={hint}>
      <button className="material-chip-name" onClick={onOpen} dir="auto">
        {label}
      </button>
    </Tooltip>
  )
}

interface Props {
  course: string
  lecture: string
  kind: Kind
  material: MaterialInfo
  // A run is on this lecture: the attach switch and delete wait.
  inflight: boolean
  onDelete: (name: string) => void
}

// One lecture material: its original name (opens it), the "send to Gemini" switch, "Open with…" on
// Windows packaged, and delete. A material Summarize will not send reads muted.
export default function MaterialChip({
  course,
  lecture,
  kind,
  material,
  inflight,
  onDelete,
}: Props) {
  const { t } = useLingui()
  const supported = useSupportedMaterials()
  const name = displayName(material)
  const canSupport = supported !== null && materialSupported(material, supported)
  const attached = materialAttached(material, supported)
  const tooLarge = materialTooLarge(material, supported)

  async function toggle(next: boolean) {
    try {
      await setMaterialAttach(course, lecture, material.name, next, kind)
    } catch (e) {
      toastFailure(e)
    }
  }

  const switchHint =
    !canSupport && supported !== null
      ? t`Gemini can't read this file type`
      : attached
        ? t`Sent to Gemini with the summary`
        : t`Not sent to Gemini`

  return (
    <span
      className={`chip material-chip${attached ? '' : ' material-chip--muted'}${tooLarge ? ' material-chip--warn' : ''}`}
    >
      <Icon icon="file" />
      <MaterialNameButton
        label={name}
        hint={t`Open material`}
        onOpen={() => openLectureFile(course, lecture, material.name, kind)}
      />
      {tooLarge && (
        <Tooltip content={t`Over 10 MB — Summarize will fail while this is attached`}>
          <span
            className="material-chip-large"
            role="img"
            aria-label={t`Over 10 MB — Summarize will fail while this is attached`}
          >
            <Icon icon="warning" />
          </span>
        </Tooltip>
      )}
      <Tooltip content={switchHint}>
        <label className="material-switch">
          <input
            type="checkbox"
            role="switch"
            checked={attached}
            disabled={!canSupport || inflight}
            aria-label={t`Send ${name} to Gemini with the summary`}
            onChange={(e) => toggle(e.target.checked)}
          />
          <span className="material-switch-track" />
        </label>
      </Tooltip>
      {canOpenWith() && (
        <OpenWithMenu
          onOpenWith={() => openLectureFileWith(course, lecture, material.name, kind)}
        />
      )}
      <Tooltip content={t`Delete ${name}`}>
        <button
          className="material-chip-delete"
          aria-label={t`Delete ${name}`}
          onClick={() => onDelete(material.name)}
          disabled={inflight}
        >
          <Icon icon="trash" />
        </button>
      </Tooltip>
    </span>
  )
}
