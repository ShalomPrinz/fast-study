import { cloneElement, useRef, useState, type ReactElement, type ReactNode, type Ref } from 'react'
import {
  FloatingArrow,
  FloatingPortal,
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
} from '@floating-ui/react'
import { hasTooltipContent, physicalPlacement, type TooltipPlacement } from '@/shared/utils/tooltip'
import './Tooltip.css'

const OPEN_DELAY_MS = 400

// The app's hover hint, in place of a DOM `title`: opens on hover after a beat and on keyboard focus,
// closes at once. The child must take a ref (a DOM element or a ref-forwarding component).
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
  const arrowRef = useRef<SVGSVGElement>(null)
  const enabled = hasTooltipContent(content)
  const { refs, floatingStyles, context } = useFloating({
    open: open && enabled,
    onOpenChange: setOpen,
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
    useHover(context, { enabled, delay: { open: OPEN_DELAY_MS, close: 0 }, move: false }),
    useFocus(context, { enabled }),
    useDismiss(context, { enabled }),
    useRole(context, { enabled, role: 'tooltip' }),
  ])
  const childRef = (children as ReactElement & { ref?: Ref<Element> }).ref
  const ref = useMergeRefs([refs.setReference, childRef])

  // A hint that empties while open must not reappear without a fresh hover; adjusting state during
  // render, and always cloning the child, keeps the control mounted as the hint comes and goes.
  if (!enabled && open) setOpen(false)

  return (
    <>
      {cloneElement(children, getReferenceProps({ ref, ...(children.props as object) }))}
      {open && enabled && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className="tooltip"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <div className="tooltip-content" dir="auto">
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
