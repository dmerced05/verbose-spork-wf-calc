// the damage simulator's floating box: takes the Calculator's build and target as they are, runs N seeded fights in a worker
// and shows how overguard / shields / health / armor go down, plus the kill time on good and bad luck. a native <dialog>
// opened with showModal(), so Esc closes it and focus stays inside without any extra code
import { useEffect, useMemo, useRef, useState } from 'react'
import { calculate, type CalcInput } from '../calc/damage'
import { EXIMUS_BASE_OVERGUARD, incarnonCycle, scaleOverguard, type FightSetup, type FightSummary } from '../calc/fight'
import type { FightMessage } from '../calc/fightWorker'
import type { ScaledEnemy } from './TargetPanel'
import { Histogram, KillRace, Lines, SERIES, Tile } from './charts'

// the site's damage-type colors (same as the .dmg-bg-* swatches)
const PROC_COLORS: Record<string, string> = {
  heat: '#ff8a4c', cold: '#7fd3ff', electricity: '#b28cff', toxin: '#7ee07e', blast: '#ffb347', corrosive: '#c8e06a', gas: '#9fd9a8',
  magnetic: '#6aa8ff', radiation: '#ffe066', viral: '#ff6fa8', impact: '#c9c9c9', puncture: '#e0d6a8', slash: '#ff7a7a', void: '#f3e7a0', tau: '#c8b6ff',
}
const procColor = (type: string) => PROC_COLORS[type] ?? '#c9c9c9'

interface Props {
  input: CalcInput // the Calculator's calcInput with its target
  enemy: ScaledEnemy | null
  onClose: () => void
}

const RUN_OPTIONS = [100, 300, 1000]
const CAP_OPTIONS = [30, 60, 120, 300, 600]
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const seconds = (value: number) => (Number.isFinite(value) ? `${value < 10 ? value.toFixed(2) : value.toFixed(1)} s` : 'no kill')

