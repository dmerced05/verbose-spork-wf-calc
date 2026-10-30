// fourth tab: can this weapon break the damage limit, and what does it take? a ladder of investment layers, each
// optimized for the biggest single instance against the calculator's target, Warframe and debuffs
import { useEffect, useMemo, useRef, useState } from 'react'
import { enemiesById, modsById, weapons, weaponsById } from '../data'
import { INT_LIMIT, onScreen } from '../calc/damageCap'
import { RIVEN_MOD_ID, type RivenConfig } from '../calc/riven'
import { abilitiesById } from '../data/warframeAbilities'
import { heavyComboFor, type HeavyMode } from '../data/heavyAttacks'
import { CAP_STEPS, CAP_TARGET, type CapPath, type CapRequest, type CapSetup, type CapStepResult } from '../optimizer/damageCap'
import type { CapMessage } from '../optimizer/capWorker'
import type { CompareScenario } from '../optimizer/compare'
import type { LeaderboardEntry } from '../optimizer/leaderboardTypes'
import { SearchSelect } from './SearchSelect'
import type { BuildToLoad } from '../Calculator'
import { maxComboFor } from '../calc/constants'
import { STEEL_PATH_LEVEL_BONUS } from '../calc/target'
import { resolveArmor } from './TargetPanel'

interface Props {
  calculatorScenario: CompareScenario | null
  calculatorRiven: { weaponId: string; config: RivenConfig } | null
  onLoadBuild: (entry: LeaderboardEntry, riven: RivenConfig | null, setup: NonNullable<BuildToLoad['setup']>) => void
}

const weaponOptions = weapons.map((weapon) => ({ id: weapon.uniqueName, label: weapon.name }))
const whole = (value: number) => Math.round(value).toLocaleString()
const times = (value: number) => (value >= 100 ? `×${Math.round(value).toLocaleString()}` : `×${value.toFixed(value >= 10 ? 1 : 2)}`)

