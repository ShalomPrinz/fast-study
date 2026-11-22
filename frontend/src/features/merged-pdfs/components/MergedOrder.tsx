import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import type { MergedPart } from '@/types'
import { partKey } from '../utils/mergedSelection'
import './MergedOrder.css'

// Press-and-hold arms a drag after this long; a move past TOLERANCE_PX before it is a scroll or a click-drift, not a drag.
const HOLD_MS = 200
const TOLERANCE_PX = 5
const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement]
const DROP_ANIMATION = { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }

function RowBody({
  part,
  index,
  showKind,
}: {
  part: MergedPart
  index: number
  showKind: boolean
}) {
  return (
    <>
      <span className="merged-order-grip" aria-hidden="true">
        ⋮⋮
      </span>
      <span className="merged-order-index">{index + 1}</span>
      <span className="merged-order-name" dir="auto">
        {part.name}
      </span>
      {showKind && part.kind === 'recitation' && (
        <span className="chip chip--neutral">
          <Trans>Recitation</Trans>
        </span>
      )}
    </>
  )
}

// True from pointer-down until the hold arms the drag, the pointer lifts or it drifts past the tolerance.
function useArming() {
  const [armed, setArmed] = useState(false)
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  function arm(e: ReactPointerEvent) {
    if (e.button !== 0) return
    stop.current?.()
    const { clientX, clientY } = e
    const end = () => {
      setArmed(false)
      document.removeEventListener('pointerup', end)
      document.removeEventListener('pointercancel', end)
      document.removeEventListener('pointermove', move)
      stop.current = null
    }
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - clientX, ev.clientY - clientY) > TOLERANCE_PX) end()
    }
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', end)
    document.addEventListener('pointermove', move)
    stop.current = end
    setArmed(true)
  }
  return { armed, arm }
}

function SortableRow({
  id,
  part,
  index,
  showKind,
}: {
  id: string
  part: MergedPart
  index: number
  showKind: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const { armed, arm } = useArming()
  const state = isDragging ? ' merged-order-row--dragging' : armed ? ' merged-order-row--armed' : ''
  return (
    <li
      ref={setNodeRef}
      className="merged-order-item"
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div
        className={`merged-order-row${state}`}
        data-part={id}
        {...attributes}
        {...listeners}
        onPointerDown={(e) => {
          listeners?.onPointerDown?.(e)
          arm(e)
        }}
      >
        <RowBody part={part} index={index} showKind={showKind} />
      </div>
    </li>
  )
}

interface Props {
  order: MergedPart[]
  onMove: (from: number, to: number) => void
  showKind: boolean
}

// The ticked parts as a drag-and-drop sortable list; the whole row is the handle.
export default function MergedOrder({ order, onMove, showKind }: Props) {
  const { t } = useLingui()
  const [activeId, setActiveId] = useState<string | null>(null)
  const keys = order.map(partKey)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: HOLD_MS, tolerance: TOLERANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const nameOf = (id: unknown) => order[keys.indexOf(String(id))]?.name ?? ''
  const positionOf = (id: unknown) => keys.indexOf(String(id)) + 1
  const total = order.length
  // The last slot announced, so the over event a pick-up fires at once does not talk over "Picked up".
  const lastOver = useRef<string | null>(null)
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      lastOver.current = String(active.id)
      const name = nameOf(active.id)
      const position = positionOf(active.id)
      return t`Picked up ${name}. Position ${position} of ${total}.`
    },
    onDragOver: ({ active, over }) => {
      if (String(over?.id ?? active.id) === lastOver.current) return undefined
      lastOver.current = String(over?.id ?? active.id)
      const name = nameOf(active.id)
      const position = positionOf(over?.id ?? active.id)
      return t`${name} moved to position ${position} of ${total}.`
    },
    onDragEnd: ({ active, over }) => {
      const name = nameOf(active.id)
      const position = positionOf(over?.id ?? active.id)
      return t`${name} dropped at position ${position} of ${total}.`
    },
    onDragCancel: ({ active }) => {
      const name = nameOf(active.id)
      const position = positionOf(active.id)
      return t`Reordering cancelled. ${name} is back at position ${position} of ${total}.`
    },
  }

  function onDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id))
  }
  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null)
    if (over) onMove(keys.indexOf(String(active.id)), keys.indexOf(String(over.id)))
  }

  const active = activeId ? keys.indexOf(activeId) : -1
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={MODIFIERS}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: t`To pick up a part, press Space. Use the arrow keys to move it, Space to drop it, or Escape to cancel.`,
        },
      }}
    >
      <SortableContext items={keys} strategy={verticalListSortingStrategy}>
        <ul className="merged-order-list">
          {order.map((part, i) => (
            <SortableRow key={keys[i]} id={keys[i]} part={part} index={i} showKind={showKind} />
          ))}
        </ul>
      </SortableContext>
      <DragOverlay dropAnimation={DROP_ANIMATION}>
        {active >= 0 ? (
          <div className="merged-order-row merged-order-row--overlay">
            <RowBody part={order[active]} index={active} showKind={showKind} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
