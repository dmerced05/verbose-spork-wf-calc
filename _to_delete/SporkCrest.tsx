// the site's logo: a gold line-drawn spork standing in a diamond. it's an inline SVG, so it scales cleanly and
// picks up the text color through currentColor
const SPORK_PATH =
  'M9 26 L10 6 L13 6 L14 20 L16 20 L17 4 L23 4 L24 20 L26 20 L27 6 L30 6 L31 26 C31 42 26 52 22 56 L22 114 Q20 118 18 114 L18 56 C14 52 9 42 9 26 Z'

// size = the diamond's width in px, everything else scales off it
export function SporkCrest({ size }: { size: number }) {
  const sporkHeight = size * 1.1
  return (
    <span className="spork-crest" aria-hidden="true" style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 120" width={sporkHeight / 3} height={sporkHeight}>
        <path d={SPORK_PATH} fill="none" stroke="currentColor" strokeWidth={size > 40 ? 1.6 : 3} strokeLinejoin="round" />
      </svg>
    </span>
  )
}