export function FightDialog({ input, enemy, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const jobRef = useRef(0)
  const [runs, setRuns] = useState(300)
  const [cap, setCap] = useState(60)
  const [aim, setAim] = useState<'body' | 'head' | 'share'>(input.target.headshot ? 'head' : 'body')
  const [headShare, setHeadShare] = useState(40)
  const [eximus, setEximus] = useState(() => /eximus/i.test(enemy?.enemy.name ?? ''))
  const [summary, setSummary] = useState<FightSummary | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ms, setMs] = useState(0)
  const boss = Boolean(input.target.attenuation || input.target.pool)
  // Incarnon forms only: switch to the normal form while the charges come back, instead of idling (experimental)
  const cycleOption = useMemo(() => incarnonCycle(input, calculate(input)), [input])
  const [cycle, setCycle] = useState(false)
  const cycleOn = Boolean(cycleOption && cycle)

  useEffect(() => {
    ref.current?.showModal()
    return () => { workerRef.current?.terminate() }
  }, [])

  const pools = enemy ? {
    overguard: eximus ? scaleOverguard(EXIMUS_BASE_OVERGUARD, enemy.effectiveLevel) : 0,
    shield: enemy.shield,
    health: enemy.health,
  } : null

  const run = () => {
    if (!pools) return
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../calc/fightWorker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const id = ++jobRef.current
    // the boss pool / attenuation belong to the boss board's estimate, the sim prices plain hits (bosses are experimental)
    const target = { ...input.target, pool: undefined, attenuation: undefined, exactTimeToKill: false }
    const setup: FightSetup = {
      input: { ...input, target }, pools, runs, seconds: cap,
      headshotShare: aim === 'body' ? 0 : aim === 'head' ? 1 : headShare / 100,
      cycle: cycleOn && cycleOption ? { ...cycleOption, normalInput: { ...cycleOption.normalInput, target } } : undefined,
    }
    setProgress(0)
    setError(null)
    worker.onmessage = (event: MessageEvent<FightMessage>) => {
      const message = event.data
      if (message.id !== id) return
      if (message.type === 'progress') setProgress(message.done / message.total)
      else if (message.type === 'done') { setSummary(message.summary); setMs(message.ms); setProgress(null); worker.terminate() }
      else { setError(message.message); setProgress(null); worker.terminate() }
    }
    worker.postMessage({ id, setup })
  }
  // first run as soon as it opens
  useEffect(() => { run() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // the charts stop a little past the slowest typical kill, so a 2 s kill isn't a sliver of a 60 s axis
  const shownUntil = summary ? Math.min(summary.seconds, Number.isFinite(summary.direct.ttk.p90) ? Math.max(0.5, summary.direct.ttk.p90 * 1.1) : summary.seconds) : 0
  const shown = summary ? summary.times.filter((time) => time <= shownUntil + 1e-9).length : 0
  const slice = (values: number[]) => values.slice(0, shown)
  const layers = summary ? ([
    ['Overguard', 'overguard', SERIES[3]], ['Shields', 'shield', SERIES[0]], ['Health', 'health', SERIES[1]],
  ] as const).filter(([, key]) => summary.pools[key] > 0) : []
  const finiteKills = summary ? summary.killTimes.filter(Number.isFinite) : []

  return (
    <dialog ref={ref} className="fight-dialog" onClose={onClose} aria-labelledby="fight-title">
      <div className="fight-head">
        <h2 id="fight-title">Damage simulator {boss && <span className="tag-experimental" title="Boss damage attenuation isn't modeled in the simulator">experimental</span>}</h2>
        <button className="link-button" onClick={() => ref.current?.close()} aria-label="Close damage simulator">Close</button>
      </div>
      {!enemy ? (
        <p className="muted">Pick an enemy in the Target drawer first: the simulator needs its health and shields.</p>
      ) : (
        <>
          <p className="muted">
            {input.weapon.name} ({input.attack.name}) vs {enemy.enemy.name} Lv {enemy.effectiveLevel}: {compact.format(enemy.health)} health
            {enemy.shield > 0 && `, ${compact.format(enemy.shield)} shields`}{pools!.overguard > 0 && `, ${compact.format(pools!.overguard)} overguard`}, {Math.round(enemy.armor)} armor.
          </p>
          <div className="fight-controls">
            <label>Runs
              <select value={runs} onChange={(event) => setRuns(Number(event.target.value))}>{RUN_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            </label>
            <label>Fight cap
              <select value={cap} onChange={(event) => setCap(Number(event.target.value))}>{CAP_OPTIONS.map((value) => <option key={value} value={value}>{value} s</option>)}</select>
            </label>
            <label>Aim
              <select value={aim} onChange={(event) => setAim(event.target.value as typeof aim)}>
                <option value="body">Body only</option><option value="head">Headshots only</option><option value="share">Headshot share</option>
              </select>
            </label>
            {aim === 'share' && (
              <label>Headshots
                <input type="number" min={0} max={100} step={5} value={headShare} onChange={(event) => setHeadShare(Math.min(100, Math.max(0, Number(event.target.value))))} /> %
              </label>
            )}
            <label className="check" title="All Eximus units have a base Overguard of 12, scaled by level">
              <input type="checkbox" checked={eximus} onChange={(event) => setEximus(event.target.checked)} /> Eximus (Overguard)
            </label>
            {cycleOption && (
              <label className="check" title={`Fire the Incarnon battery, drop back to ${cycleOption.normalInput.attack.name} with a full magazine, fire it while the charges come back (${cycleOption.fillSeconds.toFixed(1)} s), switch back in (${cycleOption.swapSeconds.toFixed(1)} s). The switch time is a guess: 2x the base reload`}>
                <input type="checkbox" checked={cycle} onChange={(event) => setCycle(event.target.checked)} /> Cycle with normal form <span className="tag-experimental">experimental</span>
              </label>
            )}
            <button onClick={run} disabled={progress !== null}>{progress !== null ? `Running… ${Math.round(progress * 100)}%` : 'Run'}</button>
          </div>
          {error && <p className="error">{error}</p>}
          {summary && (
            <>
              <div className="tiles">
                <Tile label="Time to kill (median)" value={seconds(summary.ttk.median)} sub={`10-90%: ${seconds(summary.ttk.p10)} – ${seconds(summary.ttk.p90)}`} />
                <Tile label="Kills" value={`${summary.kills} / ${summary.runs}`} sub={summary.kills < summary.runs ? `the rest were alive at ${summary.seconds} s` : 'every run'} />
                <Tile label="Shots to kill" value={summary.shotsToKill === null ? '–' : String(summary.shotsToKill)}
                  sub={summary.shotsToKill === null ? `${summary.reloads.filter((shade) => shade.kind === 'reload' || shade.kind === 'refill').length} reloads in ${summary.seconds} s` : summary.reloadsToKill ? `${summary.reloadsToKill} reload${summary.reloadsToKill === 1 ? '' : 's'}, ${summary.runsWithReload} runs reloaded` : 'no reload'} />
                <Tile label="Status damage" value={`${Math.round(summary.statusShare * 100)}% of damage`}
                  sub={`direct hits only: ${seconds(summary.direct.ttk.median)} (${seconds(summary.direct.ttk.p10)} – ${seconds(summary.direct.ttk.p90)})`} />
                <Tile label="Armor stripped to 0" value={summary.armorZeroAt === null ? 'never' : seconds(summary.armorZeroAt)}
                  sub={summary.armorZeroAt === null ? `lowest ${Math.round(summary.minArmor)} of ${Math.round(summary.pools.armor)}` : `in ${summary.runsArmorZero} of ${summary.runs} runs`} />
              </div>
              {shown > 1 && (
                <KillRace
                  title={`Direct hits vs status damage (median run: ${Math.round(summary.race.statusShare * 100)}% of its damage from status)`}
                  x={slice(summary.times)} withStatus={slice(summary.race.withStatus)} directOnly={slice(summary.race.directOnly)}
                  killAt={summary.race.killAt} directKillAt={summary.race.directKillAt} procs={summary.race.procs} procColor={procColor} shades={summary.reloads}
                  xFmt={(value) => seconds(value)} yFmt={(value) => compact.format(value)}
                  note="Enemy HP left (overguard + shields + health). The dashed line is the same run with DoT ticks dealing nothing; the procs still land, so strips and Viral still help the hits. The shaded gap is the status damage."
                />
              )}
              {layers.length > 0 && shown > 1 && (
                <Lines
                  title="Enemy over time (median run, 10-90% band)"
                  x={slice(summary.times)}
                  series={layers.map(([name, key, color]) => ({
                    name, color, values: slice(summary.curves[key].median),
                    band: { low: slice(summary.curves[key].p10), high: slice(summary.curves[key].p90) },
                  }))}
                  xFmt={(value) => `${value.toFixed(1)} s`} yFmt={(value) => compact.format(value)} xLabel="seconds" shades={summary.reloads}
                />
              )}
              {summary.pools.armor > 0 && shown > 1 && (
                <Lines
                  title="Armor over time" height={160}
                  x={slice(summary.times)}
                  series={[{ name: 'Armor', color: SERIES[2], values: slice(summary.curves.armor.median), band: { low: slice(summary.curves.armor.p10), high: slice(summary.curves.armor.p90) } }]}
                  xFmt={(value) => `${value.toFixed(1)} s`} yFmt={(value) => String(Math.round(value))} xLabel="seconds" shades={summary.reloads}
                />
              )}
              {finiteKills.length > 1 && (
                <Histogram title="Kill time, every run" unit="runs" values={finiteKills} max={Math.max(...finiteKills) * 1.05 || 1}
                  binSize={(Math.max(...finiteKills) * 1.05 || 1) / 20} fmt={(value) => `${value.toFixed(value < 10 ? 1 : 0)} s`} xLabel="seconds" />
              )}
              <p className="muted fight-notes">
                {summary.runs} runs, seed 12345 + run, {summary.states} enemy states priced, {Math.round(ms)} ms.
                Procs count from the next shot on; Heat strips 15/30/40/50% over 2 s; Condition Overload counts what's actually on the enemy.
                Overguard ignores crowd control, caps Cold at 4 stacks, takes Toxin and scales with level only (Steel Path just adds levels).
                {boss && ' Boss damage attenuation is not applied here.'}
                {cycleOn && cycleOption && ` Cycle mode (experimental): the form fires its battery, the gun drops back to ${cycleOption.normalInput.attack.name} reloaded (no switch), which fires while the charges come back (every normal shot assumed to hit a weak point, like the refill estimate), then it switches back in. Switching in is a guess: 2x the base reload (${cycleOption.swapSeconds.toFixed(1)} s). Not used by the leaderboard.`}
              </p>
            </>
          )}
        </>
      )}
    </dialog>
  )
}
