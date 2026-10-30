// the strip across the top of the calculator: the numbers you check after every change, pinned while you scroll, and
// drawers under it (target, debuffs, enemy details, the full results) that start closed and remember what you left open
import { useState, type ReactNode } from 'react'
import { SUSTAINED_FIGHT_SECONDS, type CalcResult } from '../calc/damage'
import type { KillEstimate } from '../calc/kill'
import { factionLabel } from '../calc/constants'
import type { ScaledEnemy } from './TargetPanel'

export interface Drawer {
  id: string
  label: string
  summary: string // shown on the button while it's closed
  group: 'setup' | 'output' // setup (target, debuffs) and output (kill details, results) open as two stacks side by side
  content: ReactNode
}

interface Props {
  result: CalcResult
  enemy: ScaledEnemy | null
  bodyKill: KillEstimate | null
  headKill: KillEstimate | null
  canHeadshot: boolean
  drawers: Drawer[]
}

const DRAWERS_KEY = 'wf-calc-open-drawers'
const loadOpen = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(DRAWERS_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

const whole = (value: number) => (Number.isFinite(value) ? Math.round(value).toLocaleString() : '∞')
const short = (value: number) => {
  if (!Number.isFinite(value)) return '∞'
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}K`
  return abs >= 100 ? whole(value) : value.toFixed(1)
}
const seconds = (value: number) => (!Number.isFinite(value) ? 'never' : value < 10 ? `${value.toFixed(2)}s` : `${Math.round(value).toLocaleString()}s`)
const percent = (value: number) => `${Math.round(value * 1000) / 10}%`

function Stat({ label, value, sub, title, main }: { label: string; value: string; sub?: string; title?: string; main?: boolean }) {
  return (
    <div className={`bar-stat ${main ? 'main' : ''}`} title={title}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  )
}

// open drawers: when both kinds are open, setup stacks in one column and output in the other so nothing leaves a gap
// next to a tall Full results. one kind alone just sits side by side
function OpenDrawers({ drawers }: { drawers: Drawer[] }) {
  if (!drawers.length) return null
  const setup = drawers.filter((drawer) => drawer.group === 'setup')
  const output = drawers.filter((drawer) => drawer.group === 'output')
  const box = (drawer: Drawer) => <div key={drawer.id} className="drawer">{drawer.content}</div>
  if (!setup.length || !output.length) return <div className="drawers">{drawers.map(box)}</div>
  return (
    <div className="drawers split">
      <div className="drawer-stack">{setup.map(box)}</div>
      <div className="drawer-stack">{output.map(box)}</div>
    </div>
  )
}

export function ResultsBar({ result, enemy, bodyKill, headKill, canHeadshot, drawers }: Props) {
  const [open, setOpen] = useState<string[]>(loadOpen)
  const toggle = (id: string) => {
    const next = open.includes(id) ? open.filter((other) => other !== id) : [...open, id]
    setOpen(next)
    try {
      localStorage.setItem(DRAWERS_KEY, JSON.stringify(next))
    } catch {
      // private window: drawers just won't be remembered
    }
  }
  const crit = result.critChance
  return (
    <>
      <section className="results-bar">
        <div className="bar-stats">
          <Stat main label="Sustained DPS" value={short(result.sustainedDps)} title={`Average DPS over a ${SUSTAINED_FIGHT_SECONDS} s fight: reloads, status ticks as they land, Heat stacking`} />
          <Stat label="Burst DPS" value={short(result.totalDps)} title="Direct + DoT while firing nonstop (no reload)" />
          <Stat label="First 10 s" value={short(result.damageInWindow(10))} title="Damage dealt in the first 10 seconds, reloads included" />
          <Stat label="Avg hit" value={short(result.hit.average)} sub={`crit ${short(result.hit.crit)}`} title="One projectile / swing, crits averaged in (the sub line is a top-tier crit)" />
          <Stat label="Crit" value={percent(crit)} sub={`${result.critMultiplier.toFixed(2)}x`} title="Crit chance after mods, and the crit multiplier" />
          <Stat label="Status" value={percent(result.statusChance)} title="Status chance per pellet after mods" />
          {enemy && bodyKill && (
            <>
              <div className="bar-divider" />
              <div className="bar-enemy" title={`${enemy.enemy.name}, ${factionLabel(enemy.enemy.faction)}`}>
                <span className="label">vs</span>
                <span className="value accent">{enemy.enemy.name}</span>
                <span className="sub">Lv {enemy.effectiveLevel} · {short(enemy.health)} HP{enemy.shield > 0 ? ` · ${short(enemy.shield)} shields` : ''} · {whole(enemy.armor)} armor</span>
              </div>
              <Stat label="Shots to kill" value={whole(bodyKill.shotsToKill)} sub={canHeadshot && headKill ? `head ${whole(headKill.shotsToKill)}` : undefined} />
              <Stat label="Time to kill" value={seconds(bodyKill.sustainedTimeToKill)} sub={canHeadshot && headKill ? `head ${seconds(headKill.sustainedTimeToKill)}` : undefined} title="With DoTs, reloads and Heat stacking played out" />
            </>
          )}
        </div>
        <div className="bar-drawers">
          {drawers.map((drawer) => (
            <button key={drawer.id} className={`drawer-tab ${open.includes(drawer.id) ? 'open' : ''}`} onClick={() => toggle(drawer.id)} aria-expanded={open.includes(drawer.id)}>
              <span className="drawer-caret">{open.includes(drawer.id) ? '▾' : '▸'}</span> {drawer.label}
              <span className="drawer-summary">{drawer.summary}</span>
            </button>
          ))}
        </div>
      </section>
      <OpenDrawers drawers={drawers.filter((drawer) => open.includes(drawer.id))} />
    </>
  )
}
