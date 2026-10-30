// a hover/tap explanation that shows right away. the browser's title tooltip waits ~1s (or never shows), so the ⓘ tags
// looked like they did nothing. rendered on <body> so other panels (their own stacking layers) can't cover or clip it
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const WIDTH = 340
const GAP = 6

export function Tip({ text, className, children }: { text: string; className?: string; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  // under the tag, flipped above if it would run off the bottom, kept inside the window sideways
  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return
    const tag = anchor.current.getBoundingClientRect()
    const height = bubble.current.offsetHeight
    const width = Math.min(WIDTH, window.innerWidth - 2 * GAP)
    const left = Math.max(GAP, Math.min(tag.left, window.innerWidth - width - GAP))
    const below = tag.bottom + GAP
    const top = below + height > window.innerHeight && tag.top - GAP - height > 0 ? tag.top - GAP - height : below
    setPos({ left, top })
  }, [open])

  return (
    <span
      ref={anchor}
      className={`tip-anchor ${className ?? ''}`}
      tabIndex={0}
      aria-label={text}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={(event) => {
        // tap to toggle on touch screens, and don't let it click whatever it sits in (perk buttons)
        event.stopPropagation()
        setOpen((current) => !current)
      }}
    >
      {children}
      {open && createPortal(
        <span ref={bubble} className="tip-bubble" role="tooltip" style={{ left: pos.left, top: pos.top, maxWidth: WIDTH }}>
          {text}
        </span>,
        document.body,
      )}
    </span>
  )
}
