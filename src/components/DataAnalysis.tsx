// Data Analysis: Warframe abilities side by side. each ability runs on the build that fits how it scales (src/data/abilityBuilds.ts)
// against a real target, so % of HP abilities (Smite, Reave, Sow + Reap) show up as what they are: they take the same share
// of a Lancer and a Babau. hover a row for the wiki's scaling notes, the build's mods and why that build
import { useMemo, useState } from 'react'
import { ABILITY_DAMAGE, defaultParams } from '../data/abilityDamage'
import { abilityBuildFor } from '../data/abilityBuilds'
import { ABILITY_WINDOW, NO_UWB, runAbility, type AbilityContext, type UniversalBonuses } from '../calc/abilityDamage'
import { enemies } from '../data'
import { STATUS_TYPES } from '../calc/constants'
import type { Debuffs, TargetSettings } from '../types'
import { TargetPanel, resolveArmor, resolveEnemy } from './TargetPanel'

type Sort = 'kill' | 'total' | 'window' | 'biggest'
const SORTS: { id: Sort; label: string }[] = [
  { id: 'kill', label: 'Share of target HP' },
  { id: 'total', label: 'Per cast' },
  { id: 'window', label: `First ${ABILITY_WINDOW} s` },
  { id: 'biggest', label: 'Biggest hit' },
]
// Roar wiki: "10% / 15% / 25% / 50% bonus damage to all weapons and abilities", "Subsumed Roar's damage bonus is reduced to
// 2% / 9% / 15% / 30%", both x the caster's Strength. a teammate's Rhino at 300% is the usual one
const ROARS = [
  { value: 0, label: 'No Roar' },
  { value: 1.5, label: 'Rhino Roar at 300% Strength (+150%)' },
  { value: 0.9, label: 'Subsumed Roar at 300% Strength (+90%)' },
]
// Universal Weapon Bonuses (wiki Universal_Weapon_Bonuses). only abilities that list them take them (Jade Stars: elemental + flat
// crit only). "Valence Formation ... +200%" of an element, Nourish "+75% Viral" x Strength, Arcane Avenger "+45% Critical Chance"
// Jade Stars: "Base 1.0x critical multiplier can be increased by using effects like Arcane Crepuscular, Tenacious Bond, or Grave Spirit",
// so Avenger alone does nothing to an ability: it needs a crit multiplier bonus too
interface UwbPick { valence: string; nourish: number; avenger: boolean; critMult: number; eclipse: number; arachne: boolean }
const VALENCE = ['', 'heat', 'cold', 'electricity', 'toxin']
const toUwb = (pick: UwbPick): UniversalBonuses => ({
  ...NO_UWB,
  base: pick.arachne ? 1.5 : 0, // Arcane Arachne +150% after a wall latch
  multiplier: 1 + pick.eclipse,
  elemental: [...(pick.valence ? [{ damageType: pick.valence, value: 2 }] : []), ...(pick.nourish ? [{ damageType: 'viral', value: pick.nourish }] : [])],
  flatCritChance: pick.avenger ? 0.45 : 0,
  critMultiplierBonus: pick.critMult,
})
const NO_DEBUFFS: Debuffs = {
  stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, 0])), heatArmorStrip: 0, corrosiveProjections: 0,
  otherArmorReduction: 0, damageVulnerability: 0, liftedOrKnockedDown: false, statusTypeSource: 'build',
}
const lancer = enemies.find((enemy) => enemy.name === 'Elite Lancer')
const DEFAULT_TARGET: TargetSettings = {
  faction: 'Grineer', layer: 'health', enemyId: lancer?.uniqueName ?? null, baseLevel: 1, level: 150, steelPath: true, manualArmor: 0,
  headshot: false, headshotMultiplier: null, headcrit: null,
}
const num = (value: number) => Math.round(value).toLocaleString()
const pct = (value: number) => `${Math.round(value * 1000) / 10}%`

