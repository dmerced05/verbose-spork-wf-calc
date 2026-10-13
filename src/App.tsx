import { useMemo, useState } from 'react'
import { STATUS_TYPES } from './calc/constants'
import { calculate } from './calc/damage'
import { arcanesById, enemies, getCompatibleArcanes, getCompatibleMods, modsById, weapons, weaponsById } from './data'
import { estimateKill } from './calc/kill'
import { CO_MODE_LABELS, resolveCoBehavior, type CoMode } from './calc/conditionOverload'
import { EnemyPanel } from './components/EnemyPanel'
import { IncarnonPanel } from './components/IncarnonPanel'
import { getIncarnonTiers, type SelectedPerk } from './calc/incarnon'
import { DebuffsPanel } from './components/DebuffsPanel'
import { ModSlots, TOTAL_SLOTS, EXILUS_SLOT, type ArcaneSlot, type ModSlot } from './components/ModSlots'
import type { SlotPolarity } from './calc/capacity'
import { SearchSelect } from './components/SearchSelect'
import { StatsPanel } from './components/StatsPanel'
import { TargetPanel, resolveArmor, resolveEnemy } from './components/TargetPanel'
import type { Buffs, Debuffs, EquippedMod, TargetSettings } from './types'

const emptySlots = () => Array<ModSlot | null>(TOTAL_SLOTS).fill(null)
// pre-installed polarities fill the normal slots in order, exilus starts unpolarized
const defaultPolarities = (weaponPolarities: string[]): SlotPolarity[] =>
  Array.from({ length: TOTAL_SLOTS }, (_, index) => (index === EXILUS_SLOT ? null : ((weaponPolarities[index] ?? null) as SlotPolarity)))
const defaultWeaponId = weapons.find((weapon) => weapon.name === 'Braton Prime')?.uniqueName ?? weapons[0].uniqueName
const weaponOptions = weapons.map((weapon) => ({ id: weapon.uniqueName, label: weapon.name }))

const defaultEnemy = enemies.find((enemy) => enemy.name === 'Heavy Gunner')
const DEFAULT_TARGET: TargetSettings = {
  faction: 'Grineer',
  layer: 'health',
  enemyId: defaultEnemy?.uniqueName ?? null,
  baseLevel: 1,
  level: 100,
  steelPath: false,
  manualArmor: 500,
  headshot: false,
  headshotMultiplier: null, // auto from faction
  headcrit: null,
}
const DEFAULT_DEBUFFS: Debuffs = {
  stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, 0])),
  heatArmorStrip: 0,
  corrosiveProjections: 0,
  otherArmorReduction: 0,
  damageVulnerability: 0,
  liftedOrKnockedDown: false,
}

