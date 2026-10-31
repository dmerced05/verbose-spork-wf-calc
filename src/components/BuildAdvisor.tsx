// what each stat is worth to the build on screen right now, which mod gets it best / cheapest, which slots pull the
// least, and greedy build paths you can load. all measured with the calc, so it follows the target, buffs and perks
import { useMemo, useState } from 'react'
import { advise, arcaneOptions, buildPaths, pctText, rating, type BuildPath, type LeverRow } from '../calc/advisor'
import type { CalcInput } from '../calc/damage'
import { OBJECTIVES, type ObjectiveId } from '../optimizer/objectives'
import { damageModPool } from '../optimizer/modPool'
import { equipArcane, equipMod } from '../optimizer/optimize'
import type { Arcane, EquippedArcane, EquippedMod, Mod } from '../types'
import { Tip } from './Tip'

interface Props {
  input: CalcInput // the calculator's current setup, mods included
  compatibleMods: Mod[]
  compatibleArcanes: Arcane[]
  keep: EquippedMod[] // stays in every suggested path (the riven)
  onLoadPath: (mods: Mod[], arcane: EquippedArcane | null) => void
  onEquipArcane: (arcane: EquippedArcane) => void
}

// a 3 s window by default: about how long a target lives, so it counts the opening burst, procs that land in time and
// no reload unless the magazine runs dry that fast
const ADVISOR_OBJECTIVES: ObjectiveId[] = ['window3', 'sustained', 'single', 'attack']
const HOW_IT_WORKS =
  'Every number here comes from re-running the calculator with one change to your current build, so it follows your target, Warframe buffs, arcane and perks.\n\n' +
  '"Worth adding?" compares stats against each other: it adds one typical mod of each stat (+90% Heat like Hellfire, +165% damage like ' +
  'Serration...) and sees which one raises your damage the most. ' +
  'It changes as you mod. Stats of the same kind add up, but different kinds multiply each other (damage × multishot × crit × elements × fire rate), ' +
  'so a stat you already have a lot of gives less for the next bit. 1 Serration takes base damage from 1x to 2.65x (+165%), a 2nd only to 4.3x (+62%).\n\n' +
  '"Best mod" = the real mod that raises your damage the most (when all 8 slots are full: put in place of your weakest one). "Cheapest" = most damage ' +
  'per point of mod capacity.'

const RATING_CLASS: Record<string, string> = { 'Top pick': 'top', Strong: 'strong', Some: 'some', Little: 'little', 'No effect': 'none', Hurts: 'hurts' }

