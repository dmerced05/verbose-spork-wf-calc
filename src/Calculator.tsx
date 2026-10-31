import { useEffect, useMemo, useState } from 'react'
import { STATUS_TYPES, factionLabel, hitsPerComboTier, maxComboFor } from './calc/constants'
import { calculate } from './calc/damage'
import { arcanesById, enemies, getCompatibleArcanes, getCompatibleMods, modsById, weapons, weaponsById } from './data'
import { estimateKill } from './calc/kill'
import { CO_MODE_LABELS, resolveCoBehavior, type CoMode } from './calc/conditionOverload'
import { EnemyPanel } from './components/EnemyPanel'
import { IncarnonPanel } from './components/IncarnonPanel'
import { getIncarnonTiers, type SelectedPerk } from './calc/incarnon'
import { DebuffsPanel } from './components/DebuffsPanel'
import { PassivesPanel } from './components/PassivesPanel'
import { WarframePanel } from './components/WarframePanel'
import { BaseStats } from './components/BaseStats'
import { hasBonusElement, passivesFor, type BonusElement } from './data/passives'
import { heavyComboFor, type HeavyMode } from './data/heavyAttacks'
import type { WarframeState } from './data/warframeAbilities'
import { ModSlots, TOTAL_SLOTS, EXILUS_SLOT, type ArcaneSlot, type ModSlot } from './components/ModSlots'
import { BuildAdvisor } from './components/BuildAdvisor'
import { equipMod } from './optimizer/optimize'
import type { SlotPolarity } from './calc/capacity'
import { SearchSelect } from './components/SearchSelect'
import { RivenEditor } from './components/RivenEditor'
import { RIVEN_MOD_ID, emptyRiven, rivenMod, rivenTypeFor, type RivenConfig, RIVEN_DISPOSITION } from './calc/riven'
import type { CompareScenario } from './optimizer/compare'
import type { FrameLoad } from './optimizer/damageCap'
import { FormulaPanel } from './components/FormulaPanel'
import { StatsPanel } from './components/StatsPanel'
import { ResultsBar } from './components/ResultsBar'
import { Thumb } from './components/Thumb'
import { TargetPanel, resolveArmor, resolveEnemy } from './components/TargetPanel'
import type { Buffs, Debuffs, EquippedMod, TargetSettings } from './types'
import type { LeaderboardEntry } from './optimizer/leaderboardTypes'
import { SCENARIO_BUFFS, SCENARIO_DEBUFFS, SCENARIO_TARGET } from './optimizer/scenario'

// a leaderboard build to load into the calculator. the nonce lets the same entry be loaded twice in a row
export interface BuildToLoad {
  entry: LeaderboardEntry
  nonce: number
  riven?: RivenConfig | null // Compare tab builds can carry one
  keepScenario?: boolean // Compare runs against the calculator's own target keep it
  // Damage Cap steps: the rest of the step's setup. frame 'keep' = leave the Warframe panel alone (panel-mode runs)
  setup?: { headshot: boolean; debuffs: Debuffs; combo: number; frame: FrameLoad | 'clear' | 'keep'; target?: TargetSettings }
}

const emptySlots = () => Array<ModSlot | null>(TOTAL_SLOTS).fill(null)
// pre-installed polarities fill the normal slots in order, exilus starts unpolarized
const defaultPolarities = (weaponPolarities: string[]): SlotPolarity[] =>
  Array.from({ length: TOTAL_SLOTS }, (_, index) => (index === EXILUS_SLOT ? null : ((weaponPolarities[index] ?? null) as SlotPolarity)))
const defaultWeaponId = weapons.find((weapon) => weapon.name === 'Braton Prime')?.uniqueName ?? weapons[0].uniqueName
// conditional passives start at what the leaderboard assumes (usually on)
const defaultPassiveStacks = (weaponName: string) =>
  Object.fromEntries(
    passivesFor(weaponName)
      .filter((passive) => passive.condition)
      .map((passive) => [passive.name, passive.scenarioStacks ?? passive.maxStacks ?? 1]),
  )
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
  statusTypeSource: 'build',
}

