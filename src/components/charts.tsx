// tiny hand-rolled SVG charts for the Data Analysis page. no chart library, the site doesn't have one and these
// four shapes are all it needs: histogram, scatter, lines, horizontal bars. every one has a hover tooltip
import { useEffect, useRef, useState, type ReactNode } from 'react'

// dark-mode chart colors (dataviz palette, checked against the panel color #171a21 with the validator)
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181']
export const BAR = '#3987e5'
const GRID = '#2c2c2a'
const AXIS = '#383835'
const INK = '#898781'
const PAD = { top: 24, right: 16, bottom: 34, left: 52 }

// charts are drawn at the container's real width so text stays 11px on a phone too
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, Math.floor(entry.contentRect.width))))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

interface Tip { x: number; y: number; body: ReactNode }
function Shell({ title, note, legend, height, children }: {
  title?: string; note?: ReactNode; legend?: { name: string; color: string }[]; height: number
  children: (width: number, setTip: (tip: Tip | null) => void) => ReactNode
}) {
  const [ref, width] = useWidth()
  const [tip, setTip] = useState<Tip | null>(null)
  return (
    <figure className="chart">
      {title && <figcaption>{title}</figcaption>}
      {legend && legend.length > 1 && (
        <div className="chart-legend">{legend.map((entry) => <span key={entry.name}><i style={{ background: entry.color }} />{entry.name}</span>)}</div>
      )}
      <div ref={ref} className="chart-body" onMouseLeave={() => setTip(null)}>
        <svg width={width} height={height} role="img" aria-label={title}>{children(width, setTip)}</svg>
        {tip && <div className="chart-tip" style={{ left: Math.min(tip.x + 12, width - 180), top: Math.max(0, tip.y - 10) }}>{tip.body}</div>}
      </div>
      {note && <p className="muted">{note}</p>}
    </figure>
  )
}

// nice round tick steps (1, 2, 5 x 10^n)
function ticks(min: number, max: number, count = 5) {
  const raw = (max - min) / count || 1
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((multiple) => multiple * power).find((candidate) => candidate >= raw)!
  const out: number[] = []
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) out.push(+value.toPrecision(12))
  return out
}
const logTicks = (min: number, max: number) => {
  const out: number[] = []
  for (let power = Math.floor(Math.log10(min)); power <= Math.ceil(Math.log10(max)); power++) out.push(10 ** power)
  return out.filter((value) => value >= min / 1.001 && value <= max * 1.001)
}

function Axes({ width, height, xTicks, yTicks, xScale, yScale, xFmt, yFmt, xLabel, yLabel }: {
  width: number; height: number; xTicks: number[]; yTicks: number[]; xScale: (v: number) => number; yScale: (v: number) => number
  xFmt: (v: number) => string; yFmt: (v: number) => string; xLabel?: string; yLabel?: string
}) {
  return (
    <g fontSize={11} fill={INK}>
      {yTicks.map((value) => (
        <g key={`y${value}`}>
          <line x1={PAD.left} x2={width - PAD.right} y1={yScale(value)} y2={yScale(value)} stroke={GRID} />
          <text x={PAD.left - 6} y={yScale(value) + 4} textAnchor="end">{yFmt(value)}</text>
        </g>
      ))}
      <line x1={PAD.left} x2={width - PAD.right} y1={height - PAD.bottom} y2={height - PAD.bottom} stroke={AXIS} />
      {xTicks.map((value) => <text key={`x${value}`} x={xScale(value)} y={height - PAD.bottom + 15} textAnchor="middle">{xFmt(value)}</text>)}
      {xLabel && <text x={(PAD.left + width - PAD.right) / 2} y={height - 3} textAnchor="middle">{xLabel}</text>}
      {yLabel && <text x={4} y={11} textAnchor="start">{yLabel}</text>}
    </g>
  )
}