export function BuildAdvisor({ input, compatibleMods, compatibleArcanes, keep, onLoadPath, onEquipArcane }: Props) {
  const [objectiveId, setObjectiveId] = useState<ObjectiveId>('window3')
  const [paths, setPaths] = useState<{ key: string; paths: BuildPath[] } | null>(null)
  const objective = OBJECTIVES.find((candidate) => candidate.id === objectiveId)!
  const isMelee = input.weapon.category === 'Melee'

  const pool = useMemo(
    () => damageModPool(
      compatibleMods, objective.usesFireRate, { isHeavy: Boolean(input.attack.heavy), name: input.attack.name, finisher: input.attack.finisher }, true,
      { faction: input.target.faction, headshot: input.target.headshot },
    ).map((mod) => equipMod(mod, isMelee)),
    [compatibleMods, objective.usesFireRate, input.attack, input.target.faction, input.target.headshot, isMelee],
  )
  const arcanePool = useMemo(() => compatibleArcanes.map((arcane) => equipArcane(arcane, isMelee)), [compatibleArcanes, isMelee])
  const advice = advise(input, objective.score, pool)
  const arcaneRanking = arcaneOptions(input, objective.score, arcanePool)
  const currentArcane = arcaneRanking.find((option) => option.current)
  const showCheap = advice.levers.some((lever) => ((lever.cheapestMod ?? lever.bestMod)?.gain ?? 0) > 0)
  const shownArcanes = arcaneRanking.filter((option) => !option.current && option.gain > 0.001).slice(0, 5)
  const top = Math.max(1e-9, ...advice.levers.map((lever) => lever.weight))
  // paths belong to one weapon/attack/goal, a stale set gets hidden
  const pathKey = `${input.weapon.uniqueName}|${input.attack.name}|${objectiveId}`
  const shownPaths = paths?.key === pathKey ? paths.paths : null

  const runPaths = () => setPaths({
    key: pathKey,
    paths: buildPaths({ ...input, mods: [] }, objective.score, pool, arcanePool, keep, input.target.statusMode === 'immune'),
  })
  const fmt = (value: number) => (value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1))

  return (
    <section className="panel advisor-panel">
      <div className="row spread">
        <h2>
          Build advisor <Tip className="stack-note" text={HOW_IT_WORKS}>ⓘ</Tip>
        </h2>
        <label className="inline">
          Goal
          <select value={objectiveId} onChange={(event) => setObjectiveId(event.target.value as ObjectiveId)}>
            {ADVISOR_OBJECTIVES.map((id) => <option key={id} value={id}>{OBJECTIVES.find((candidate) => candidate.id === id)!.label}</option>)}
          </select>
        </label>
      </div>
      <p className="muted">
        Now: <b>{fmt(advice.score)}</b> {objective.unit} with {input.mods.length ? `${input.mods.length} mod${input.mods.length > 1 ? 's' : ''}` : 'no mods'}.
        {' '}Which stats would raise that most, for this build as it is now:
      </p>

      {input.mods.length >= 8 && (
        <p className="muted">
          All 8 slots are full, so "Best mod" is what swapping it in for your weakest mod ({[...advice.slots].sort((a, b) => a.contribution - b.contribution)[0]?.mod.name}) would
          do. A minus means your current mods are already the better use of that slot.
        </p>
      )}
      <div className="advisor-table-wrap">
      <table className="advisor-table">
        <thead>
          <tr>
            <th>Stat</th>
            <th>Worth adding?</th>
            <th>Mods on it</th>
            <th>Best mod <span className="muted-inline">(damage gain)</span></th>
            {showCheap && <th>Cheapest <span className="muted-inline">(gain per capacity)</span></th>}
          </tr>
        </thead>
        <tbody>
          {advice.levers.map((lever) => <LeverLine key={lever.id} lever={lever} top={top} goal={objective.label} showCheap={showCheap} />)}
        </tbody>
      </table>
      </div>

      {advice.flags.length > 0 && (
        <ul className="advisor-flags">
          {advice.flags.map((flag) => <li key={flag}>{flag}</li>)}
        </ul>
      )}

      <div className="advisor-arcanes">
        <h3>Arcane</h3>
        <p className="muted">
          {currentArcane
            ? <>Yours: <b>{currentArcane.arcane.arcane.name}</b>.{shownArcanes.length ? ' Swapping it for:' : ' Nothing beats it for this goal.'}</>
            : shownArcanes.length ? <>No arcane equipped. Adding one:</> : <>No arcane equipped, and none of them help this goal.</>}
        </p>
        {shownArcanes.length > 0 && (
          <ul>
            {shownArcanes.map((option) => (
              <li key={option.arcane.arcane.uniqueName}>
                <span>{option.arcane.arcane.name}</span>
                <b>{pctText(option.gain)}</b>
                <button onClick={() => onEquipArcane(option.arcane)}>Equip</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {advice.slots.length > 0 && (
        <div className="advisor-slots">
          <h3>Your slots</h3>
          <p className="muted">How much bigger the build is with each mod than without it.</p>
          <ul>
            {[...advice.slots].sort((a, b) => b.contribution - a.contribution).map((slot) => (
              <li key={slot.mod.name}>
                <span className="advisor-bar" style={{ width: `${Math.min(100, (slot.contribution / Math.max(1e-9, ...advice.slots.map((other) => other.contribution))) * 100)}%` }} />
                <span>{slot.mod.name}</span> <b>{pctText(slot.contribution)}</b>
              </li>
            ))}
          </ul>
          {advice.swaps.length > 0 && (
            <p>
              Better than <b>{advice.swaps[0].out.name}</b>:{' '}
              {advice.swaps.map((swap) => `${swap.in.name} ${pctText(swap.gain)}`).join(', ')}
            </p>
          )}
        </div>
      )}

      <div className="advisor-paths">
        <div className="row spread">
          <h3>Build paths</h3>
          <button onClick={runPaths}>{shownPaths ? 'Rerun' : 'Suggest build paths'}</button>
        </div>
        <p className="muted">
          8 slots filled one at a time with whichever mod adds the most at that point{keep.length ? ' (your riven stays in)' : ''}, plus the arcane that
          suits those mods best, with your perks, target and buffs. It shows the order stats pay off in. The Compare tab's optimizer looks further ahead for
          the true best build.
        </p>
        {shownPaths && (
          <div className="advisor-path-grid">
            {shownPaths.map((path) => (
              <div key={path.name} className="advisor-path">
                <div className="row spread">
                  <b>{path.name}</b>
                  <span>{fmt(path.score)}{input.mods.length > 0 && advice.score > 0 && <span className="muted-inline"> ({(path.score / advice.score).toFixed(2)}x yours)</span>}</span>
                </div>
                <div className="muted-inline">{path.note}</div>
                <ol>
                  {path.steps.map((step) => (
                    <li key={step.mod.name}>{step.mod.name} <span className="muted-inline">{pctText(step.gain)}</span></li>
                  ))}
                </ol>
                <div>Arcane: {path.arcane ? <>{path.arcane.arcane.name} <span className="muted-inline">{pctText(path.arcaneGain)}</span></> : <span className="muted-inline">none helps</span>}</div>
                <button onClick={() => onLoadPath(path.steps.map((step) => step.mod), path.arcane)}>Load into slots</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function LeverLine({ lever, top, goal, showCheap }: { lever: LeverRow; top: number; goal: string; showCheap: boolean }) {
  const best = lever.bestMod
  // only a mod that actually gains is "cheap"
  const cheap = lever.cheapestMod ?? (best && best.gain > 0 ? best : null)
  const label = rating(lever.weight, top)
  const explain = lever.weight < -0.0005
    ? `One typical mod of it (${lever.size}) would lower your ${goal} by ${pctText(lever.weight).replace('-', '')}. ` +
      'This happens when it takes status procs away from a stronger one: Slash bleeds ignore armor, so on an armored target ' +
      'a new element can cost more in lost bleeds than its own damage adds.'
    : `One typical mod of it (${lever.size}) would raise your ${goal} by ${pctText(lever.weight)}, on top of what you have now. ` +
      'Ratings compare this against the other stats: "Top pick" is the best stat to add right now. ' +
      'With all 8 slots full, adding means giving up a mod, see Best mod for what a swap does.'
  return (
    <tr className={lever.weight <= 1e-4 ? 'dim' : ''}>
      <td>
        {lever.label}
        {lever.combines.length > 0 && (
          <Tip className="combine-note" text={`Adding it combines with an element already in the build into ${lever.combines.join(' + ')}, so that element (and its procs) is gone. Elements combine in mod order, innate ones go last.`}>
            {' '}→ {lever.combines.join(', ')}
          </Tip>
        )}
      </td>
      <td className="advisor-weight">
        <span className="advisor-meter"><span className="advisor-bar" style={{ width: `${Math.max(0, Math.min(1, lever.weight / top)) * 100}%` }} /></span>
        <Tip className={`rating rating-${RATING_CLASS[label]}`} text={explain}>{label}</Tip>
      </td>
      <td>{lever.equippedCount || ''}</td>
      <td>
        {!best ? <span className="muted-inline">—</span>
          : best.gain > 0 ? <>{best.mod.name} <b>{pctText(best.gain)}</b></>
            : <span className="muted-inline">{best.mod.name} {pctText(best.gain)}</span>}
      </td>
      {showCheap && <td>{cheap ? <>{cheap.mod.name} <span className="muted-inline">{pctText(cheap.gain / cheap.drain)} / pt ({cheap.drain})</span></> : ''}</td>}
    </tr>
  )
}
