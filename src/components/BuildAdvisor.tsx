// what each stat is worth to the build on screen right now, which mod gets it best / cheapest, which slots pull the
// least, and greedy build paths you can load. all measured with the calc, so it follows the target, buffs and perks
import { useMemo, useState } from 'react'
import { advise, buildPaths, pctText, type BuildPath, type LeverRow } from '../calc/advisor'
import type { CalcInput } from '../calc/damage'
import { OBJECTIVES, type ObjectiveId } from '../optimizer/objectives'
import { damageModPool } from '../optimizer/modPool'
import { equipMod } from '../optimizer/optimize'
import type { EquippedMod, Mod } from '../types'
import { Tip } from './Tip'

interface Props {
  input: CalcInput // the calculator's current setup, mods included
  compatibleMods: Mod[]
  keep: EquippedMod[] // stays in every suggested path (the riven)
  onLoadPath: (mods: Mod[]) => void
}

const ADVISOR_OBJECTIVES: ObjectiveId[] = ['sustained', 'single', 'attack']
const HOW_IT_WORKS =
  'Every number here is the calculator re-run with one change to your current build, so it follows your target, Warframe buffs, arcane and perks.\n\n' +
  '"+10% adds" = how much the total goes up if that stat got +10% more (like a tenth of a mod). Warframe multiplies its stat buckets together ' +
  '(base damage × multishot × crit × elements × fire rate...), and stats inside one bucket add up. So the more a bucket already has, the less ' +
  'the next +10% in it is worth: 2 Serrations = 4.3x base damage, a 3rd only takes it to 5.95x. That is why the weights shift as you mod.\n\n' +
  '"Best mod" = the real mod that adds the most (when all 8 slots are full: in place of your weakest slot). "Best per capacity" = most gain per ' +
  'point of mod capacity at max rank.'

export function BuildAdvisor({ input, compatibleMods, keep, onLoadPath }: Props) {
  const [objectiveId, setObjectiveId] = useState<ObjectiveId>(input.weapon.category === 'Melee' || input.attack.heavy ? 'attack' : 'sustained')
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
  const advice = advise(input, objective.score, pool)
  const top = Math.max(1e-9, ...advice.levers.map((lever) => lever.weight))
  // paths belong to one weapon/attack/goal, a stale set gets hidden
  const pathKey = `${input.weapon.uniqueName}|${input.attack.name}|${objectiveId}`
  const shownPaths = paths?.key === pathKey ? paths.paths : null

  const runPaths = () => setPaths({
    key: pathKey,
    paths: buildPaths({ ...input, mods: [] }, objective.score, pool, keep, input.target.statusMode === 'immune'),
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
        {' '}What each stat is worth to this build right now:
      </p>

      <div className="advisor-table-wrap">
      <table className="advisor-table">
        <thead>
          <tr><th>Stat</th><th>+10% adds</th><th>In build</th><th>Best mod</th><th>Best per capacity</th></tr>
        </thead>
        <tbody>
          {advice.levers.map((lever) => <LeverLine key={lever.id} lever={lever} top={top} />)}
        </tbody>
      </table>
      </div>

      {advice.flags.length > 0 && (
        <ul className="advisor-flags">
          {advice.flags.map((flag) => <li key={flag}>{flag}</li>)}
        </ul>
      )}

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
          8 slots filled one at a time with whichever mod adds the most at that point{keep.length ? ' (your riven stays in)' : ''}, using your current
          arcane, perks, target and buffs. It shows the order stats pay off in. The Compare tab's optimizer looks further ahead for the true best build.
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
                <button onClick={() => onLoadPath(path.steps.map((step) => step.mod))}>Load into slots</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function LeverLine({ lever, top }: { lever: LeverRow; top: number }) {
  const best = lever.bestMod
  const cheap = lever.cheapestMod ?? best
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
        <span className="advisor-bar" style={{ width: `${Math.max(0, (lever.weight / top) * 100)}%` }} />
        <span>{pctText(lever.weight)}</span>
      </td>
      <td>{lever.equippedCount || ''}</td>
      <td>{best ? <>{best.mod.name} <b>{pctText(best.gain)}</b>{best.swapsOut && <span className="muted-inline"> for {best.swapsOut}</span>}</> : <span className="muted-inline">—</span>}</td>
      <td>{cheap ? <>{cheap.mod.name} <span className="muted-inline">{pctText(cheap.gain / cheap.drain)} / pt ({cheap.drain})</span></> : ''}</td>
    </tr>
  )
}