// ---- histogram: counts per bin, bins are [start, end) ----
export function Histogram({ values, binSize, max, fmt, title, xLabel, height = 200, color = BAR }: {
  values: number[]; binSize: number; max: number; fmt: (v: number) => string; title?: string; xLabel?: string; height?: number; color?: string
}) {
  const binCount = Math.ceil(max / binSize)
  const counts = Array.from({ length: binCount }, () => 0)
  for (const value of values) counts[Math.min(binCount - 1, Math.max(0, Math.floor(value / binSize)))]++ // the last bin takes everything above
  const top = Math.max(1, ...counts)
  return (
    <Shell title={title} height={height}>
      {(width, setTip) => {
        const xScale = (value: number) => PAD.left + (value / max) * (width - PAD.left - PAD.right)
        const yScale = (value: number) => height - PAD.bottom - (value / top) * (height - PAD.top - PAD.bottom)
        const barWidth = xScale(binSize) - xScale(0)
        return (
          <>
            <Axes width={width} height={height} xTicks={ticks(0, max, 6)} yTicks={ticks(0, top, 4)} xScale={xScale} yScale={yScale} xFmt={fmt} yFmt={String} xLabel={xLabel} />
            {counts.map((count, index) => {
              const x = xScale(index * binSize) + 1 // 2px gap between bars
              const y = yScale(count)
              const range = index === binCount - 1 ? `${fmt(index * binSize)}+` : `${fmt(index * binSize)}–${fmt((index + 1) * binSize)}`
              return (
                <g key={index} onMouseMove={(event) => setTip({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY, body: <><b>{range}</b><br />{count} weapons</> })}>
                  <rect x={x} y={PAD.top} width={Math.max(1, barWidth - 2)} height={height - PAD.top - PAD.bottom} fill="transparent" />
                  {count > 0 && <path d={roundedTop(x, y, Math.max(1, barWidth - 2), height - PAD.bottom - y)} fill={color} />}
                </g>
              )
            })}
          </>
        )
      }}
    </Shell>
  )
}
// a bar with 2px rounded top corners, flat on the baseline
const roundedTop = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(2, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

// ---- scatter ----
export interface Point { x: number; y: number; label: string; extra?: string[] } // extra: more tooltip lines (Incarnon evolutions)
export function Scatter({ series, xFmt, yFmt, xMax, yMax, logY, title, xLabel, yLabel, note, height = 320 }: {
  series: { name: string; color: string; points: Point[] }[]; xFmt: (v: number) => string; yFmt: (v: number) => string
  xMax?: number; yMax?: number; logY?: boolean; title?: string; xLabel?: string; yLabel?: string; note?: ReactNode; height?: number
}) {
  const all = series.flatMap((one) => one.points)
  const xTop = xMax ?? Math.max(...all.map((point) => point.x))
  const yValues = all.map((point) => point.y).filter((value) => !logY || value > 0)
  const yLow = logY ? Math.min(...yValues) : 0
  const yTop = yMax ?? Math.max(...yValues)
  return (
    <Shell title={title} height={height} legend={series} note={note}>
      {(width, setTip) => {
        const xScale = (value: number) => PAD.left + (Math.min(value, xTop) / xTop) * (width - PAD.left - PAD.right)
        const span = logY ? Math.log10(yTop / yLow) : yTop
        const yScale = (value: number) => height - PAD.bottom - ((logY ? Math.log10(Math.max(value, yLow) / yLow) : Math.min(value, yTop)) / span) * (height - PAD.top - PAD.bottom)
        return (
          <>
            <Axes width={width} height={height} xTicks={ticks(0, xTop, 6)} yTicks={logY ? logTicks(yLow, yTop) : ticks(0, yTop, 5)} xScale={xScale} yScale={yScale}
              xFmt={xFmt} yFmt={yFmt} xLabel={xLabel} yLabel={yLabel} />
            {series.map((one) => one.points.map((point, index) => (
              <g key={`${one.name}${index}`} onMouseMove={(event) => setTip({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY,
                body: <><b>{point.label}</b><br />{xLabel}: {xFmt(point.x)}<br />{yLabel}: {yFmt(point.y)}{point.extra?.map((line) => <div key={line} className="tip-extra">{line}</div>)}</> })}>
                <circle cx={xScale(point.x)} cy={yScale(point.y)} r={8} fill="transparent" />
                {/* 2px panel-colored ring so overlapping dots stay separate */}
                <circle cx={xScale(point.x)} cy={yScale(point.y)} r={4} fill={one.color} fillOpacity={0.85} stroke="#171a21" strokeWidth={1.5} />
              </g>
            )))}
          </>
        )
      }}
    </Shell>
  )
}

// ---- lines over a shared x (numbers), crosshair + tooltip at the nearest x ----
export function Lines({ x, series, xFmt, yFmt, title, xLabel, yLabel, note, height = 260, yMin = 0, xTickLabels }: {
  x: number[]; series: { name: string; color: string; values: (number | null)[]; dashed?: boolean }[]; xFmt: (v: number) => string; yFmt: (v: number) => string
  title?: string; xLabel?: string; yLabel?: string; note?: ReactNode; height?: number; yMin?: number; xTickLabels?: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  const xLow = Math.min(...x)
  const xTop = Math.max(...x)
  const yTop = Math.max(...series.flatMap((one) => one.values.filter((value): value is number => value !== null)))
  return (
    <Shell title={title} height={height} legend={series} note={note}>
      {(width, setTip) => {
        const xScale = (value: number) => PAD.left + ((value - xLow) / (xTop - xLow || 1)) * (width - PAD.left - PAD.right)
        const yScale = (value: number) => height - PAD.bottom - ((value - yMin) / (yTop - yMin || 1)) * (height - PAD.top - PAD.bottom)
        const path = (values: (number | null)[]) => values.map((value, index) => (value === null ? '' : `${index === 0 || values[index - 1] === null ? 'M' : 'L'}${xScale(x[index]).toFixed(1)},${yScale(value).toFixed(1)}`)).join('')
        const onMove = (event: React.MouseEvent) => {
          const mouseX = event.nativeEvent.offsetX
          let nearest = 0
          x.forEach((value, index) => { if (Math.abs(xScale(value) - mouseX) < Math.abs(xScale(x[nearest]) - mouseX)) nearest = index })
          setHover(nearest)
          setTip({ x: xScale(x[nearest]), y: event.nativeEvent.offsetY, body: <><b>{xFmt(x[nearest])}</b>{series.map((one) => (
            <div key={one.name}><i className="swatch" style={{ background: one.color }} />{one.name}: {one.values[nearest] === null ? '–' : yFmt(one.values[nearest]!)}</div>))}</> })
        }
        return (
          <>
            <Axes width={width} height={height} xTicks={xTickLabels ? x : ticks(xLow, xTop, 6)} yTicks={ticks(yMin, yTop, 5)} xScale={xScale} yScale={yScale}
              xFmt={xFmt} yFmt={yFmt} xLabel={xLabel} yLabel={yLabel} />
            {hover !== null && <line x1={xScale(x[hover])} x2={xScale(x[hover])} y1={PAD.top} y2={height - PAD.bottom} stroke={AXIS} />}
            {series.map((one) => <path key={one.name} d={path(one.values)} fill="none" stroke={one.color} strokeWidth={2} strokeDasharray={one.dashed ? '5 4' : undefined} strokeLinejoin="round" />)}
            {hover !== null && series.map((one) => one.values[hover] !== null && (
              <circle key={one.name} cx={xScale(x[hover])} cy={yScale(one.values[hover]!)} r={4} fill={one.color} stroke="#171a21" strokeWidth={2} />))}
            <rect x={PAD.left} y={PAD.top} width={width - PAD.left - PAD.right} height={height - PAD.top - PAD.bottom} fill="transparent"
              onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
          </>
        )
      }}
    </Shell>
  )
}

// ---- horizontal bars, one row per label, value printed at the end ----
export function Bars({ rows, fmt, title, note, color = BAR, labelWidth = 160 }: {
  rows: { label: string; value: number; detail?: string }[]; fmt: (v: number) => string; title?: string; note?: ReactNode; color?: string; labelWidth?: number
}) {
  const rowHeight = 22
  const height = rows.length * rowHeight + 8
  const top = Math.max(...rows.map((row) => row.value), 1e-9)
  return (
    <Shell title={title} height={height} note={note}>
      {(width, setTip) => {
        const label = Math.min(labelWidth, width * 0.42)
        const barSpace = width - label - 64
        return rows.map((row, index) => {
          const y = 4 + index * rowHeight
          const barWidth = Math.max(2, (row.value / top) * barSpace)
          return (
            <g key={row.label} fontSize={11} onMouseMove={(event) => setTip({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY, body: <><b>{row.label}</b><br />{fmt(row.value)}{row.detail && <><br />{row.detail}</>}</> })}>
              <rect x={0} y={y} width={width} height={rowHeight} fill="transparent" />
              <text x={label - 8} y={y + 15} textAnchor="end" fill="#e6e8ec">{row.label.length > 26 ? `${row.label.slice(0, 25)}…` : row.label}</text>
              {/* rounded on the far end only, flat on the baseline */}
              <path d={`M${label},${y + 4}H${label + barWidth - 2}Q${label + barWidth},${y + 4} ${label + barWidth},${y + 6}V${y + 16}Q${label + barWidth},${y + 18} ${label + barWidth - 2},${y + 18}H${label}Z`} fill={color} />
              <text x={label + barWidth + 6} y={y + 15} fill={INK}>{fmt(row.value)}</text>
            </g>
          )
        })
      }}
    </Shell>
  )
}

export function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="tile"><span className="label">{label}</span><span className="value">{value}</span>{sub && <span className="label">{sub}</span>}</div>
}