export function DataAnalysis() {
  const [target, setTarget] = useState(DEFAULT_TARGET)
  const [roar, setRoar] = useState(0)
  const [sort, setSort] = useState<Sort>('kill')
  const [uwbPick, setUwbPick] = useState<UwbPick>({ valence: '', nourish: 0, avenger: false, critMult: 0, eclipse: 0, arachne: false })
  const uwb = toUwb(uwbPick)
  const scaled = resolveEnemy(target)
  const rows = useMemo(() => ABILITY_DAMAGE.map((def) => {
    const build = abilityBuildFor(def)
    const params = { ...defaultParams(def), ...build.params }
    const ctx: AbilityContext = {
      strength: build.totals.abilityStrength, duration: build.totals.abilityDuration, range: build.totals.abilityRange, roar, subsumed: false, uwb,
      shardVsStatus: { electricity: 0, radiation: 0, corrosive: 0 },
      target: { faction: target.faction, armor: resolveArmor(target), debuffs: NO_DEBUFFS, health: scaled?.health ?? 0, shield: scaled?.shield ?? 0 },
    }
    const result = runAbility(def.build(ctx, params), ctx)
    const settings = (def.params ?? []).map((param) => `${param.label}: ${param.options?.find((option) => option.value === params[param.id])?.label ?? params[param.id]}`)
    return { def, build, result, settings }
  }), [target, roar, uwbPick, scaled?.health, scaled?.shield]) // eslint-disable-line react-hooks/exhaustive-deps
  const key = (row: (typeof rows)[number]) => {
    if (sort === 'kill') return row.result.poolFraction * 1e12 - (row.result.killTime ?? 1e6) // kills first, fastest kill first
    return sort === 'total' ? row.result.total : sort === 'window' ? row.result.window10 : row.result.biggestHit
  }
  const sorted = [...rows].sort((a, b) => key(b) - key(a))

  return (
    <div className="data-analysis">
      <div className="analysis-top">
        <TargetPanel target={target} onChange={setTarget} />
        <section className="panel">
          <h2>Ability damage</h2>
          <p className="muted">
            One cast on one target, each ability on the build its wiki page says it scales with (hover the build for the mods), status DoTs
            included. &quot;Share of target HP&quot; is how much of the target&apos;s health and shields one cast takes: % of HP abilities take the
            same share of anything. Your own build and settings are on each ability&apos;s card in the Calculator&apos;s Warframe panel.
          </p>
          <div className="leaderboard-settings">
            <label>
              Sort by
              <div className="board-tabs" role="tablist">
                {SORTS.map((option) => (
                  <button key={option.id} role="tab" aria-selected={sort === option.id} className={sort === option.id ? 'active' : ''} onClick={() => setSort(option.id)}>
                    {option.label}
                  </button>
                ))}
              </div>
            </label>
            <label title="Roar is faction damage: once on hits, twice on status ticks. Multiple Roars don't stack">
              Roar
              <select value={roar} onChange={(event) => setRoar(Number(event.target.value))}>
                {ROARS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <div className="leaderboard-settings" title="Universal Weapon Bonuses: only abilities whose wiki page says they take them (Jade Stars motes, Seeking Talons, Final Stand, Radial Javelin, Soul Punch, Infernum fireballs)">
            <label>
              Valence Formation
              <select value={uwbPick.valence} onChange={(event) => setUwbPick({ ...uwbPick, valence: event.target.value })}>
                {VALENCE.map((type) => <option key={type} value={type}>{type ? `+200% ${type}` : 'None'}</option>)}
              </select>
            </label>
            <label>
              Nourish
              <select value={uwbPick.nourish} onChange={(event) => setUwbPick({ ...uwbPick, nourish: Number(event.target.value) })}>
                <option value={0}>None</option>
                <option value={0.75}>+75% Viral (100% Str)</option>
                <option value={2.25}>+225% Viral (300% Str)</option>
              </select>
            </label>
            <label>
              Eclipse / multipliers
              <select value={uwbPick.eclipse} onChange={(event) => setUwbPick({ ...uwbPick, eclipse: Number(event.target.value) })}>
                <option value={0}>None</option>
                <option value={0.3}>Subsumed Eclipse +30% (100% Str)</option>
                <option value={0.9}>Subsumed Eclipse +90% (300% Str)</option>
              </select>
            </label>
            <label className="row"><input type="checkbox" checked={uwbPick.avenger} onChange={(event) => setUwbPick({ ...uwbPick, avenger: event.target.checked })} /> Arcane Avenger (+45% crit)</label>
            <label title="Ability crits start at 1.0x, so crit chance needs one of these to do anything">
              Crit multiplier bonus
              <select value={uwbPick.critMult} onChange={(event) => setUwbPick({ ...uwbPick, critMult: Number(event.target.value) })}>
                <option value={0}>None (1.0x)</option>
                <option value={0.5}>+0.5x</option>
                <option value={1}>+1.0x</option>
                <option value={2}>+2.0x</option>
              </select>
            </label>
            <label className="row"><input type="checkbox" checked={uwbPick.arachne} onChange={(event) => setUwbPick({ ...uwbPick, arachne: event.target.checked })} /> Arcane Arachne (+150% base)</label>
          </div>
          {scaled && <p className="muted">{scaled.enemy.name} Lv {scaled.effectiveLevel}: {num(scaled.health)} health, {num(scaled.shield)} shields, {num(scaled.armor)} armor</p>}
        </section>
      </div>
      <section className="panel">
        <table className="ability-board">
          <thead>
            <tr><th>#</th><th>Ability</th><th>Build</th><th>Target HP</th><th>Per cast</th><th>First {ABILITY_WINDOW} s</th><th>Biggest hit</th><th>Settings</th></tr>
          </thead>
          <tbody>
            {sorted.map(({ def, build, result, settings }, index) => (
              <tr key={def.id}>
                <td>{index + 1}</td>
                <td title={[def.summary, ...def.scaling].join('\n')}><b>{def.name}</b><div className="muted">{def.warframe}</div></td>
                <td title={`${build.template.note}\n${build.why}\n\n${build.modNames.join('\n')}`}>
                  {build.template.label}
                  <div className="muted">{pct(build.totals.abilityStrength)} Str · {pct(build.totals.abilityDuration)} Dur</div>
                </td>
                <td>
                  {result.pool > 0 ? (result.killTime !== null ? <b>Kills in {result.killTime.toFixed(1)} s</b> : pct(result.poolFraction)) : '—'}
                </td>
                <td>{num(result.total)}</td>
                <td>{num(result.window10)}</td>
                <td>{num(result.biggestHit)}</td>
                <td className="muted">{[...settings, ...result.notes].join(' · ') || 'none'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
