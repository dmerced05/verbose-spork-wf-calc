// the Rivens tab: every stat's roll range for a weapon's riven type in each layout, why some stats suit the weapon, and a
// god-roll search that runs the optimizer with each candidate riven locked in (src/optimizer/rivenSearch.ts)
import { useEffect, useMemo, useRef, useState } from 'react'
import { weapons, weaponsById } from '../data'
import { RIVEN_DISPOSITION, fmt, isSpliced, rivenPool, rivenRange, rivenTypeFor, spliceRecipes, statName, type RivenConfig, type RivenStat } from '../calc/riven'
import { rivenHints } from '../calc/rivenHints'
import { profileLines } from '../calc/weaponProfile'
import { BOARDS } from '../optimizer/objectives'
import type { CompareScenario } from '../optimizer/compare'
import type { RivenCandidate, RivenSearchRequest, RivenSearchResult } from '../optimizer/rivenSearch'
import type { RivenMessage } from '../optimizer/rivenWorker'
import type { LeaderboardEntry } from '../optimizer/leaderboardTypes'
import { SearchSelect } from './SearchSelect'
import { Thumb } from './Thumb'

interface Props {
  calculatorScenario: CompareScenario | null
  onLoadBuild: (entry: LeaderboardEntry, riven: RivenConfig | null, keepScenario: boolean) => void
}

const LAYOUTS = [
  { id: '2p', label: '2 positives', positives: 2, negatives: 0 },
  { id: '2p1n', label: '2 positives + curse', positives: 2, negatives: 1 },
  { id: '3p', label: '3 positives', positives: 3, negatives: 0 },
  { id: '3p1n', label: '3 positives + curse', positives: 3, negatives: 1 },
] as const
type LayoutId = typeof LAYOUTS[number]['id']
// the goals worth searching a riven for (the heavy-only board is left out)
const GOALS = BOARDS.filter((spec) => !spec.heavyOnly)
const goalLabel = (key: string) => {
  const spec = BOARDS.find((candidate) => candidate.key === key)!
  return `${spec.objective.label}${spec.allowFireRateMods ? '' : ' (no fire rate mods)'}`
}

const rivenWeapons = weapons.filter((weapon) => rivenTypeFor(weapon))
const weaponOptions = rivenWeapons.map((weapon) => ({ id: weapon.uniqueName, label: weapon.name }))
const defaultWeaponId = rivenWeapons.find((weapon) => weapon.name === 'Phenmor')?.uniqueName ?? rivenWeapons[0].uniqueName
const gainText = (gain: number) => `${gain >= 0 ? '+' : ''}${Math.round(gain * 1000) / 10}%`
const scoreText = (value: number) => (value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1))
const unitOf = (text: string) => (text.startsWith('%') || text.includes('Damage to') ? '%' : text.startsWith('s') ? 's' : '')

