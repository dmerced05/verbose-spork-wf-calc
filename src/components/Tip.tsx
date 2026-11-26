// a hover/tap explanation that shows right away. the browser's title tooltip waits ~1s (or never shows), so the ⓘ tags
// looked like they did nothing. rendered on <body> so other panels (their own stacking layers) can't cover or clip it.
// the bubble stays open while the mouse is on it, so a long one can be read (and scrolled)
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const GAP = 6
const CLOSE_DELAY = 150 // ms to get from the tag onto the bubble

export function Tip({ text, className, children, wide, label }: {
  text: ReactNode; className?: string; children: ReactNode; wide?: boolean; label?: string
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const closer = useRef<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const maxWidth = wide ? 560 : 340

  const shownAt = useRef(0)
  const show = () => {
    window.clearTimeout(closer.current)
    if (!open) shownAt.current = Date.now()
    setOpen(true)
  }
  const hide = () => {
    window.clearTimeout(closer.current)
    closer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY)
  }
  useEffect(() => () => window.clearTimeout(closer.current), [])
  // hover is for mice only: a tap fires enter and click together, which would open and shut it in one go
  const hoverIn = (event: PointerEvent) => event.pointerType !== 'touch' && show()
  const hoverOut = (event: PointerEvent) => event.pointerType !== 'touch' && hide()
  // the bubble is fixed on screen, so close it when the page moves under it or the tab changes (scrolling inside it is fine)
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (event.type === 'scroll' && bubble.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    // a tap or click anywhere else closes it (on a phone a long bubble can cover its own ⓘ)
    const outside = (event: globalThis.PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node) && !bubble.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('hashchange', close)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('hashchange', close)
    }
  }, [open])

  // under the tag, flipped above if it would run off the bottom, kept inside the window sideways
  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return
    const tag = anchor.current.getBoundingClientRect()
    const height = bubble.current.offsetHeight
    const width = Math.min(maxWidth, window.innerWidth - 2 * GAP)
    const left = Math.max(GAP, Math.min(tag.left, window.innerWidth - width - GAP))
    const below = tag.bottom + GAP
    const fitsBelow = below + height <= window.innerHeight - GAP
    const above = tag.top - GAP - height
    // neither side fits (a long one on a phone): pin it to the bottom of the screen, it scrolls inside
    const top = fitsBelow ? below : above > GAP ? above : Math.max(GAP, window.innerHeight - height - GAP)
    setPos({ left, top })
  }, [open, maxWidth])

  return (
    <span
      ref={anchor}
      className={`tip-anchor ${className ?? ''}`}
      tabIndex={0}
      aria-label={label ?? (typeof text === 'string' ? text : undefined)}
      onPointerEnter={hoverIn}
      onPointerLeave={hoverOut}
      onFocus={show}
      onBlur={hide}
      onClick={(event) => {
        // tap to toggle on touch screens, and don't let it click whatever it sits in (perk buttons, table rows, summaries)
        event.stopPropagation()
        event.preventDefault()
        // a tap focuses it first (which opens it), so a click right after an open doesn't count as closing it
        if (Date.now() - shownAt.current > 400) setOpen((current) => !current)
        else show()
      }}
    >
      {children}
      {open && createPortal(
        <div ref={bubble} className={`tip-bubble${typeof text === 'string' ? '' : ' rich'}`} role="tooltip"
          style={{ left: pos.left, top: pos.top, maxWidth }} onPointerEnter={hoverIn} onPointerLeave={hoverOut} onClick={() => setOpen(false)}>
          {text}
        </div>,
        document.body,
      )}
    </span>
  )
}

// the ⓘ that long explanations fold into. children is the explanation (text, lists, whatever)
export function Info({ children, label = 'More info', wide = true }: { children: ReactNode; label?: string; wide?: boolean }) {
  return <Tip className="info" text={children} wide={wide} label={label}>ⓘ</Tip>
}
