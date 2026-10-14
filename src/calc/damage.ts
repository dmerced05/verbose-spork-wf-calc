// the damage pipeline, following wiki.warframe.com/w/Damage/Calculation:
//   1. proportions of each damage type vs base damage (physical/elemental mods, element combining)
//   2. quantize each type to the nearest 1/32 of base damage
//   3. x modded base damage (base x (1 + damage mods)), x faction bonus, x crit
//   4. per type: faction weakness x armor (health only) x viral/magnetic, then other vulnerabilities
// status DoTs use the same modded base, but faction applies twice and only literal element mods count.

import {
  BANE_TARGET, BLAST_DETONATION_MULTIPLIER, GLADIATOR_CRIT_PER_PIECE, GLADIATOR_MAX_PIECES, MAX_HEAVY_EFFICIENCY, hitsPerComboTier, maxComboFor, HEADCRIT_MULTIPLIER, WEAK_POINT_BONUS_RATE_ON_HEAD, hasHeadcrits, headMultiplierFor, COMBINED_ELEMENTS, DOT_STATUSES, FACTION_DAMAGE_MODIFIERS, PHYSICAL_TYPES, PRIMARY_ELEMENTS,
  coldCritMultiplierBonus, magneticMultiplier, punctureCritChanceBonus, tauStatusChanceBonus, viralMultiplier,
} from './constants'
import { parseUpgrade, type ModEffect, type StatKey } from './parseMod'
import { resolveCoBehavior, type CoBehavior } from './conditionOverload'
import { perkAppliesTo, type SelectedPerk } from './incarnon'
import { armorDamageMultiplier, effectiveArmor } from './target'
import { hasBonusElement, type BonusElement, type WeaponPassive } from '../data/passives'
import { SHELL_BY_SHELL_RELOAD } from '../data/reloads'
import { expectedDamage, simulateDamage, type DamageRange, type ShotModel } from './simulate'

// "sustained" = average DPS over a fight this long: reloads, DoT ramp-up and Heat stacking count, and DoT ticks
// after the fight ends don't (so long Status Duration tails stop inflating it)
export const SUSTAINED_FIGHT_SECONDS = 60
import type { Attack, Buffs, Debuffs, EquippedArcane, EquippedMod, TargetSettings, Weapon } from '../types'

export interface CalcInput {
  weapon: Weapon
  attack: Attack
  mods: EquippedMod[]
  arcane?: EquippedArcane | null
  coBehavior?: CoBehavior // defaults to the wiki table for this weapon/attack
  incarnonPerks?: SelectedPerk[]
  passives?: SelectedPassive[] // weapon passives (src/data/passives.ts)
  bonusElement?: BonusElement | null // Kuva/Tenet/Coda bonus element
  target: TargetSettings
  armor: number // target armor before debuffs (already level scaled)
  debuffs: Debuffs
  buffs: Buffs
}

export interface SelectedPassive {
  passive: WeaponPassive
  stacks: number // only matters for passives with a condition
}

export interface DamageTypeRow {
  damageType: string
  modded: number // per projectile, no crit, no faction, before target modifiers
  vsTarget: number // average per projectile vs the target, crits averaged in
  procShare: number // share of status procs this type gets
}

export interface CritSplit {
  normal: number // the proc came from a non-crit (or lowest tier) hit
  crit: number // the proc came from a crit (next tier up) hit
  average: number // crits averaged in
}

export interface DotRow {
  damageType: string
  procsPerSecond: number
  tick: CritSplit // vs target
  ticks: number
  perProc: CritSplit // tick x ticks
  dps: number
  aoe: { label: string; damage: CritSplit } | null // damage to *other* enemies (Blast detonation)
  note: string
}