export default function App() {
  const [weaponId, setWeaponId] = useState(defaultWeaponId)
  const [attackIndex, setAttackIndex] = useState(0)
  const [slots, setSlots] = useState(emptySlots)
  const [polarities, setPolarities] = useState(() => defaultPolarities(weaponsById.get(defaultWeaponId)!.polarities))
  const [hasCatalyst, setHasCatalyst] = useState(true)
  const [arcaneSlot, setArcaneSlot] = useState<ArcaneSlot | null>(null)
  const [coOverride, setCoOverride] = useState<CoMode | 'auto'>('auto')
  const [incarnonSelection, setIncarnonSelection] = useState<Record<string, string | null>>({})
  const [incarnonStacks, setIncarnonStacks] = useState<Record<string, number>>({}) // conditional perks start off
  const [target, setTarget] = useState(DEFAULT_TARGET)
  const [debuffs, setDebuffs] = useState(DEFAULT_DEBUFFS)
  const [buffs, setBuffs] = useState<Buffs>({ roar: 0 })

  const weapon = weaponsById.get(weaponId)!
  const attack = weapon.attacks[attackIndex] ?? weapon.attacks[0]
  const compatibleMods = useMemo(() => getCompatibleMods(weapon), [weapon])
  const compatibleArcanes = useMemo(() => getCompatibleArcanes(weapon), [weapon])
  const incarnonTiers = useMemo(() => getIncarnonTiers(weapon.name), [weapon])
  const incarnonPerks: SelectedPerk[] = (incarnonTiers ?? []).flatMap(({ tier, perks }) => {
    const perk = perks.find((candidate) => candidate.name === incarnonSelection[tier])
    return perk ? [{ perk, stacks: incarnonStacks[perk.name] ?? 0 }] : []
  })

  const equippedMods: EquippedMod[] = slots.flatMap((slot) =>
    slot ? [{ mod: modsById.get(slot.modId)!, rank: slot.rank, conditionalStacks: slot.conditionalStacks }] : [],
  )
  const equippedArcane = arcaneSlot
    ? { arcane: arcanesById.get(arcaneSlot.arcaneId)!, rank: arcaneSlot.rank, conditionalStacks: arcaneSlot.conditionalStacks }
    : null
  const wikiCo = resolveCoBehavior(weapon, attack)
  const coBehavior = coOverride === 'auto' ? wikiCo : { mode: coOverride, scale: 1, source: 'override' as const }
  const calcInput = { weapon, attack, mods: equippedMods, arcane: equippedArcane, coBehavior, incarnonPerks, armor: resolveArmor(target), debuffs, buffs }
  // body and head are always both calculated so the results can show them side by side,
  // the "assume headshots" toggle just picks which one drives the main numbers
  const bodyResult = calculate({ ...calcInput, target: { ...target, headshot: false } })
  const headResult = calculate({ ...calcInput, target: { ...target, headshot: true } })
  const result = target.headshot ? headResult : bodyResult

  // the enemy box needs health and shield numbers no matter which layer the main results show
  const scaledEnemy = resolveEnemy(target)
  const killFor = (headshot: boolean) => {
    if (!scaledEnemy) return null
    const vsHealth = calculate({ ...calcInput, target: { ...target, headshot, layer: 'health' } })
    const vsShield = calculate({ ...calcInput, target: { ...target, headshot, layer: 'shield' } })
    return { vsHealth, kill: estimateKill(scaledEnemy.health, scaledEnemy.shield, vsHealth, vsShield) }
  }
  const bodyKill = killFor(false)
  const headKill = killFor(true)

  const pickWeapon = (id: string | null) => {
    if (!id) return
    setWeaponId(id)
    setAttackIndex(0)
    setSlots(emptySlots()) // mods from the old weapon type won't fit anyway
    setPolarities(defaultPolarities(weaponsById.get(id)!.polarities))
    setArcaneSlot(null) // primary/secondary/melee arcanes don't carry over either
    setCoOverride('auto')
    setIncarnonSelection({}) // perks are per weapon
    setIncarnonStacks({})
  }

  return (
    <main>
      <header>
        <h1>WF Damage Calc</h1>
      </header>

      <div className="layout">
        <div className="build">
          <section className="panel">
            <h2>Weapon</h2>
            <div className="row">
              <SearchSelect options={weaponOptions} selectedId={weaponId} onSelect={pickWeapon} placeholder="Search weapons" />
              {weapon.attacks.length > 1 && (
                <select value={attackIndex} onChange={(event) => { setAttackIndex(Number(event.target.value)); setCoOverride('auto') }}>
                  {weapon.attacks.map((option, index) => (
                    <option key={option.name} value={index}>{option.name}</option>
                  ))}
                </select>
              )}
            </div>
            <p className="muted">
              {weapon.type} · Riven disposition {weapon.disposition ?? '?'} · {compatibleMods.length} compatible mods
              {attack.isAoE && ' · AoE attack (no headshots, no Puncture/Cold crit bonus)'}
            </p>
            <div className="co-row">
              <label htmlFor="co-mode">Condition Overload / Galvanized / Shiver</label>
              <select id="co-mode" value={coOverride} onChange={(event) => setCoOverride(event.target.value as CoMode | 'auto')}>
                <option value="auto">
                  Auto: {CO_MODE_LABELS[wikiCo.mode]}{wikiCo.scale !== 1 ? ` (${Math.round(wikiCo.scale * 100)}%)` : ''}
                  {wikiCo.source === 'wiki' ? ' (wiki)' : ' (default)'}
                </option>
                <option value="add">Additive</option>
                <option value="multiply">Multiplicative</option>
                <option value="none">Doesn't apply</option>
              </select>
              {coOverride === 'auto' && wikiCo.note && <span className="muted-inline">{wikiCo.note}</span>}
            </div>
          </section>

          {incarnonTiers && (
            <IncarnonPanel
              tiers={incarnonTiers}
              selection={incarnonSelection}
              stacks={incarnonStacks}
              isIncarnonAttack={/incarnon/i.test(attack.name)}
              isMelee={weapon.type === 'Melee'}
              onSelectionChange={setIncarnonSelection}
              onStacksChange={setIncarnonStacks}
            />
          )}

          <ModSlots
            weaponName={weapon.name}
            compatibleMods={compatibleMods}
            compatibleArcanes={compatibleArcanes}
            slots={slots}
            arcaneSlot={arcaneSlot}
            onArcaneChange={setArcaneSlot}
            polarities={polarities}
            hasCatalyst={hasCatalyst}
            onSlotsChange={setSlots}
            onPolaritiesChange={setPolarities}
            onCatalystChange={setHasCatalyst}
          />

          <TargetPanel target={target} onChange={setTarget} />
          <DebuffsPanel debuffs={debuffs} buffs={buffs} onDebuffsChange={setDebuffs} onBuffsChange={setBuffs} />
        </div>

        <div className="results-column">
          {scaledEnemy && bodyKill && headKill && (
            <EnemyPanel
              scaled={scaledEnemy} faction={target.faction} steelPath={target.steelPath}
              vsHealth={bodyKill.vsHealth} kill={bodyKill.kill} headKill={headKill.kill}
              canHeadshot={!attack.isAoE}
            />
          )}
          <StatsPanel result={result} body={bodyResult} head={headResult} canHeadshot={!attack.isAoE} />
        </div>
      </div>
    </main>
  )
}