export function DamageCap({ calculatorScenario, calculatorRiven, onLoadBuild }: Props) {
  const [weaponId, setWeaponId] = useState(weaponsById.get(calculatorRiven?.weaponId ?? '')?.uniqueName ?? weapons.find((weapon) => weapon.name === 'Kuva Bramma')!.uniqueName)
  const [attackIndex, setAttackIndex] = useState(0)
  const [heavyMode, setHeavyMode] = useState<HeavyMode>('biggestHit')
  const [cap, setCap] = useState(INT_LIMIT)
  const [useRiven, setUseRiven] = useState(true)
  const [thorough, setThorough] = useState(false)
  const [frameMode, setFrameMode] = useState<CapRequest['frameMode']>('search')
  const [allyStrength, setAllyStrength] = useState(300)
  const [allyCount, setAllyCount] = useState(3)
  const [meleeHeadshots, setMeleeHeadshots] = useState(false)
  const [paths, setPaths] = useState<CapPath[]>([])
  const [selectedPath, setSelectedPath] = useState(0)
  const [defaultPath, setDefaultPath] = useState(0)
  const [results, setResults] = useState<CapStepResult[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ranWith, setRanWith] = useState<CapRequest | null>(null)
  const [openStep, setOpenStep] = useState<number | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const jobId = useRef(0)
  useEffect(() => () => workerRef.current?.terminate(), [])

  const weapon = weaponsById.get(weaponId)!
  const attack = weapon.attacks[attackIndex] ?? weapon.attacks[0]
  const rivenForWeapon = calculatorRiven?.weaponId === weaponId && calculatorRiven.config.stats.length ? calculatorRiven.config : null
  // the calculator's Warframe panel and buffs, but always against the cap target (Steel Path Heavy Gunner, level 9,999)
  const scenario = useMemo(
    () => (calculatorScenario ? { ...calculatorScenario, target: CAP_TARGET, armor: resolveArmor(CAP_TARGET) } : null),
    [calculatorScenario],
  )

  // what the later steps will use, so it's clear where the numbers come from
  const summary = useMemo(() => {
    if (!scenario) return null
    const { target, buffs } = scenario
    const enemy = target.enemyId ? enemiesById.get(target.enemyId)?.name : null
    const casts = (buffs.warframe?.casts ?? []).map((cast) => `${abilitiesById.get(cast.id)?.name ?? cast.id}${cast.by === 'ally' ? ' (ally)' : cast.by === 'helminth' ? ' (subsumed)' : ''}`)
    return {
      target: `${enemy ?? target.faction} · level ${target.level + (target.steelPath ? STEEL_PATH_LEVEL_BONUS : 0)}${target.steelPath ? ' Steel Path' : ''} · ${whole(scenario.armor)} armor${target.layer !== 'health' ? ` · vs ${target.layer}` : ''}`,
      frame: buffs.warframe ? `${buffs.warframe.frameName}, ${Math.round(buffs.warframe.abilityStrength * 100)}% strength${casts.length ? `: ${casts.join(', ')}` : ', no abilities on'}` : 'no Warframe set',
      combo: weapon.category === 'Melee' ? 'max combo' : null,
    }
  }, [scenario, weapon])

  const pickWeapon = (id: string | null) => {
    if (!id) return
    setWeaponId(id)
    setAttackIndex(0)
    setResults([])
    setRanWith(null)
  }

  const run = () => {
    if (!scenario) return
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../optimizer/capWorker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const id = ++jobId.current
    const request: CapRequest = {
      weaponId, attackIndex, heavyMode, scenario, riven: useRiven ? rivenForWeapon : null, thorough,
      frameMode, allyStrength: allyStrength / 100, allyCount, meleeHeadshots,
    }
    const collected: CapStepResult[] = []
    setResults([])
    setError(null)
    setRanWith(request)
    setRunning(true)
    setOpenStep(null)
    setPaths([])
    setSelectedPath(0)
    worker.onmessage = (event: MessageEvent<CapMessage>) => {
      const message = event.data
      if (message.id !== id) return
      if (message.type === 'step') {
        collected.push(message.result)
        setResults([...collected])
      } else if (message.type === 'paths') {
        setPaths(message.paths)
        setSelectedPath(message.defaultPath)
        setDefaultPath(message.defaultPath)
      } else {
        if (message.type === 'error') setError(message.message)
        setRunning(false)
        worker.terminate()
      }
    }
    worker.postMessage({ id, request })
  }

  // the shared first two steps plus the selected path's Warframe steps
  const stepResult = (stepIndex: number) =>
    results.find((result) => result.stepIndex === stepIndex && (result.pathIndex === null || result.pathIndex === selectedPath))
  const shown = CAP_STEPS.map((_, index) => stepResult(index)).filter((result): result is CapStepResult => Boolean(result))
  const firstCapping = shown.find((result) => result.peakHit > cap)
  const last = shown.length === CAP_STEPS.length ? shown.at(-1) : undefined
  // the last step you can reach without a team
  const soloStep = shown.find((result) => CAP_STEPS[result.stepIndex].id === 'frame')
  const currentPath = paths.find((path) => path.index === selectedPath)
  const ranMelee = ranWith ? weaponsById.get(ranWith.weaponId)!.category === 'Melee' : false
  const loadStep = (result: CapStepResult) => {
    const { entry } = result
    onLoadBuild({
      ...entry,
      mods: entry.mods.map(([modId, name, rank, conditionalStacks]) => ({ id: modId, name, rank, conditionalStacks })),
      arcane: entry.arcane ? { id: entry.arcane[0], name: entry.arcane[1], rank: entry.arcane[2], conditionalStacks: entry.arcane[3] } : null,
    }, ranWith?.riven ?? null, {
      // the step's own setup: what it was scored with, and the Warframe from step 3 (off before that)
      headshot: result.headshot,
      debuffs: result.debuffs,
      combo: maxComboFor(weaponsById.get(ranWith!.weaponId)!.name),
      target: CAP_TARGET,
      frame: ['mods', 'head', 'priming'].includes(CAP_STEPS[result.stepIndex].id) ? 'clear' : (result.setup?.load ?? 'keep'),
    })
  }

  return (
    <div className="compare">
      <section className="panel">
        <h2>Damage cap</h2>
        <p className="muted">
          How far one hit gets toward the 32-bit damage limit as investment stacks up. Each step is optimized for the biggest single
          instance (top crit tier, or a Devouring Attrition non-crit; a beam's merged tick). Damage past the limit isn't capped, but anything
          over it shows on screen as -2,147,483,648, and the game log writes the real value under a "number too large" error, so both are shown.
        </p>
        <div className="row compare-controls">
          <SearchSelect options={weaponOptions} selectedId={weaponId} onSelect={pickWeapon} placeholder="Search weapons" />
          {weapon.attacks.length > 1 && (
            <select value={attackIndex} onChange={(event) => { setAttackIndex(Number(event.target.value)); setResults([]); setRanWith(null) }}>
              {weapon.attacks.map((option, index) => <option key={option.name} value={index}>{option.name}</option>)}
            </select>
          )}
          {attack.heavy && attack.heavyMultiplier && heavyComboFor(weapon.name) && (
            <select value={heavyMode} onChange={(event) => setHeavyMode(event.target.value as HeavyMode)}>
              <option value="biggestHit">Biggest hit of the heavy</option>
              <option value="fullCombo">Whole heavy as one number</option>
            </select>
          )}
          <label>
            Limit
            <input type="number" className="cap-input" value={cap} onChange={(event) => setCap(Math.max(1, Number(event.target.value) || INT_LIMIT))} />
          </label>
          {rivenForWeapon && (
            <label className="inline-check"><input type="checkbox" checked={useRiven} onChange={(event) => setUseRiven(event.target.checked)} /> Use the calculator's riven</label>
          )}
          <label className="inline-check"><input type="checkbox" checked={thorough} onChange={(event) => setThorough(event.target.checked)} /> Thorough search</label>
          {weapon.category === 'Melee' && (
            <label className="inline-check" title="Most melee weapons can't land headshots reliably, so the headshot step is off for melee unless this is on">
              <input type="checkbox" checked={meleeHeadshots} onChange={(event) => setMeleeHeadshots(event.target.checked)} /> Count melee headshots
            </label>
          )}
        </div>
        <div className="row compare-controls">
          <select value={frameMode} onChange={(event) => setFrameMode(event.target.value as CapRequest['frameMode'])}>
            <option value="search">Warframe steps: find the best setup</option>
            <option value="panel" disabled={!scenario?.buffs.warframe}>Warframe steps: use my Warframe panel</option>
          </select>
          {frameMode === 'search' && (
            <>
              <label>Allies' Strength <input type="number" className="stack-input" value={allyStrength} onChange={(event) => setAllyStrength(Math.max(0, Number(event.target.value)))} />%</label>
              <label>
                Allies
                <select value={allyCount} onChange={(event) => setAllyCount(Number(event.target.value))}>
                  {[0, 1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
        {summary && (
          <ul className="cap-summary muted">
            <li><b>Target</b> {summary.target}{summary.combo ? ` · ${summary.combo}` : ''}</li>
            <li>
              <b>Warframe steps</b>{' '}
              {frameMode === 'search'
                ? `first the best pair of Warframe arcanes and 5 Tauforged Archon Shards any Warframe gets without casting anything, then every Warframe's own abilities and augments + one Helminth subsume (in a slot it can replace) with real frame mods and the shards and arcanes re-picked for it, then up to ${allyCount} allies' abilities. Exalted weapons stay on their own frame. Melee skips Empowered Quiver (Dashwire), exalted guns keep it`
                : summary.frame}
            </li>
            <li><b>Solo priming</b> only the statuses the build applies, plus a Diriga primer: Impact, Puncture, Slash and Arc Coil Electricity, and with Manifold Bond 3 modded elements other than Electricity (7 statuses; Hounds and Nautilus prime as much or one less). Its damage isn't counted. It stays on (re-picked for each build) through the arcane, shard and Warframe steps, so everything up to Your Warframe is reachable alone</li>
            <li><b>Debuffs step</b> maxed: every status type on the target, 10 Viral / Corrosive / Cold, full Heat strip, 5 Puncture, 10 Tau</li>
            <li>Target is fixed: a Steel Path Heavy Gunner at level 9,999 (Grineer, armor at the 2,700 clamp). The Warframe panel still comes from the Calculator tab. Conditionals (kill stacks, Galvanized, Deadhead...) are taken at max, ability conditions as met.</li>
          </ul>
        )}
        <div className="row spread">
          <span className="muted-inline">
            {attack.isAoE ? 'AoE attack: no headshots, so the headshot step adds nothing.' : weapon.category === 'Melee' && !meleeHeadshots ? 'Melee: the headshot step is off (most melee can\'t reliably headshot).' : ''}
          </span>
          <button className="primary" disabled={!scenario || running} onClick={run}>{running ? 'Running…' : 'Run the ladder'}</button>
        </div>
        {error && <p className="riven-issues">{error}</p>}
      </section>

      {ranWith && (
        <section className="panel">
          <h2>
            {weaponsById.get(ranWith.weaponId)!.name} <span className="muted-inline">{(weaponsById.get(ranWith.weaponId)!.attacks[ranWith.attackIndex] ?? weapon.attacks[0]).name}</span>
          </h2>
          {paths.length > 1 && (
            <div className="cap-paths">
              <div className="label">Warframe paths <span className="muted-inline">(pick one to see its steps)</span></div>
              {[...paths].sort((a, b) => b.finalPeak - a.finalPeak).map((path) => (
                <label key={path.index} className={`cap-path ${path.index === selectedPath ? 'selected' : ''}`}>
                  <input type="radio" name="cap-path" checked={path.index === selectedPath} onChange={() => { setSelectedPath(path.index); setOpenStep(null) }} />
                  <span className="cap-path-label">
                    {path.label}
                    {path.index === defaultPath && <span className="chip lock-chip">{ranMelee && !path.situational.length ? 'recommended for melee' : 'best'}</span>}
                    {path.situational.length > 0 && <span className="chip situational-chip" title={path.situational.join('\n')}>⚠ situational</span>}
                  </span>
                  <span className={path.finalPeak > cap ? 'over-cap-text' : 'muted-inline'}>{whole(path.finalPeak)} ({path.finalPeak > cap ? `${times(path.finalPeak / cap)} over` : `${times(cap / path.finalPeak)} short`})</span>
                </label>
              ))}
            </div>
          )}
          {currentPath && currentPath.situational.length > 0 && (
            <p className="warn-inline cap-situational">⚠ Situational: {currentPath.situational.join(' · ')}</p>
          )}
          {last && !running && (
            <p className={`cap-verdict ${firstCapping ? 'capped' : ''}`}>
              {firstCapping
                ? <>Passes the limit at <b>{CAP_STEPS[firstCapping.stepIndex].label.replace(/^\+ /, '')}</b>: {whole(firstCapping.peakHit)} ({times(firstCapping.peakHit / cap)} the limit).</>
                : <>Tops out at <b>{whole(last.peakHit)}</b> with everything set: {times(cap / last.peakHit)} short of the limit.</>}
              {soloStep && <> Solo (through {CAP_STEPS[soloStep.stepIndex].label.replace(/^\+ /, '')}): <b>{whole(soloStep.peakHit)}</b>{soloStep.peakHit > cap ? ', past the limit' : `, ${times(cap / soloStep.peakHit)} short`}.</>}
            </p>
          )}
          <div className="table-scroll">
            <table className="compare-table cap-table">
              <thead>
                <tr><th>Step</th><th>Biggest hit (real)</th><th>On screen</th><th>Toward the limit</th><th>Step gain</th><th>Biggest DoT tick</th><th>Setup</th></tr>
              </thead>
              <tbody>
                {CAP_STEPS.map((step, index) => {
                  const result = stepResult(index)
                  if (!result) return <tr key={step.id}><td>{step.label}</td><td colSpan={6} className="muted-inline">{running ? 'searching…' : ''}</td></tr>
                  const previous = stepResult(index - 1)
                  const share = result.peakHit / cap
                  const shown = onScreen(result.peakHit)
                  return (
                    <tr key={step.id} className={`${result.peakHit > cap ? 'over-cap' : ''} ${openStep === index ? 'selected' : ''}`} onClick={() => setOpenStep(openStep === index ? null : index)}>
                      <td title={step.description}>
                        {step.label}
                        {step.id === 'head' && !result.headshot && <div className="muted-inline">{ranMelee ? 'off for melee' : 'AoE: no headshots'}</div>}
                      </td>
                      <td><b>{whole(result.peakHit)}</b></td>
                      <td className={shown < 0 ? 'negative-number' : ''}>{shown.toLocaleString()}</td>
                      <td>
                        <div className="cap-bar"><span style={{ width: `${Math.min(100, Math.max(share * 100, 0.5))}%` }} /></div>
                        <span className="muted-inline">{share >= 1 ? `${times(share)} over` : `${(share * 100).toPrecision(2)}% · ${times(1 / share)} to go`}</span>
                      </td>
                      <td className="muted-inline">{previous ? times(result.peakHit / previous.peakHit) : ''}</td>
                      <td className="muted-inline">{result.peakDotTick ? `${whole(result.peakDotTick.value)} ${result.peakDotTick.damageType}` : '—'}</td>
                      <td className="cap-setup">{result.setup ? <SetupText setup={result.setup} step={CAP_STEPS[index].id} /> : <span className="muted-inline">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted">Click a step to see its build. Each step is searched again from scratch, so builds can change between steps (debuffs can make a different element better).</p>
          {openStep !== null && stepResult(openStep) && (() => {
            const result = stepResult(openStep)!
            const { entry } = result
            return (
              <div className="panel build-detail">
                <div className="row spread">
                  <b>{CAP_STEPS[openStep].label}</b>
                  <button onClick={() => loadStep(result)}>Load in calculator</button>
                </div>
                <ol className="build-mods">
                  {entry.mods.map(([modId, name, rank]) => (
                    <li key={modId}>{modId === RIVEN_MOD_ID ? <span className="riven-title">{name}</span> : name}{rank !== (modsById.get(modId)?.fusionLimit ?? rank) ? ` (rank ${rank})` : ''}</li>
                  ))}
                </ol>
                <div className="row">
                  {entry.arcane && <span className="chip">{entry.arcane[1]}</span>}
                  {entry.perks.map((perk) => <span key={perk.name} className="chip perk-chip">{perk.tier}: {perk.name}</span>)}
                </div>
                {result.setup?.mods && (
                  <p className="muted">
                    <b>Frame mods</b> ({Math.round((result.setup.strength ?? 1) * 100)}% Strength, {result.setup.energy} Energy{result.setup.load ? `, ${result.setup.load.frame}` : ''}): {result.setup.mods.join(', ')}
                  </p>
                )}
                <p className="muted">
                  Crit {Math.round(entry.stats.critChance * 100)}% ×{entry.stats.critMultiplier.toFixed(2)} (top tier {Math.ceil(entry.stats.critChance)}) ·
                  Status {Math.round(entry.stats.statusChance * 100)}% · Average hit {whole(entry.stats.singleHit)}
                </p>
              </div>
            )
          })()}
        </section>
      )}
    </div>
  )
}

// only what the step added: the frame and its abilities, the arcanes, or the allies
function SetupText({ setup, step }: { setup: CapSetup; step: string }) {
  if (step === 'debuffs') return <span className="muted-inline">same Warframe setup</span>
  if (step === 'shards') {
    if (!setup.shards?.length) return <span className="muted-inline">none</span>
    return <span>{setup.shards.join(', ')}{setup.energy !== undefined ? <span className="muted-inline"> · {setup.energy} Energy, {Math.round((setup.strength ?? 1) * 100)}% Strength</span> : ''}</span>
  }
  if (step === 'priming') {
    const priming = setup.priming
    if (!priming) return <span className="muted-inline">—</span>
    const extra = priming.types.filter((type) => !priming.own.includes(type))
    return (
      <span>
        {priming.own.length ? <>Build: {priming.own.join(', ')}</> : 'Build: no statuses'}
        {extra.length ? <> · <b>{priming.companion}</b>: {extra.join(', ')}</> : <span className="muted-inline"> · no companion needed</span>}
      </span>
    )
  }
  if (step === 'frameArcanes') return <span>{setup.arcanes.length ? setup.arcanes.join(' + ') : 'none helped'}</span>
  if (step === 'allies') {
    return <span>{setup.allies.length ? setup.allies.map((ally) => `${ally.frame}: ${ally.abilities.join(', ')}`).join(' · ') : 'none helped'}</span>
  }
  return (
    <span>
      <b>{setup.frame}</b>{' '}
      {setup.casts.length
        ? setup.casts.map((cast) => (cast.by === 'helminth' ? `${cast.name} (Helminth${cast.replaces ? `, replaces ${cast.replaces}` : ''})` : cast.name)).join(', ')
        : 'nothing helped'}
      {setup.strength !== undefined && <span className="muted-inline"> · {Math.round(setup.strength * 100)}% Strength from mods</span>}
      {(setup.shards?.length || setup.arcanes.length) ? (
        <span className="muted-inline"> · {[...(setup.shards ?? []), ...setup.arcanes].join(', ')}</span>
      ) : null}
    </span>
  )
}