export interface CalcResult {
  damageTypes: DamageTypeRow[]
  moddedBaseDamage: number
  critChance: number
  critMultiplier: number
  critTier: number // 0 = can't crit, 1 = yellow, 2 = orange, 3+ = red
  statusChance: number
  multishot: number
  multishotLocked: boolean
  fireRate: number
  factionMultiplier: number
  activeStatusTypes: number
  conditionOverload: { mode: CoBehavior['mode']; bonus: number; source: CoBehavior['source']; note?: string }
  headshot: { applied: boolean; factor: number; weakPointMultiplier: number; headshotBonus: number; headcrit: boolean }
  armor: { before: number; after: number; damageMultiplier: number }
  hit: { normal: number; crit: number; average: number } // per projectile vs target
  averageShot: number
  burstDps: number
  procsPerSecond: number
  dots: DotRow[]
  dotDps: number
  totalDps: number // burst: direct + DoT while firing nonstop
  magazineSize: number | null // null = no reload modeled (melee, Incarnon form)
  reloadTime: number | null
  uptime: number // share of time spent firing
  sustainedDps: number // expected damage over a SUSTAINED_FIGHT_SECONDS fight / its length
  steadyStateDps: number // old formula: burst x uptime, every DoT tick counted, no Heat stacking
  shellByShell: boolean // reloads one shell at a time (reload time grows with magazine size)
  damageInWindow: (seconds: number) => number // expected damage in the first `seconds`
  simulateWindows: (windows: number[], runs?: number) => DamageRange[] // Monte Carlo range (crit/status rolls)
  shotModel: ShotModel
  fireRateLocked: boolean
  passives: string[] // names of the passives that are on for this attack
  detonation: { ownProcs: number; existingStacks: number } | null // Harmony heavy: DoT damage dealt at once, per heavy
  melee: {
    combo: number // multiplier actually used (clamped to the weapon's cap)
    heavy: boolean
    critFromCombo: number // Blood Rush + Gladiator set, added inside the crit mod bracket
    statusFromCombo: number // Weeping Wounds
    windUp: number | null // modded heavy wind-up
    comboAfterHeavy: number | null // multiplier left after the heavy attack (Heavy Attack Efficiency)
  } | null
  statusTypeSource: 'build' | 'debuffs'
  unparsed: string[]
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
// rounds to the nearest 1/32, sign(x) * floor(|x| * 32 + 0.5) / 32
const quantize = (proportion: number) => (Math.sign(proportion) * Math.floor(Math.abs(proportion) * 32 + 0.5)) / 32

export function calculate({
  weapon, attack, mods, arcane, coBehavior, incarnonPerks = [], passives = [], bonusElement, target, armor, debuffs, buffs,
}: CalcInput): CalcResult {
  const stacks = (statusType: string) => debuffs.stacks[statusType] ?? 0
  // CO counts status *types*, not stacks. Lifted/knocked down is a hidden status that also counts
  const debuffStatusTypes = Object.values(debuffs.stacks).filter((count) => count > 0).length

  // ---- 1. collect mod effects ----
  const bonus: Record<StatKey, number> = {
    damage: 0, damagePerStatusType: 0, damagePerColdStack: 0, critChance: 0, weakpointCritChance: 0,
    critDamage: 0, multishot: 0, fireRate: 0, statusChance: 0, statusDamage: 0, headshotMultiplier: 0, weakpointDamage: 0,
    magazineCapacity: 0, reloadSpeed: 0,
    critChancePerCombo: 0, statusChancePerCombo: 0, heavyCritChance: 0, heavyDamage: 0, heavyWindUpSpeed: 0, heavyEfficiency: 0,
    statusDuration: 0,
  }
  const physicalBonus: Record<string, number> = {}
  const elementBonus: Record<string, number> = {} // literal mod bonus per element, also used for DoTs
  const elementOrder: string[] = [] // slot order matters for combining
  let factionBonus = buffs.roar // Roar is additive with bane mods
  let slashOnCritChance = 0
  let slashOnImpactChance = 0
  let overguardMultiplier = 1
  let separateDamageMultiplier = 1 // Longbow Sharpshot style, multiplies outside the damage mods
  let multishotLocked = false // Acuity mods
  const fireRateLocked = mods.some(({ mod }) => mod.locksFireRate) // Semi-___ Cannonade: fire rate stays at base
  const unparsed: string[] = []
  // elements added on top of the weapon's own (Melee Exposure's Corrosive, Tonkkatt's Heat, Lesion's Toxin): they add
  // damage but don't combine with other elements and don't take a share of the status procs, so they can't dilute
  // your procs and don't proc on their own. you still need status chance + your own elements for procs
  const separateElements: Record<string, number> = {}
  const forcedProcsPerPellet: Record<string, number> = {} // guaranteed procs on every hit (Reconifex's Heat rounds)

  const applyEffect = (effect: ModEffect, times: number) => {
    switch (effect.kind) {
      case 'stat':
        bonus[effect.stat] += effect.value * times
        break
      case 'faction':
        if (BANE_TARGET[target.faction] === effect.faction) factionBonus += effect.value * times
        break
      case 'slashOnCrit':
        slashOnCritChance += effect.value * times
        break
      case 'slashOnImpact':
        slashOnImpactChance += effect.value * times
        break
      case 'overguardMultiplier':
        overguardMultiplier *= effect.value
        break
      case 'damageMultiplier':
        separateDamageMultiplier *= 1 + effect.value
        break
      case 'lockMultishot':
        multishotLocked = true
        break
      case 'heavyScaledCritChance':
        // normal attacks get the value, heavies get value x factor, so the extra part only counts on heavies
        bonus.critChance += effect.value * times
        bonus.heavyCritChance += effect.value * (effect.heavyFactor - 1) * times
        break
      case 'damageType':
        if (PHYSICAL_TYPES.includes(effect.damageType)) {
          physicalBonus[effect.damageType] = (physicalBonus[effect.damageType] ?? 0) + effect.value * times
        } else {
          if (!(effect.damageType in elementBonus)) elementOrder.push(effect.damageType)
          elementBonus[effect.damageType] = (elementBonus[effect.damageType] ?? 0) + effect.value * times
        }
    }
  }

  // mods and the arcane use the same stat text, so they go through the same parser
  const upgrades = [
    ...mods.map(({ mod, rank, conditionalStacks }) => ({ name: mod.name, levelStats: mod.levelStats, rank, conditionalStacks })),
    ...(arcane ? [{ name: arcane.arcane.name, levelStats: arcane.arcane.levelStats, rank: arcane.rank, conditionalStacks: arcane.conditionalStacks, isArcane: true }] : []),
  ]
  for (const upgrade of upgrades) {
    const parsed = parseUpgrade(upgrade.levelStats, upgrade.rank)
    // arcane elements (Melee Exposure) are separate elements, see separateElements
    const apply = (effect: ModEffect, times: number) => {
      if ('isArcane' in upgrade && effect.kind === 'damageType' && !PHYSICAL_TYPES.includes(effect.damageType)) {
        separateElements[effect.damageType] = (separateElements[effect.damageType] ?? 0) + effect.value * times
      } else applyEffect(effect, times)
    }
    parsed.effects.forEach((effect) => apply(effect, 1))
    for (const conditional of parsed.conditionals) {
      const activeStacks = Math.min(upgrade.conditionalStacks, conditional.maxStacks)
      if (activeStacks > 0) apply(conditional.effect, activeStacks)
    }
    unparsed.push(...parsed.unparsed.map((line) => `${upgrade.name}: ${line}`))
  }

  // ---- weapon passives (hand-kept table, see src/data/passives.ts) ----
  // mod-like parts go through applyEffect, the rest gets collected here and used further down
  const passiveFlat = { critChance: 0, statusChance: 0 }
  let critPerStatusType = 0 // Galariak Prime, flat after mods
  let damagePerStatusTypePassive = 0 // Cedo, additive with damage mods
  let finalCritMultiplierBonus = 0 // Knell
  const statusDurationByType: Record<string, number> = {} // '*' = every DoT
  let critOverride: { chance: number; critChance: number } | null = null // Gotva Prime
  let statusOverride: { chance: number; statusChance: number } | null = null // Sagek Prime
  let fireRateMultiplier = 1 // Lesion, multiplies with attack speed mods
  let reloadOverride: number | null = null // Reconifex perfect reload
  let detonatesDots = false // Harmony
  const passiveBase = { critChance: 0, statusChance: 0 } // Tekko with Atlas
  let magazineMultiplier = 1 // Pyrana Prime
  const activePassives: string[] = []
  for (const { passive, stacks: chosenStacks } of passives) {
    if (passive.attacks && !passive.attacks.test(attack.name)) continue
    const times = passive.condition ? Math.min(chosenStacks, passive.maxStacks ?? 1) : 1
    if (times <= 0) continue
    activePassives.push(passive.name)
    for (const effect of passive.effects) {
      switch (effect.kind) {
        case 'mod':
          applyEffect(effect.effect, times)
          break
        case 'flat':
          passiveFlat[effect.stat] += effect.value * times
          break
        case 'flatPerStatusType':
          critPerStatusType += effect.value * times
          break
        case 'damagePerStatusType':
          damagePerStatusTypePassive += effect.value * times
          break
        case 'finalCritMultiplier':
          finalCritMultiplierBonus += effect.value * times
          break
        case 'statusDuration':
          for (const damageType of effect.types ?? ['*']) {
            statusDurationByType[damageType] = (statusDurationByType[damageType] ?? 0) + effect.value * times
          }
          break
        case 'nextHitCritOverride':
          critOverride = effect
          break
        case 'nextHitStatusOverride':
          statusOverride = effect
          break
        case 'fireRateMultiplier':
          fireRateMultiplier *= (1 + effect.value) ** times
          break
        case 'reloadTime':
          reloadOverride = effect.seconds
          break
        case 'heavyDetonatesDots':
          detonatesDots = true
          break
        case 'base':
          passiveBase[effect.stat] += effect.value * times
          break
        case 'separateElement':
          separateElements[effect.damageType] = (separateElements[effect.damageType] ?? 0) + effect.value * times
          break
        case 'magazineMultiplier':
          magazineMultiplier *= effect.value
          break
        case 'forcedProc':
          forcedProcsPerPellet[effect.damageType] = (forcedProcsPerPellet[effect.damageType] ?? 0) + effect.procsPerHit * times
      }
    }
  }

  // ---- melee combo (wiki Melee_Combo / Heavy_Attack) ----
  // the multiplier only changes damage on heavy attacks/heavy slams. Blood Rush, Weeping Wounds and the Gladiator
  // set read it on every melee attack: bonus x (multiplier - 1), added in with the other crit/status mods.
  // heavies read the combo before they spend it, so a 12x heavy gets the 12x Blood Rush bonus
  const isMelee = weapon.category === 'Melee'
  const isHeavy = isMelee && Boolean(attack.heavy)
  const combo = isMelee ? Math.min(maxComboFor(weapon.name), Math.max(1, buffs.combo ?? 1)) : 1
  const comboSteps = combo - 1
  const gladiatorPieces = Math.min(
    GLADIATOR_MAX_PIECES,
    mods.filter(({ mod }) => mod.name.startsWith('Gladiator ')).length + (buffs.gladiatorWarframePieces ?? 0),
  )
  const critFromCombo = isMelee ? (bonus.critChancePerCombo + GLADIATOR_CRIT_PER_PIECE * gladiatorPieces) * comboSteps : 0
  const statusFromCombo = isMelee ? bonus.statusChancePerCombo * comboSteps : 0
  // Killing Blow style "Melee Damage on Heavy Attack" just adds to the damage mods
  if (isHeavy) bonus.damage += bonus.heavyDamage
  const heavyComboFactor = isHeavy ? combo : 1

  // ---- Kuva / Tenet / Coda bonus element: an innate element worth X% of base damage ----
  if (bonusElement && bonusElement.value > 0 && hasBonusElement(weapon.name)) {
    const extra = sum(Object.values(attack.damage)) * bonusElement.value
    attack = { ...attack, damage: { ...attack.damage, [bonusElement.damageType]: (attack.damage[bonusElement.damageType] ?? 0) + extra } }
  }

  // ---- Incarnon evolution perks ----
  // base stats go onto the weapon before mods, mod-like lines go through applyEffect like any mod
  const isIncarnonAttack = /incarnon/i.test(attack.name)
  const perkBase = { damage: 0, critChance: 0, critMultiplier: 0, statusChance: 0, multishot: 0 }
  const perkFlat = { critChance: 0, statusChance: 0 }
  let nonCritChanceBonus = 0 // expected extra damage on non-crits (chance x bonus)
  let armorStripPerPuncture = 0
  for (const { perk, stacks: perkStacks } of incarnonPerks) {
    for (const statement of perk.statements) {
      if (!statement.effect || !perkAppliesTo(statement.mode, isIncarnonAttack, weapon.category === 'Melee')) continue
      const times = statement.condition ? Math.min(perkStacks, statement.maxStacks) : 1
      if (times <= 0) continue
      const effect = statement.effect
      if (effect.kind === 'base') perkBase[effect.stat] += effect.value * times
      else if (effect.kind === 'flat') perkFlat[effect.stat] += effect.value * times
      else if (effect.kind === 'mod') applyEffect(effect.effect, times)
      else if (effect.kind === 'nonCritBonus') nonCritChanceBonus += effect.chance * effect.value
      else armorStripPerPuncture += effect.value
    }
    for (const statement of perk.statements) {
      if (!statement.effect && /Damage|Critical|Status|Multishot|Fire Rate|Attack Speed/.test(statement.text)) {
        unparsed.push(`${perk.name}: ${statement.text}`)
      }
    }
  }
  // "+N Base Damage" grows every damage type by the same proportion
  const unmoddedBase = sum(Object.values(attack.damage))
  const baseDamageScale = unmoddedBase > 0 ? (unmoddedBase + perkBase.damage) / unmoddedBase : 1
  attack = {
    ...attack,
    damage: Object.fromEntries(Object.entries(attack.damage).map(([damageType, amount]) => [damageType, amount * baseDamageScale])),
    critChance: attack.critChance + perkBase.critChance + passiveBase.critChance,
    critMultiplier: attack.critMultiplier + perkBase.critMultiplier,
    statusChance: attack.statusChance + perkBase.statusChance + passiveBase.statusChance,
  }
  weapon = { ...weapon, multishot: (attack.multishot ?? weapon.multishot) + perkBase.multishot }

  // ---- 2. damage type proportions + quantization ----
  const baseDamage = sum(Object.values(attack.damage))
  const proportions: Record<string, number> = {}
  const addProportion = (damageType: string, amount: number) => {
    proportions[damageType] = (proportions[damageType] ?? 0) + amount
  }

  for (const damageType of PHYSICAL_TYPES) {
    const base = attack.damage[damageType] ?? 0
    if (base > 0) addProportion(damageType, (base / baseDamage) * (1 + (physicalBonus[damageType] ?? 0)))
  }

  // element mods are a % of the full base damage. innate primary elements go to the
  // end of the combine queue, innate combined elements just pass through.
  const elementAmounts: Record<string, number> = {}
  const combineQueue = [...elementOrder]
  for (const damageType of elementOrder) elementAmounts[damageType] = elementBonus[damageType]
  for (const [damageType, base] of Object.entries(attack.damage)) {
    if (PHYSICAL_TYPES.includes(damageType)) continue
    if (!(damageType in elementAmounts)) combineQueue.push(damageType)
    elementAmounts[damageType] = (elementAmounts[damageType] ?? 0) + base / baseDamage
  }
  const primaryQueue = combineQueue.filter((damageType) => PRIMARY_ELEMENTS.includes(damageType))
  for (const damageType of combineQueue) {
    if (!PRIMARY_ELEMENTS.includes(damageType)) addProportion(damageType, elementAmounts[damageType])
  }
  for (let i = 0; i < primaryQueue.length; i += 2) {
    const first = primaryQueue[i]
    const second = primaryQueue[i + 1]
    if (!second) addProportion(first, elementAmounts[first])
    else addProportion(COMBINED_ELEMENTS[[first, second].sort().join('+')], elementAmounts[first] + elementAmounts[second])
  }
  // passive elements that skip combining (Tonkkatt's heat stays heat)
  for (const [damageType, amount] of Object.entries(separateElements)) addProportion(damageType, amount)

  // which status types the target has, for CO / Galvanized. by default it's the build's own damage types
  // (base physical + modded elements), so a gun can't count statuses it never applies
  const buildStatusTypes = attack.statusChance > 0
    ? Object.entries(proportions).filter(([damageType, proportion]) => damageType !== 'true' && quantize(proportion) > 0).length
    : 0
  const activeStatusTypes =
    (debuffs.statusTypeSource === 'debuffs' ? debuffStatusTypes : buildStatusTypes) + (debuffs.liftedOrKnockedDown ? 1 : 0)
  // Cedo: +60% per status type, in with the damage mods (not CO-style)
  bonus.damage += damagePerStatusTypePassive * activeStatusTypes

  // Condition Overload style bonuses (CO, Galvanized per-status, Secondary Shiver per Cold stack).
  // additive weapons: base x [(1 + mods) x other multipliers + CO]
  // multiplicative weapons: base x (1 + mods) x (1 + CO) x other multipliers
  const co = coBehavior ?? resolveCoBehavior(weapon, attack)
  const coBonus =
    co.mode === 'none'
      ? 0
      : (bonus.damagePerStatusType * activeStatusTypes + bonus.damagePerColdStack * Math.min(stacks('cold'), 10)) * co.scale
  const damageScale =
    co.mode === 'multiply'
      ? (1 + bonus.damage) * (1 + coBonus) * separateDamageMultiplier
      : (1 + bonus.damage) * separateDamageMultiplier + coBonus

  // heavy: [base x (1 + damage mods) x elements] x heavy multiplier x combo. the heavy multiplier is already in the
  // Heavy Attack's base damage (build-data), the combo multiplies everything, CO included
  const moddedBaseDamage = baseDamage * damageScale * heavyComboFactor

  // each final type (sums included) is quantized on its own, then scaled by modded base damage
  const moddedByType: Record<string, number> = {}
  for (const [damageType, proportion] of Object.entries(proportions)) {
    const quantized = quantize(proportion) * moddedBaseDamage
    if (quantized > 0) moddedByType[damageType] = quantized
  }

  // ---- 3. crit, faction, multishot, fire rate ----
  // Puncture and Cold add flat after mods, and don't apply to AoE
  // AoE can't headshot. weak point crit chance (Primary Acuity, Cascadia Accuracy) only counts on headshots
  const isHeadshot = target.headshot && !attack.isAoE
  // null/undefined = follow the faction, so stale or missing settings can't silently turn headcrits off
  const headMultiplier = target.headshotMultiplier ?? headMultiplierFor(target.faction)
  const headcrit = target.headcrit ?? hasHeadcrits(target.faction)
  const weakpointCritBonus = isHeadshot ? bonus.weakpointCritChance : 0
  const critChance =
    attack.critChance * (1 + bonus.critChance + weakpointCritBonus + critFromCombo + (isHeavy ? bonus.heavyCritChance : 0)) +
    perkFlat.critChance + passiveFlat.critChance + critPerStatusType * activeStatusTypes +
    (attack.isAoE ? 0 : punctureCritChanceBonus(stacks('puncture')))
  // headcrit doubles the weapon's *base* crit multiplier, so mods scale it but Cold's flat bonus doesn't
  const headcritFactor = isHeadshot && headcrit ? HEADCRIT_MULTIPLIER : 1
  const critMultiplier =
    attack.critMultiplier * headcritFactor * (1 + bonus.critDamage) + finalCritMultiplierBonus +
    (attack.isAoE ? 0 : coldCritMultiplierBonus(stacks('cold')))
  // over 100% the lowest tier is the "normal" hit and the next tier up is the "crit" (Damage/Calculation 4.3)
  const normalCritMultiplier = 1 + Math.floor(critChance) * (critMultiplier - 1)
  const critHitMultiplier = 1 + Math.ceil(critChance) * (critMultiplier - 1)
  // status chance before Sagek's override, Gotva needs it here
  const rawStatusChance =
    attack.statusChance * (1 + bonus.statusChance + statusFromCombo) + perkFlat.statusChance + passiveFlat.statusChance +
    tauStatusChanceBonus(stacks('tau'))
  // Gotva Prime: a hit after a status proc has a chance to roll at a fixed crit chance instead
  const superCritShare = critOverride ? Math.min(1, rawStatusChance) * critOverride.chance : 0
  const superCritMultiplier = critOverride ? 1 + critOverride.critChance * (critMultiplier - 1) : 1
  const averageCritMultiplier = (1 - superCritShare) * (1 + critChance * (critMultiplier - 1)) + superCritShare * superCritMultiplier
  // Devouring Attrition style: non-crit hits have a chance at a huge bonus. only matters below 100% crit
  const attritionBonus = Math.max(0, 1 - critChance) * nonCritChanceBonus

  const factionMultiplier = 1 + factionBonus
  // Acuity: multishot mods/arcanes don't apply, the weapon keeps its base (Incarnon base multishot perks still count)
  const multishot = weapon.category === 'Melee' ? 1 : weapon.multishot * (multishotLocked ? 1 : 1 + bonus.multishot)
  // charged attacks (wiki Damage/Calculation): effective rate = 1 / (charge time + 1 / fire rate), and fire rate
  // mods also speed up the charge (modded charge time = base / (1 + speed bonuses))
  const fireRateBonus = fireRateLocked ? 0 : bonus.fireRate
  const moddedFireRate = attack.fireRate * (1 + fireRateBonus) * fireRateMultiplier
  // heavy attacks: attack speed only speeds up the swing, wind-up only gets faster from Wind Up Speed mods
  // (wiki Attack_Speed). I treat one heavy as wind-up + one swing at the attack speed, an estimate since the
  // data doesn't have per-weapon swing lengths
  const windUp = isHeavy && attack.windUp ? attack.windUp / Math.max(0.01, 1 + bonus.heavyWindUpSpeed) : null
  const fireRate = windUp !== null
    ? 1 / (windUp + 1 / moddedFireRate)
    : attack.chargeTime
      ? 1 / (attack.chargeTime / Math.max(0.01, 1 + fireRateBonus) + 1 / moddedFireRate)
      : moddedFireRate

  // ---- 4. target modifiers ----
  // Latron's Flensing Spikes: each Puncture stack strips another 20% of armor
  const armorAfter = effectiveArmor(armor, debuffs) * Math.max(0, 1 - armorStripPerPuncture * Math.min(stacks('puncture'), 5))
  const armorMultiplier = armorDamageMultiplier(armorAfter)
  const factionWeakness = FACTION_DAMAGE_MODIFIERS[target.faction] ?? {}

  // per damage type multiplier vs the chosen layer. toxin skips shields and hits health.
  // slash DoT bypasses armor, true damage always does.
  const typeMultiplier = (damageType: string, bypassArmor = false): number => {
    const weakness = factionWeakness[damageType] ?? 1
    const layer = target.layer === 'shield' && damageType === 'toxin' ? 'health' : target.layer
    if (layer === 'overguard') return magneticMultiplier(stacks('magnetic')) * overguardMultiplier
    if (layer === 'shield') return weakness * magneticMultiplier(stacks('magnetic'))
    const armorPart = bypassArmor || damageType === 'true' ? 1 : armorMultiplier
    return weakness * armorPart * viralMultiplier(stacks('viral'))
  }

  // Weak_Point: (head multiplier + 1.5 x weak point damage bonuses) x (1 + headshot multiplier bonuses)
  const weakPointMultiplier = headMultiplier + WEAK_POINT_BONUS_RATE_ON_HEAD * bonus.weakpointDamage
  const headshotFactor = isHeadshot ? weakPointMultiplier * (1 + bonus.headshotMultiplier) : 1
  const sharedMultiplier = (1 + debuffs.damageVulnerability) * headshotFactor

  const vsTargetNoCrit = sum(
    Object.entries(moddedByType).map(([damageType, amount]) => amount * typeMultiplier(damageType)),
  ) * factionMultiplier * sharedMultiplier

  const hit = {
    normal: vsTargetNoCrit * normalCritMultiplier,
    crit: vsTargetNoCrit * critHitMultiplier,
    average: vsTargetNoCrit * (averageCritMultiplier + attritionBonus),
  }
  const averageShot = hit.average * multishot
  const burstDps = averageShot * fireRate

  // ---- 5. status procs + DoTs ----
  // Sagek Prime: a shot after a crit has a chance to roll at a fixed status chance instead
  const statusOverrideShare = statusOverride ? Math.min(1, critChance) * statusOverride.chance : 0
  const statusChance = statusOverride
    ? (1 - statusOverrideShare) * rawStatusChance + statusOverrideShare * statusOverride.statusChance
    : rawStatusChance
  const pelletsPerSecond = multishot * fireRate
  const procsPerSecond = statusChance * pelletsPerSecond
  // proc weighting skips the separate elements (Melee Exposure etc.), they add damage but no proc share
  const procWeight: Record<string, number> = {}
  for (const [damageType, modded] of Object.entries(moddedByType)) {
    procWeight[damageType] = Math.max(0, modded - quantize(separateElements[damageType] ?? 0) * moddedBaseDamage)
  }
  const procWeightTotal = sum(Object.values(procWeight))
  const procShare = (damageType: string) => (procWeightTotal > 0 ? (procWeight[damageType] ?? 0) / procWeightTotal : 0)

  const procRates: Record<string, number> = {}
  for (const damageType of Object.keys(moddedByType)) procRates[damageType] = procsPerSecond * procShare(damageType)
  // Hunter Munitions: chance per crit, so it caps once every pellet crits
  procRates.slash = (procRates.slash ?? 0) + Math.min(critChance, 1) * slashOnCritChance * pelletsPerSecond
  // Internal Bleeding: doubled when fire rate is below 2.5
  procRates.slash += (procRates.impact ?? 0) * slashOnImpactChance * (fireRate < 2.5 ? 2 : 1)
  // guaranteed procs ride on every pellet, on top of the status chance rolls
  for (const [damageType, perPellet] of Object.entries(forcedProcsPerPellet)) {
    procRates[damageType] = (procRates[damageType] ?? 0) + perPellet * pelletsPerSecond
  }

  // procs inherit the crit of the hit that applied them, so I keep the normal/crit/average split.
  // modded base here is NOT quantized and uses the full base damage, not just that element's share.
  // procs carry the CO bonus from the hit that applied them (wiki: Blast/Electricity/Gas carry it into their radius)
  const statusBase = baseDamage * damageScale * heavyComboFactor * factionMultiplier
  const critSplit = (value: number): CritSplit => ({
    normal: value * normalCritMultiplier,
    crit: value * critHitMultiplier,
    average: value * averageCritMultiplier,
  })
  const scaleSplit = (split: CritSplit, factor: number): CritSplit => ({
    normal: split.normal * factor,
    crit: split.crit * factor,
    average: split.average * factor,
  })

  const dots: DotRow[] = Object.entries(DOT_STATUSES)
    .filter(([damageType]) => (procRates[damageType] ?? 0) > 0)
    .map(([damageType, info]) => {
      const elementMultiplier = info.usesElementMods ? 1 + (elementBonus[damageType] ?? 0) : 1
      const headshotPart = !isHeadshot ? 1 : info.fullHeadshot ? headshotFactor : 1 + bonus.headshotMultiplier
      const beforeCrit =
        info.fraction * statusBase * elementMultiplier * factionMultiplier * (1 + bonus.statusDamage) *
        (1 + debuffs.damageVulnerability) * headshotPart
      const tick = critSplit(beforeCrit * typeMultiplier(damageType, info.bypassesArmor))
      // Status Duration stretches the DoT, at one tick per second that's more ticks (wiki Status_Duration).
      // Blast is a single hit so it doesn't care
      const durationScale = 1 + bonus.statusDuration + (statusDurationByType['*'] ?? 0) + (statusDurationByType[damageType] ?? 0)
      const ticks = info.ticks > 1 ? Math.max(1, Math.floor(info.ticks * durationScale + 1e-9)) : info.ticks
      const perProc = scaleSplit(tick, ticks)

      let aoe: DotRow['aoe'] = null
      if (damageType === 'blast') {
        // the explosion hits *other* enemies, so the target's armor/viral/vulnerability don't apply,
        // just the faction weakness (assuming they're the same faction)
        const detonationBase = (beforeCrit / (1 + debuffs.damageVulnerability)) * (BLAST_DETONATION_MULTIPLIER / info.fraction)
        aoe = { label: '10-stack AoE', damage: critSplit(detonationBase * (factionWeakness.blast ?? 1)) }
      }
      return {
        damageType,
        procsPerSecond: procRates[damageType],
        tick,
        ticks,
        perProc,
        dps: perProc.average * procRates[damageType],
        aoe,
        note: info.note,
      }
    })
  const dotDps = sum(dots.map((dot) => dot.dps))

  // ---- 6. magazine + reload (wiki Damage/Calculation, Reload_Speed) ----
  // melee has no magazine, and Incarnon forms run on Incarnon charge which the data doesn't have, so neither reloads here
  const reloads = weapon.category !== 'Melee' && !isIncarnonAttack && Boolean(weapon.magazineSize) && Boolean(weapon.reloadTime)
  const magazineSize = reloads ? Math.max(1, Math.round(weapon.magazineSize! * (1 + bonus.magazineCapacity) * magazineMultiplier)) : null
  // shell-by-shell weapons (Felarx, Strun, Corinth...): (start/end delay + per shell x magazine) / (1 + reload speed),
  // so magazine mods make the reload longer
  const shellReload = SHELL_BY_SHELL_RELOAD[weapon.name]
  const reloadSpeedScale = Math.max(0.01, 1 + bonus.reloadSpeed)
  const reloadTime = !reloads
    ? null
    : reloadOverride ?? (shellReload ? (shellReload.delay + shellReload.perShell * magazineSize!) : weapon.reloadTime!) / reloadSpeedScale
  const uptime = magazineSize && reloadTime ? magazineSize / (fireRate * reloadTime + magazineSize) : 1
  const steadyStateDps = (burstDps + dotDps) * uptime

  // shots over time with procs on their own clocks (src/calc/simulate.ts)
  const pelletsPerSecondForModel = multishot * fireRate
  const shotModel: ShotModel = {
    fireRate,
    multishot,
    magazineSize,
    reloadTime,
    hit,
    critChance,
    instantDots: detonatesDots,
    dots: dots.map((dot) => ({
      damageType: dot.damageType,
      procsPerPellet: pelletsPerSecondForModel > 0 ? dot.procsPerSecond / pelletsPerSecondForModel : 0,
      tick: dot.damageType === 'blast' ? dot.perProc : dot.tick,
      ticks: dot.damageType === 'blast' ? 1 : dot.ticks,
      firstTickAt: dot.damageType === 'blast' ? 1.5 : dot.damageType === 'electricity' || dot.damageType === 'gas' ? 0 : 1,
      refreshes: dot.damageType === 'heat',
    })),
  }
  const damageInWindow = (seconds: number) => expectedDamage(shotModel, seconds)
  const simulateWindows = (windows: number[], runs?: number) => simulateDamage(shotModel, windows, runs)
  const sustainedDps = damageInWindow(SUSTAINED_FIGHT_SECONDS) / SUSTAINED_FIGHT_SECONDS

  // Harmony: the heavy's own procs land all their ticks at once, plus every Slash/Heat/Toxin/Electricity/Gas stack
  // already on the target (from the Debuffs panel). those were put there by normal swings, so I scale the heavy's
  // proc damage back down by the heavy multiplier and combo
  let detonation: CalcResult['detonation'] = null
  if (detonatesDots) {
    const normalSwingScale = 1 / ((attack.heavyMultiplier ?? 1) * heavyComboFactor)
    let ownProcs = 0
    let existingStacks = 0
    for (const dot of dots) {
      if (dot.damageType === 'blast') continue
      ownProcs += (dot.procsPerSecond / fireRate) * dot.perProc.average
      existingStacks += stacks(dot.damageType) * dot.perProc.average * normalSwingScale
    }
    // stacks of types this heavy doesn't proc itself still detonate, using the same per-proc math
    for (const damageType of ['slash', 'heat', 'toxin', 'electricity', 'gas']) {
      if (stacks(damageType) <= 0 || dots.some((dot) => dot.damageType === damageType)) continue
      const info = DOT_STATUSES[damageType]
      const elementMultiplier = info.usesElementMods ? 1 + (elementBonus[damageType] ?? 0) : 1
      const durationScale = 1 + bonus.statusDuration + (statusDurationByType['*'] ?? 0) + (statusDurationByType[damageType] ?? 0)
      const perProc =
        info.fraction * statusBase * elementMultiplier * factionMultiplier * (1 + bonus.statusDamage) * (1 + debuffs.damageVulnerability) *
        typeMultiplier(damageType, info.bypassesArmor) * averageCritMultiplier * Math.floor(info.ticks * durationScale + 1e-9)
      existingStacks += stacks(damageType) * perProc * normalSwingScale
    }
    detonation = { ownProcs, existingStacks }
  }

  const damageTypes = Object.entries(moddedByType)
    .map(([damageType, modded]) => ({
      damageType,
      modded,
      vsTarget: modded * typeMultiplier(damageType) * factionMultiplier * sharedMultiplier * (averageCritMultiplier + attritionBonus),
      procShare: procShare(damageType),
    }))
    .sort((a, b) => b.modded - a.modded)

  return {
    damageTypes,
    moddedBaseDamage,
    critChance,
    critMultiplier,
    critTier: Math.ceil(critChance),
    statusChance,
    multishot,
    multishotLocked,
    fireRate,
    factionMultiplier,
    activeStatusTypes,
    conditionOverload: { mode: co.mode, bonus: coBonus, source: co.source, note: co.note },
    headshot: {
      applied: isHeadshot,
      factor: headshotFactor,
      weakPointMultiplier,
      headshotBonus: bonus.headshotMultiplier,
      headcrit: isHeadshot && headcrit,
    },
    armor: { before: armor, after: armorAfter, damageMultiplier: armorMultiplier },
    hit,
    averageShot,
    burstDps,
    procsPerSecond,
    dots,
    dotDps,
    totalDps: burstDps + dotDps,
    magazineSize,
    reloadTime,
    uptime,
    sustainedDps,
    steadyStateDps,
    shellByShell: Boolean(shellReload) && reloads,
    damageInWindow,
    simulateWindows,
    shotModel,
    fireRateLocked,
    passives: activePassives,
    detonation,
    melee: isMelee
      ? {
          combo,
          heavy: isHeavy,
          critFromCombo,
          statusFromCombo,
          windUp,
          comboAfterHeavy: isHeavy ? comboAfterSpending(weapon.name, combo, bonus.heavyEfficiency) : null,
        }
      : null,
    statusTypeSource: debuffs.statusTypeSource === 'debuffs' ? 'debuffs' : 'build',
    unparsed,
  }
}

// Heavy Attack Efficiency keeps that share of the combo *count* (not the multiplier), capped at 90%.
// wiki example: 40% at 160 hits (9x) leaves 64 hits (4x)
function comboAfterSpending(weaponName: string, combo: number, efficiency: number) {
  const perTier = hitsPerComboTier(weaponName)
  const hits = (combo - 1) * perTier
  const kept = Math.floor(hits * Math.min(MAX_HEAVY_EFFICIENCY, Math.max(0, efficiency)))
  return Math.min(maxComboFor(weaponName), 1 + Math.floor(kept / perTier))
}
