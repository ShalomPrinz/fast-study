import {
  cloneElement,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
  type SyntheticEvent,
  type ReactNode,
  type Ref,
} from 'react'
import {
  FloatingArrow,
  FloatingPortal,
  arrow,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
} from '@floating-ui/react'
import {
  clampedSelectPoint,
  hasTooltipContent,
  physicalPlacement,
  type TooltipPlacement,
} from '@/shared/utils/tooltip'
import './Tooltip.css'

const OPEN_DELAY_MS = 400
// Closes a drag-select must not trigger: the pointer drifting out mid-drag, or the anchor losing focus.
const SELECTING_IGNORES = new Set(['hover', 'safe-polygon', 'focus'])
// The hint is portaled but React bubbles its events up the component tree, so a press in it would
// reach the anchor's handlers (a tooltip inside a toggle button would toggle it).
const stop = (event: SyntheticEvent) => event.stopPropagation()
const ISOLATED_EVENTS = {
  onClick: stop,
  onDoubleClick: stop,
  onContextMenu: stop,
  onMouseDown: stop,
  onMouseUp: stop,
  onPointerUp: stop,
}

// Page text unselectable for a drag keeps the native selection from painting over it. Counted across
// hints, since two touches overlap their drags and only the last release may restore the saved value.
let rootSelectHolds = 0
let rootSelectSaved = ''
function holdRootSelect() {
  const root = document.documentElement.style
  if (rootSelectHolds++ === 0) {
    rootSelectSaved = root.userSelect
    root.userSelect = 'none'
  }
  let held = true
  return () => {
    if (!held) return
    held = false
    if (--rootSelectHolds === 0) root.userSelect = rootSelectSaved
  }
}

// The app's hover hint, in place of `title`: opens on hover or focus, and stays open while the pointer
// moves into it so its text can be selected. The child must take a ref.
export default function Tooltip({
  content,
  placement = 'top',
  children,
}: {
  content: ReactNode
  placement?: TooltipPlacement
  children: ReactElement
}) {
  const [open, setOpen] = useState(false)
  // Ends the drag-select in progress, if any: clears its document listeners.
  const endSelectRef = useRef<(() => void) | null>(null)
  const arrowRef = useRef<SVGSVGElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const enabled = hasTooltipContent(content)
  const { refs, floatingStyles, context } = useFloating({
    open: open && enabled,
    onOpenChange: (next, _event, reason) => {
      if (!next && endSelectRef.current && reason && SELECTING_IGNORES.has(reason)) return
      setOpen(next)
    },
    // Fixed, so a hint near the window's bottom edge never grows the root's scroll height.
    strategy: 'fixed',
    placement: physicalPlacement(placement, document.documentElement.dir === 'rtl'),
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      arrow({ element: arrowRef, padding: 6 }),
    ],
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, {
      enabled,
      delay: { open: OPEN_DELAY_MS, close: 0 },
      move: false,
      handleClose: safePolygon(),
    }),
    useFocus(context, { enabled }),
    // Closing on any ancestor scroll keeps a hint from riding its anchor over the sticky header.
    useDismiss(context, { enabled, ancestorScroll: true }),
    useRole(context, { enabled, role: 'tooltip' }),
  ])
  const childRef = (children as ReactElement & { ref?: Ref<Element> }).ref
  const ref = useMergeRefs([refs.setReference, childRef])

  // A hint that empties while open must not reappear without a fresh hover; adjusting state during
  // render, and cloning the child without a wrapper, keeps the control mounted as the hint toggles.
  if (!enabled && open) setOpen(false)

  useEffect(() => () => endSelectRef.current?.(), [])

  // Outside press, Escape or scroll still dismiss a hint its selection keeps open. A native drag of
  // already-selected text ends in pointercancel, not pointerup.
  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return
    endSelectRef.current?.()
    let pointer = { x: event.clientX, y: event.clientY }
    const releaseRootSelect = holdRootSelect()
    function end() {
      releaseRootSelect()
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onCancel, true)
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('selectionchange', contain)
      endSelectRef.current = null
    }
    function onMove(move: globalThis.PointerEvent) {
      pointer = { x: move.clientX, y: move.clientY }
      contain()
    }
    // With the page unselectable, the native drag stalls or collapses once outside the hint; extend the
    // selection to the hint's edge instead, as a text field's own selection does.
    function contain() {
      const box = contentRef.current
      const sel = window.getSelection()
      if (!box || !sel?.anchorNode || !box.contains(sel.anchorNode)) return
      const point = clampedSelectPoint(box.getBoundingClientRect(), pointer.x, pointer.y)
      if (!point) return
      let node: Node = box
      let offset = point === 'end' ? box.childNodes.length : 0
      if (typeof point === 'object') {
        const caret = document.caretRangeFromPoint?.(point.x, point.y)
        if (!caret || !box.contains(caret.startContainer)) return
        node = caret.startContainer
        offset = caret.startOffset
      }
      if (sel.focusNode === node && sel.focusOffset === offset) return
      sel.setBaseAndExtent(sel.anchorNode, sel.anchorOffset, node, offset)
    }
    // Only the press that started the drag ends it; another finger's release is not this drag's.
    function onCancel(cancel: globalThis.PointerEvent) {
      if (cancel.pointerId === event.pointerId) end()
    }
    function onUp(up: globalThis.PointerEvent) {
      if (up.pointerId !== event.pointerId) return
      end()
      const within = (el: Element | null, node: Node | null) => !!el && !!node && el.contains(node)
      const floating = refs.floating.current
      const target = up.target as Node | null
      if (
        !within(floating, target) &&
        !within(refs.domReference.current, target) &&
        !within(floating, window.getSelection()?.anchorNode ?? null)
      )
        setOpen(false)
    }
    // Capture phase: the hint stops React's pointerup at its portal root, which a bubble listener never sees.
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onCancel, true)
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('selectionchange', contain)
    endSelectRef.current = end
  }

  return (
    <>
      {cloneElement(children, getReferenceProps({ ref, ...(children.props as object) }))}
      {open && enabled && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className="tooltip"
            style={floatingStyles}
            {...getFloatingProps({
              ...ISOLATED_EVENTS,
              onPointerDown: (event) => {
                event.stopPropagation()
                onPointerDown(event)
              },
            })}
          >
            <div ref={contentRef} className="tooltip-content" dir="auto">
              {content}
            </div>
            <FloatingArrow
              ref={arrowRef}
              context={context}
              className="tooltip-arrow"
              strokeWidth={1}
              stroke="currentColor"
            />
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
