// rough line-art takes on the in-game polarity glyphs, not exact copies
const GLYPHS: Record<string, string> = {
  madurai: 'M3 3 L8 13 L13 3',
  vazarin: 'M5 3 V13 M5 3 Q13 3 13 8 Q13 13 5 13',
  naramon: 'M3 8 H13',
  zenurik: 'M3 4 H13 L3 12 H13',
  unairu: 'M5 13 V3 H11 L7 8 L12 13',
  penjaga: 'M3 3 L8 8 L13 3 M8 8 V13',
  umbra: 'M4 3 V8 Q8 15 12 8 V3',
  universal: 'M8 3 A5 5 0 1 0 8.01 3',
}

export function PolarityIcon({ polarity, size = 14 }: { polarity: string | null; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label={polarity ?? 'no polarity'} className="polarity-icon">
      {polarity && GLYPHS[polarity] ? (
        <path d={GLYPHS[polarity]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <circle cx="8" cy="8" r="1.5" fill="currentColor" opacity="0.4" />
      )}
    </svg>
  )
}