interface CalculatorProps {
  buildToLoad: BuildToLoad | null
  onScenarioChange?: (scenario: CompareScenario) => void
  onRivenChange?: (riven: { weaponId: string; config: RivenConfig }) => void
}

export function Calculator({ buildToLoad, onScenarioChange, onRivenChange }: CalculatorProps) {
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
  const [buffs, setBuffs] = useState<Buffs>({ roar: 0, combo: 1, gladiatorWarframePieces: 0 })
  const [passiveStacks, setPassiveStacks] = useState<Record<string, number>>(() => defaultPassiveStacks(weaponsById.get(defaultWeaponId)!.name))
  const [bonusElement, setBonusElement] = useState<BonusElement | null>(null)
  const [heavyMode, setHeavyMode] = useState<HeavyMode>('biggestHit')
  // from the Warframe panel: strength/armor/abilities/auras, and how many Corrosive Projections your auras bring
  const [warframeState, setWarframeState] = useState<WarframeState | null>(null)
  const [warframeCorrosive, setWarframeCorrosive] = useState(0)
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null)
  // the riven's stats live here, the slot just holds RIVEN_MOD_ID. per weapon, so it resets when the weapon changes
  const [rivenConfig, setRivenConfig] = useState(emptyRiven)
  // passed down to the Warframe panel when a loaded build brings (or clears) a Warframe setup
  const [frameLoad, setFrameLoad] = useState<{ nonce: number; load: FrameLoad | 'clear' } | null>(null)

  // "Load build" on the leaderboard: set the weapon, attack, mods, arcane and perks, and switch the target/debuffs
  // to the leaderboard scenario so the numbers match what the leaderboard showed
  useEffect(() => {
    if (!buildToLoad) return
    const { entry, riven, keepScenario, setup } = buildToLoad
    const loadedWeapon = weaponsById.get(entry.weaponId)
    if (!loadedWeapon) return
    const nextSlots = emptySlots()
    entry.mods.forEach((mod, index) => {
      if (index < EXILUS_SLOT && (modsById.has(mod.id) || (mod.id === RIVEN_MOD_ID && riven))) {
        nextSlots[index] = { modId: mod.id, rank: mod.rank, conditionalStacks: mod.conditionalStacks }
      }
    })
    setWeaponId(entry.weaponId)
    setAttackIndex(Math.max(0, loadedWeapon.attacks.findIndex((option) => option.name === entry.attack)))
    setSlots(nextSlots)
    setPolarities(defaultPolarities(loadedWeapon.polarities))
    setArcaneSlot(
      entry.arcane && arcanesById.has(entry.arcane.id)
        ? { arcaneId: entry.arcane.id, rank: entry.arcane.rank, conditionalStacks: entry.arcane.conditionalStacks }
        : null,
    )
    setCoOverride('auto')
    setIncarnonSelection(Object.fromEntries(entry.perks.map((perk) => [perk.tier, perk.name])))
    setIncarnonStacks({})
    setPassiveStacks(defaultPassiveStacks(loadedWeapon.name))
    setBonusElement(entry.bonusElement ?? null)
    setRivenConfig(riven ?? emptyRiven()) // leaderboard builds never have one
    if (setup) {
      // a Damage Cap step: its headshot / debuffs / combo, and its Warframe setup into the panel
      setTarget((current) => ({ ...(setup.target ?? current), headshot: setup.headshot }))
      setDebuffs(setup.debuffs)
      setBuffs((current) => ({ ...current, roar: 0, combo: setup.combo }))
      if (setup.frame !== 'keep') setFrameLoad({ nonce: buildToLoad.nonce, load: setup.frame })
    } else if (!keepScenario) {
      // leaderboard builds are scored with no Warframe, so the panel's abilities, allies and arcanes go off too
      setTarget(SCENARIO_TARGET)
      setDebuffs(SCENARIO_DEBUFFS)
      setBuffs(SCENARIO_BUFFS)
      setFrameLoad({ nonce: buildToLoad.nonce, load: 'clear' })
    }
    setLoadedFrom(keepScenario ? null : `${entry.weaponName} (${entry.attack})`)
  }, [buildToLoad])

  const weapon = weaponsById.get(weaponId)!
  const attack = weapon.attacks[attackIndex] ?? weapon.attacks[0]
  const isMelee = weapon.category === 'Melee'
  const maxCombo = maxComboFor(weapon.name)
  const combo = Math.min(maxCombo, Math.max(1, buffs.combo ?? 1))
  const compatibleMods = useMemo(() => getCompatibleMods(weapon), [weapon])
  const compatibleArcanes = useMemo(() => getCompatibleArcanes(weapon), [weapon])
  const incarnonTiers = useMemo(() => getIncarnonTiers(weapon.name), [weapon])
  const incarnonPerks: SelectedPerk[] = (incarnonTiers ?? []).flatMap(({ tier, perks }) => {
    const perk = perks.find((candidate) => candidate.name === incarnonSelection[tier])
    return perk ? [{ perk, stacks: incarnonStacks[perk.name] ?? 0 }] : []
  })

  const weaponPassives = useMemo(() => passivesFor(weapon.name), [weapon])
  const selectedPassives = weaponPassives.map((passive) => ({ passive, stacks: passiveStacks[passive.name] ?? 0 }))
  const showBonusElement = hasBonusElement(weapon.name)

  const rivenType = rivenTypeFor(weapon)
  const riven = useMemo(() => rivenMod(weapon, rivenConfig), [weapon, rivenConfig])
  const modFor = (modId: string) => (modId === RIVEN_MOD_ID ? riven : modsById.get(modId))
  const equippedMods: EquippedMod[] = slots.flatMap((slot) => {
    const mod = slot ? modFor(slot.modId) : null
    return slot && mod ? [{ mod, rank: slot.rank, conditionalStacks: slot.conditionalStacks }] : []
  })
  const equippedArcane = arcaneSlot
    ? { arcane: arcanesById.get(arcaneSlot.arcaneId)!, rank: arcaneSlot.rank, conditionalStacks: arcaneSlot.conditionalStacks }
    : null
  const wikiCo = resolveCoBehavior(weapon, attack)
  const coBehavior = coOverride === 'auto' ? wikiCo : { mode: coOverride, scale: 1, source: 'override' as const }
  const calcInput = { weapon, attack, mods: equippedMods, arcane: equippedArcane, coBehavior, incarnonPerks, passives: selectedPassives, bonusElement, heavyMode, armor: resolveArmor(target),
    debuffs: { ...debuffs, corrosiveProjections: Math.min(4, debuffs.corrosiveProjections + warframeCorrosive) },
    buffs: { ...buffs, warframe: warframeState ?? undefined } }
  // body and head are always both calculated so the results can show them side by side,
  // the "assume headshots" toggle just picks which one drives the main numbers
  const bodyResult = calculate({ ...calcInput, target: { ...target, headshot: false } })
  const headResult = calculate({ ...calcInput, target: { ...target, headshot: true } })
  const result = target.headshot ? headResult : bodyResult
  // what the in-game arsenal screen shows: mods' always-on stats only. no On Kill / On Status stacks, no Warframe
  // abilities, no combo, no status types on the target (so no CO). and the weapon with no mods at all next to it
  const arsenalInput = {
    ...calcInput,
    mods: equippedMods.map((mod) => ({ ...mod, conditionalStacks: 0 })),
    arcane: equippedArcane ? { ...equippedArcane, conditionalStacks: 0 } : null,
    incarnonPerks: incarnonPerks.map((perk) => ({ ...perk, stacks: 0 })),
    passives: selectedPassives.map((passive) => ({ ...passive, stacks: 0 })),
    debuffs: { ...debuffs, stacks: {}, liftedOrKnockedDown: false, statusTypeSource: 'debuffs' as const },
    buffs: { roar: 0, combo: 1, gladiatorWarframePieces: buffs.gladiatorWarframePieces },
    target: { ...target, headshot: false },
  }
  const arsenalResult = calculate(arsenalInput)
  const unmoddedResult = calculate({ ...arsenalInput, mods: [], arcane: null })

  // the enemy box needs health and shield numbers no matter which layer the main results show
  const scaledEnemy = resolveEnemy(target)
  const killFor = (headshot: boolean) => {
    if (!scaledEnemy) return null
    const vsHealth = calculate({ ...calcInput, target: { ...target, headshot, layer: 'health' } })
    const vsShield = calculate({ ...calcInput, target: { ...target, headshot, layer: 'shield' } })
    return { vsHealth, kill: estimateKill(scaledEnemy.health, scaledEnemy.shield, vsHealth, vsShield) }
  }
  // what the closed Target / Debuffs drawers say about themselves
  const targetSummary = [
    scaledEnemy ? `${scaledEnemy.enemy.name} Lv ${scaledEnemy.effectiveLevel}` : `${factionLabel(target.faction)}, ${resolveArmor(target)} armor`,
    target.steelPath ? 'Steel Path' : null,
    target.headshot ? 'headshots' : null,
    target.statusMode && target.statusMode !== 'normal' ? (target.statusMode === 'immune' ? 'status immune' : 'status capped') : null,
  ].filter(Boolean).join(' · ')
  const activeDebuffs = Object.values(debuffs.stacks).filter((stacks) => stacks > 0).length +
    (debuffs.heatArmorStrip > 0 ? 1 : 0) + (debuffs.corrosiveProjections + warframeCorrosive > 0 ? 1 : 0) + (debuffs.otherArmorReduction > 0 ? 1 : 0) +
    (debuffs.damageVulnerability > 0 ? 1 : 0) + (debuffs.liftedOrKnockedDown ? 1 : 0)
  const debuffSummary = activeDebuffs ? `${activeDebuffs} active` : 'none'
  const bodyKill = killFor(false)
  const headKill = killFor(true)

  // the Compare tab can run against this setup. state values as deps so it only fires on real changes
  useEffect(() => {
    onScenarioChange?.({
      target, armor: resolveArmor(target),
      debuffs: { ...debuffs, corrosiveProjections: Math.min(4, debuffs.corrosiveProjections + warframeCorrosive) },
      buffs: { ...buffs, warframe: warframeState ?? undefined },
    })
  }, [target, debuffs, buffs, warframeState, warframeCorrosive, onScenarioChange])
  useEffect(() => onRivenChange?.({ weaponId, config: rivenConfig }), [weaponId, rivenConfig, onRivenChange])

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
    setPassiveStacks(defaultPassiveStacks(weaponsById.get(id)!.name))
    setBonusElement(null)
    setRivenConfig(emptyRiven()) // a riven belongs to one weapon
  }

  // every box folds up: click its title to collapse/expand it. done on the DOM (one class on the panel) so the panels
  // themselves don't need to know, nested ones (the Warframe's mod grid) fold on their own
  const togglePanel = (event: React.MouseEvent) => {
    const target = event.target as Element
    if (target.closest('input, select, button, a, label')) return
    const title = target.closest('h2')
    const panel = title?.closest('.panel')
    if (panel) panel.classList.toggle('collapsed')
  }

  return (
    <>
      {loadedFrom && (
        <div className="load-banner">
          Loaded the leaderboard build for <b>{loadedFrom}</b>. Target and debuffs were switched to the leaderboard scenario
          (no faction, no armor, status types from the build) so the numbers match. Change them in the Target and Debuffs drawers at the top to test it against something else.
          <button className="link-button" onClick={() => setLoadedFrom(null)}>dismiss</button>
        </div>
      )}
      <div className="layout" onClick={togglePanel}>
        <ResultsBar
          result={result}
          enemy={scaledEnemy}
          bodyKill={bodyKill?.kill ?? null}
          headKill={headKill?.kill ?? null}
          canHeadshot={!attack.isAoE}
          drawers={[
            { id: 'target', label: 'Target', summary: targetSummary, group: 'setup' as const, content: <TargetPanel target={target} onChange={setTarget} /> },
            { id: 'debuffs', label: 'Debuffs on target', summary: debuffSummary, group: 'setup' as const, content: <DebuffsPanel debuffs={debuffs} buffs={buffs} onDebuffsChange={setDebuffs} onBuffsChange={setBuffs} /> },
            ...(scaledEnemy && bodyKill && headKill ? [{
              id: 'enemy', label: 'Kill details', summary: 'shots, TTK, shields', group: 'output' as const,
              content: (
                <EnemyPanel
                  scaled={scaledEnemy} faction={target.faction} steelPath={target.steelPath}
                  vsHealth={bodyKill.vsHealth} kill={bodyKill.kill} headKill={headKill.kill}
                  canHeadshot={!attack.isAoE}
                />
              ),
            }] : []),
            { id: 'results', label: 'Full results', summary: 'DoT, head vs body, procs', group: 'output' as const, content: <StatsPanel result={result} body={bodyResult} head={headResult} arsenal={arsenalResult} unmodded={unmoddedResult} canHeadshot={!attack.isAoE} /> },
          ]}
        />
        {/* weapon side and Warframe side, 50/50 on wide screens, stacked otherwise */}
        <div className="build">
          <div className="build-col">
          <section className="panel">
            <h2>Weapon</h2>
            <div className="row">
              <Thumb imageName={weapon.imageName} wikiImage={weapon.wikiImage} alt={weapon.name} wide />
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
              {weapon.type} · {compatibleMods.length} compatible mods
              {attack.isAoE && ' · AoE attack (no headshots, no Puncture/Cold crit bonus)'}
            </p>
            <BaseStats weapon={weapon} attack={attack} />
            <div className="co-row">
              <label htmlFor="co-mode">Condition Overload / Galvanized / Shiver</label>
              <select id="co-mode" value={coOverride} onChange={(event) => setCoOverride(event.target.value as CoMode | 'auto')}>
                <option value="auto">
                  Auto: {CO_MODE_LABELS[wikiCo.mode]}{wikiCo.scale !== 1 ? ` (${Math.round(wikiCo.scale * 100)}%)` : ''}
                  {wikiCo.source === 'wiki' ? ' (wiki)' : wikiCo.source === 'sheet' ? ' (GunCO sheet)' : ' (default)'}
                </option>
                <option value="add">Additive</option>
                <option value="multiply">Multiplicative</option>
                <option value="none">Doesn't apply</option>
              </select>
              {coOverride === 'auto' && wikiCo.note && <span className="muted-inline">{wikiCo.note}</span>}
            </div>
            {isMelee && (
              <div className="melee-row">
                <label htmlFor="combo">
                  Combo <b>{combo}x</b>
                  <span className="muted-inline"> ({(combo - 1) * hitsPerComboTier(weapon.name)} hits)</span>
                </label>
                <input
                  id="combo" type="range" min={1} max={maxCombo} step={1} value={combo}
                  onChange={(event) => setBuffs({ ...buffs, combo: Number(event.target.value) })}
                />
                {attack.heavy && attack.heavyMultiplier && heavyComboFor(weapon.name) && (
                  <label title="This heavy hits more than once. Biggest hit = one damage instance, full heavy = every hit added up">
                    Heavy attack
                    <select value={heavyMode} onChange={(event) => setHeavyMode(event.target.value as HeavyMode)}>
                      <option value="biggestHit">Biggest hit</option>
                      <option value="fullCombo">Full heavy (all hits)</option>
                    </select>
                  </label>
                )}
                <p className="muted">
                  Combo multiplies Heavy Attack / Heavy Slam damage and feeds Blood Rush, Weeping Wounds and the Gladiator set
                  (bonus × (combo − 1)) on every melee attack. Gladiator pieces on your Warframe are in the Warframe panel. Normal swings don't get the damage multiplier.
                  {attack.heavy && ' Heavies read the combo before spending it.'}
                </p>
              </div>
            )}
          {(weaponPassives.length > 0 || showBonusElement) && (
            <PassivesPanel
              passives={weaponPassives}
              stacks={passiveStacks}
              attackName={attack.name}
              showBonusElement={showBonusElement}
              bonusElement={bonusElement}
              onStacksChange={setPassiveStacks}
              onBonusElementChange={setBonusElement}
            />
          )}

          {incarnonTiers && (
            <IncarnonPanel
              tiers={incarnonTiers}
              selection={incarnonSelection}
              stacks={incarnonStacks}
              isIncarnonAttack={/incarnon/i.test(attack.name)}
              isMelee={weapon.category === 'Melee'}
              onSelectionChange={setIncarnonSelection}
              onStacksChange={setIncarnonStacks}
            />
          )}
          </section>

          <ModSlots
            weaponName={weapon.name}
            isMelee={isMelee}
            compatibleMods={compatibleMods}
            compatibleArcanes={compatibleArcanes}
            slots={slots}
            arcaneSlots={[arcaneSlot]}
            onArcanesChange={(next) => setArcaneSlot(next[0] ?? null)}
            polarities={polarities}
            hasCatalyst={hasCatalyst}
            onSlotsChange={setSlots}
            onPolaritiesChange={setPolarities}
            onCatalystChange={setHasCatalyst}
            riven={riven && rivenType ? {
              mod: riven,
              editor: (
                <RivenEditor type={rivenType} disposition={RIVEN_DISPOSITION}
                  config={rivenConfig} onChange={setRivenConfig} />
              ),
            } : null}
          />

          <BuildAdvisor
            input={{ ...calcInput, target }}
            compatibleMods={compatibleMods}
            compatibleArcanes={compatibleArcanes}
            keep={equippedMods.filter((slot) => slot.mod.uniqueName === RIVEN_MOD_ID)}
            onEquipArcane={(arcane) => setArcaneSlot({ arcaneId: arcane.arcane.uniqueName, rank: arcane.rank, conditionalStacks: arcane.conditionalStacks })}
            onAddMod={(mod, replaces) => {
              // into the slot of the mod it beats when the build is full, else the first free normal slot (the exilus
              // slot last, and only for exilus mods)
              const equipped = equipMod(mod, isMelee)
              const slot = { modId: mod.uniqueName, rank: equipped.rank, conditionalStacks: equipped.conditionalStacks }
              const replaceAt = replaces ? slots.findIndex((other) => other && modFor(other.modId)?.name === replaces) : -1
              const freeAt = slots.findIndex((other, index) => !other && index < EXILUS_SLOT)
              const target = replaceAt >= 0 ? replaceAt : freeAt >= 0 ? freeAt : mod.isExilus && !slots[EXILUS_SLOT] ? EXILUS_SLOT : -1
              if (target < 0) return
              setSlots(slots.map((other, index) => (index === target ? slot : other)))
            }}
            onLoadPath={(pathMods, pathArcane) => {
              // the riven keeps its slot, the path fills the rest in order
              const next = emptySlots()
              const rivenSlot = slots.find((slot) => slot?.modId === RIVEN_MOD_ID)
              let index = 0
              if (rivenSlot) next[index++] = rivenSlot
              for (const mod of pathMods) {
                if (index >= EXILUS_SLOT) break
                const equipped = equipMod(mod, isMelee)
                next[index++] = { modId: mod.uniqueName, rank: equipped.rank, conditionalStacks: equipped.conditionalStacks }
              }
              setSlots(next)
              setArcaneSlot(pathArcane ? { arcaneId: pathArcane.arcane.uniqueName, rank: pathArcane.rank, conditionalStacks: pathArcane.conditionalStacks } : null)
            }}
          />
          </div>

          <div className="build-col">
          <WarframePanel
            isMelee={isMelee} weapon={weapon}
            onWarframeChange={(state, corrosive) => { setWarframeState(state); setWarframeCorrosive(corrosive) }}
            loadRequest={frameLoad}
          />
          </div>
        </div>

      </div>
      <FormulaPanel result={result} />
    </>
  )
}