export function RivenPage({ calculatorScenario, onLoadBuild }: Props) {
  const [weaponId, setWeaponId] = useState(defaultWeaponId)
  const [attackIndex, setAttackIndex] = useState(0)
  const [layout, setLayout] = useState<LayoutId>('3p1n')
  const [goal, setGoal] = useState('sustained')
  const [roll, setRoll] = useState<'max' | 'average'>('max')
  const [useCalculator, setUseCalculator] = useState(false)
  const [result, setResult] = useState<{ key: string; result: RivenSearchResult; request: RivenSearchRequest } | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const jobId = useRef(0)
  useEffect(() => () => workerRef.current?.terminate(), [])

  const weapon = weaponsById.get(weaponId)!
  const attack = weapon.attacks[attackIndex] ?? weapon.attacks[0]
  const type = rivenTypeFor(weapon)!
  const pool = rivenPool(type)
  const layoutSpec = LAYOUTS.find((option) => option.id === layout)!
  const hints = useMemo(() => rivenHints(weapon, attack, type), [weapon, attack, type])
  const lines = useMemo(() => profileLines(weapon, attack), [weapon, attack])
  const searchKey = `${weaponId}|${attackIndex}|${goal}|${roll}|${useCalculator}`
  const shown = result?.key === searchKey ? result : null

  // a riven with this layout's slot counts, so rivenRange weights it right
  const layoutStats: RivenStat[] = [
    ...Array.from({ length: layoutSpec.positives }, () => ({ tag: '', value: 0, negative: false })),
    ...Array.from({ length: layoutSpec.negatives }, () => ({ tag: '', value: 0, negative: true })),
  ]
  const range = (tag: string, negative: boolean) => rivenRange(type, RIVEN_DISPOSITION, layoutStats, { tag, negative })
  const rangeText = (tag: string, negative: boolean, unit: string) => {
    const values = range(tag, negative)
    if (!values) return '–'
    const [low, high] = negative ? [values[1], values[0]] : values // curses read mildest to worst
    return `${fmt(low)} to ${fmt(high)}${unit}`
  }
  const recipesFor = (tag: string) => spliceRecipes(type).filter(([made]) => made === tag)
    .map(([, a, b]) => `${statName(pool.find((def) => def.tag === a)!)} + ${statName(pool.find((def) => def.tag === b)!)}`).join(' or ')

  const pickWeapon = (id: string | null) => {
    if (!id) return
    setWeaponId(id)
    setAttackIndex(0)
  }

  const run = () => {
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../optimizer/rivenWorker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const id = ++jobId.current
    const request: RivenSearchRequest = { weaponId, attackIndex, board: goal, scenario: useCalculator ? calculatorScenario : null, roll }
    const key = searchKey
    setError(null)
    setProgress({ done: 0, total: 1, label: 'Starting' })
    worker.onmessage = (event: MessageEvent<RivenMessage>) => {
      const message = event.data
      if (message.id !== id) return
      if (message.type === 'progress') setProgress(message.progress)
      else if (message.type === 'done') {
        setResult({ key, result: message.result, request })
        setProgress(null)
        worker.terminate()
      } else {
        setError(message.message)
        setProgress(null)
        worker.terminate()
      }
    }
    worker.postMessage({ id, request })
  }

  const load = (candidate: RivenCandidate, request: RivenSearchRequest) => {
    const entry = candidate.entry
    onLoadBuild({
      ...entry,
      mods: entry.mods.map(([modId, name, rank, conditionalStacks]) => ({ id: modId, name, rank, conditionalStacks })),
      arcane: entry.arcane ? { id: entry.arcane[0], name: entry.arcane[1], rank: entry.arcane[2], conditionalStacks: entry.arcane[3] } : null,
    }, { stats: candidate.stats, polarity: 'madurai', drain: 18 }, Boolean(request.scenario))
  }

  const rolled = pool.filter((def) => !isSpliced(type, def.tag))
  const spliced = pool.filter((def) => isSpliced(type, def.tag))
  const topGain = Math.max(1e-9, ...(shown?.result.stats.map((stat) => stat.gain) ?? [0]))

  return (
    <div className="riven-page">
      <section className="panel">
        <div className="row spread">
          <h2>Rivens</h2>
          <div className="row">
            <Thumb imageName={weapon.imageName} wikiImage={weapon.wikiImage} alt={weapon.name} wide />
            <SearchSelect options={weaponOptions} selectedId={weaponId} onSelect={pickWeapon} placeholder="Search weapons" />
            {weapon.attacks.length > 1 && (
              <select value={attackIndex} onChange={(event) => setAttackIndex(Number(event.target.value))}>
                {weapon.attacks.map((option, index) => <option key={option.name} value={index}>{option.name}</option>)}
              </select>
            )}
          </div>
        </div>
        <p className="muted">
          {type} riven. Every weapon rolls with the same x{RIVEN_DISPOSITION} disposition since Hotfix 44.1.3. Values are at rank 8: base × {RIVEN_DISPOSITION} ×
          the layout's weight × a 90–110% roll (wiki Riven Mods).
        </p>
      </section>

      <div className="riven-grid">
        <section className="panel">
          <div className="row spread">
            <h3>Roll ranges</h3>
            <select value={layout} onChange={(event) => setLayout(event.target.value as LayoutId)}>
              {LAYOUTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </div>
          <p className="muted-inline">
            The more stats a riven has, the lower each one rolls: weights 0.99 / 1.2375 / 0.75 / 0.9375 for the four layouts. A curse makes the
            positives roll higher, which is why the usual god roll has one.
          </p>
          <table className="riven-range-table">
            <thead>
              <tr><th>Stat</th><th>Buff</th>{layoutSpec.negatives > 0 && <th>Curse</th>}</tr>
            </thead>
            <tbody>
              {rolled.map((def) => (
                <tr key={def.tag}>
                  <td>{statName(def)}</td>
                  <td className="buff">{rangeText(def.tag, false, unitOf(def.text))}</td>
                  {layoutSpec.negatives > 0 && <td className="curse">{rangeText(def.tag, true, unitOf(def.text))}</td>}
                </tr>
              ))}
              <tr className="section-row"><td colSpan={3}>Spliced (Riven Splicer, positive only, one per riven)</td></tr>
              {spliced.map((def) => (
                <tr key={def.tag} title={`From ${recipesFor(def.tag)}`}>
                  <td>{statName(def)} <span className="muted-inline">from {recipesFor(def.tag)}</span></td>
                  <td className="buff">{rangeText(def.tag, false, unitOf(def.text))}</td>
                  {layoutSpec.negatives > 0 && <td />}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="riven-side">
          <section className="panel">
            <h3>What suits {weapon.name}</h3>
            <ul className="hint-list">
              {hints.map((hint) => (
                <li key={hint.title} className={`tone-${hint.tone}`}><b>{hint.title}:</b> {hint.text}</li>
              ))}
            </ul>
            <h3>Base stats vs other {weapon.category === 'Melee' ? 'melee' : weapon.category.toLowerCase()} weapons</h3>
            <ul className="hint-list">
              {lines.map((line) => <li key={line.text} className={`tone-${line.tone}`}>{line.text}</li>)}
            </ul>
          </section>

          <section className="panel">
            <h3>God roll finder</h3>
            <p className="muted-inline">
              Tests each damage stat on a riven, then every 2- and 3-stat combination of the best ones, rebuilding the other 7 mods around
              each riven with the optimizer. Takes 5–15 s.
            </p>
            <div className="row">
              <label className="inline">
                Goal
                <select value={goal} onChange={(event) => setGoal(event.target.value)}>
                  {GOALS.map((spec) => <option key={spec.key} value={spec.key}>{goalLabel(spec.key)}</option>)}
                </select>
              </label>
              <label className="inline">
                Rolls
                <select value={roll} onChange={(event) => setRoll(event.target.value as 'max' | 'average')}>
                  <option value="max">Perfect (110%)</option>
                  <option value="average">Average (100%)</option>
                </select>
              </label>
              <label className="inline-check" title={calculatorScenario ? 'Use the calculator\'s target, debuffs and buffs' : 'Open the calculator first'}>
                <input type="checkbox" checked={useCalculator} disabled={!calculatorScenario} onChange={(event) => setUseCalculator(event.target.checked)} />
                Calculator's target
              </label>
              <button onClick={run} disabled={Boolean(progress)}>{shown ? 'Search again' : 'Find god rolls'}</button>
            </div>
            {progress && (
              <div className="riven-progress">
                <progress value={progress.done} max={progress.total} /> <span className="muted-inline">{progress.label}</span>
              </div>
            )}
            {error && <p className="warn-inline">{error}</p>}
            {!useCalculator && <p className="muted-inline">Leaderboard scenario: no faction, no armor, body shots, conditionals at max.</p>}
          </section>
        </div>
      </div>

      {shown && (
        <section className="panel">
          <h3>Results for {attack.name}, {goalLabel(goal)}</h3>
          <p className="muted">
            Without a riven the best build does <b>{scoreText(shown.result.baseline.score)}</b>. Gains below are on top of that, with the other 7 mods
            rebuilt around the riven. Positives are tested with a harmless curse ({shown.result.harmlessCurse}) since that rolls them higher.
          </p>
          <div className="riven-results">
            <div>
              <h4>Each stat alone</h4>
              <ul className="riven-stat-bars">
                {shown.result.stats.map((stat) => (
                  <li key={stat.tag} className={stat.gain <= 0.001 ? 'dim' : ''}>
                    <span className="label">{stat.name}{stat.spliced && <span className="muted-inline"> (spliced)</span>}</span>
                    <span className="advisor-meter"><span className="advisor-bar" style={{ width: `${Math.max(0, stat.gain / topGain) * 100}%` }} /></span>
                    <b>{gainText(stat.gain)}</b>
                  </li>
                ))}
              </ul>
              <p className="muted-inline">
                A stat can be negative here: the riven takes a slot, so a stat weaker than the mod it pushes out lowers the build.
              </p>
            </div>
            <div>
              <h4>Best 3 stats + curse</h4>
              <CandidateList candidates={shown.result.threeStat} pool={pool} onLoad={(candidate) => load(candidate, shown.request)} />
              <h4>Best 2 stats + curse</h4>
              <CandidateList candidates={shown.result.twoStat} pool={pool} onLoad={(candidate) => load(candidate, shown.request)} />
            </div>
            <div>
              <h4>Curses on the best one</h4>
              <CurseList curses={shown.result.curses} />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function CandidateList({ candidates, pool, onLoad }: { candidates: RivenCandidate[]; pool: ReturnType<typeof rivenPool>; onLoad: (candidate: RivenCandidate) => void }) {
  if (!candidates.length) return <p className="muted-inline">No stat helped enough to combine.</p>
  const name = (tag: string) => statName(pool.find((def) => def.tag === tag)!)
  return (
    <ol className="riven-candidates">
      {candidates.map((candidate) => {
        const positives = candidate.stats.filter((stat) => !stat.negative)
        return (
          <li key={positives.map((stat) => stat.tag).join('+')}>
            <div className="row spread">
              <span>{positives.map((stat) => `+${fmt(stat.value)}${unitOf(pool.find((def) => def.tag === stat.tag)!.text)} ${name(stat.tag)}`).join(' · ')}</span>
              <b>{gainText(candidate.gain)}</b>
            </div>
            <div className="muted-inline">{candidate.entry.mods.filter(([id]) => id !== 'riven').map(([, modName]) => modName).join(', ')}{candidate.entry.arcane ? ` · ${candidate.entry.arcane[1]}` : ''}</div>
            <button className="link-button" onClick={() => onLoad(candidate)}>Load in calculator</button>
          </li>
        )
      })}
    </ol>
  )
}

function CurseList({ curses }: { curses: RivenSearchResult['curses'] }) {
  if (!curses.length) return null
  const helps = curses.filter((curse) => curse.change > 0.001)
  const harmless = curses.filter((curse) => Math.abs(curse.change) <= 0.001)
  const hurts = curses.filter((curse) => curse.change < -0.001)
  return (
    <div className="curse-list">
      {helps.length > 0 && (
        <>
          <p className="tone-good"><b>Helps:</b></p>
          <ul>{helps.map((curse) => <li key={curse.tag}>{curse.name} <b>{gainText(curse.change)}</b></li>)}</ul>
        </>
      )}
      <p><b>Costs nothing:</b> {harmless.map((curse) => curse.name).join(', ') || 'none'}</p>
      <p className="tone-bad"><b>Hurts:</b></p>
      <ul>{hurts.slice().reverse().map((curse) => <li key={curse.tag}>{curse.name} <span className="muted-inline">{gainText(curse.change)}</span></li>)}</ul>
    </div>
  )
}
