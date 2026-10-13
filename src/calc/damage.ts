// the damage pipeline, following wiki.warframe.com/w/Damage/Calculation:
//   1. proportions of each damage type vs base damage (physical/elemental mods, element combining)
//   2. quantize each type to the nearest 1/32 of base damage
//   3. x modded base damage (base x (1 + damage mods)), x faction bonus, x crit
//   4. per type: faction weakness x armor (health only) x viral/magnetic, then other vulnerabilities
// status DoTs use the same modded base, but faction applies twice and only literal element mods count.

import {
  BANE_TARGET, BLAST_DETONATION_MULTIPLIER, HEADCRIT_MULTIPLIER, WEAK_POINT_BONUS_RATE_ON_HEAD, hasHeadcrits, headMultiplierFor, COMBINED_ELEMENTS, DOT_STATUSES, FACTION_DAMAGE_MODIFIERS, PHYSICAL_TYPES, PRIMARY_ELEMENTS,
  coldCritMultiplierBonus, magneticMultiplier, punctureCritChanceBonus, tauStatusChanceBonus, viralMultiplier,
} from './constants'
import { parseUpgrade, type ModEffect, type StatKey } from './parseMod'
import { resolveCoBehavior, type CoBehavior } from './conditionOverload'
import { perkAppliesTo, type SelectedPerk } from './incarnon'
import { armorDamageMultiplier, effectiveArmor } from './target'
import type { Attack, Buffs, Debuffs, EquippedArcane, EquippedMod, TargetSettings, Weapon } from '../types'

export interface CalcInput {
  weapon: Weapon
  attack: Attack
  mods: EquippedMod[]
  arcane?: EquippedArcane | null
  coBehavior?: CoBehavior // defaults to the wiki table for this weapon/attack
  incarnonPerks?: SelectedPerk[]
  target: TargetSettings
  armor: number // target armor before debuffs (already level scaled)
  debuffs: Debuffs
  buffs: Buffs
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
  sustainedDps: number // totalDps with magazine + reload
  damageInWindow: (seconds: number) => number
  fireRateLocked: boolean
  statusTypeSource: 'build' | 'debuffs'
  unparsed: string[]
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
// rounds to the nearest 1/32, sign(x) * floor(|x| * 32 + 0.5) / 32
const quantize = (proportion: number) => (Math.sign(proportion) * Math.floor(Math.abs(proportion) * 32 + 0.5)) / 32

export function calculate({ weapon, attack, mods, arcane, coBehavior, incarnonPerks = [], target, armor, debuffs, buffs }: CalcInput): CalcResult {
  const stacks = (statusType: string) => debuffs.stacks[statusType] ?? 0
  // CO counts status *types*, not stacks. Lifted/knocked down is a hidden status that also counts
  const debuffStatusTypes = Object.values(debuffs.stacks).filter((count) => count > 0).length

  // ---- 1. collect mod effects ----
  const bonus: Record<StatKey, number> = {
    damage: 0, damagePerStatusType: 0, damagePerColdStack: 0, critChance: 0, weakpointCritChance: 0,
    critDamage: 0, multishot: 0, fireRate: 0, statusChance: 0, statusDamage: 0, headshotMultiplier: 0, weakpointDamage: 0,
    magazineCapacity: 0, reloadSpeed: 0,
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
    ...(arcane ? [{ name: arcane.arcane.name, levelStats: arcane.arcane.levelStats, rank: arcane.rank, conditionalStacks: arcane.conditionalStacks }] : []),
  ]
  for (const upgrade of upgrades) {
    const parsed = parseUpgrade(upgrade.levelStats, upgrade.rank)
    parsed.effects.forEach((effect) => applyEffect(effect, 1))
    for (const conditional of parsed.conditionals) {
      const activeStacks = Math.min(upgrade.conditionalStacks, conditional.maxStacks)
      if (activeStacks > 0) applyEffect(conditional.effect, activeStacks)
    }
    unparsed.push(...parsed.unparsed.map((line) => `${upgrade.name}: ${line}`))
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
    critChance: attack.critChance + perkBase.critChance,
    critMultiplier: attack.critMultiplier + perkBase.critMultiplier,
    statusChance: attack.statusChance + perkBase.statusChance,
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

  // which status types the target has, for CO / Galvanized. by default it's the build's own damage types
  // (base physical + modded elements), so a gun can't count statuses it never applies
  const buildStatusTypes = attack.statusChance > 0
    ? Object.entries(proportions).filter(([damageType, proportion]) => damageType !== 'true' && quantize(proportion) > 0).length
    : 0
  const activeStatusTypes =
    (debuffs.statusTypeSource === 'debuffs' ? debuffStatusTypes : buildStatusTypes) + (debuffs.liftedOrKnockedDown ? 1 : 0)

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

  const moddedBaseDamage = baseDamage * damageScale

  // each final type (sums included) is quantized on its own, then scaled by modded base damage
  const moddedByType: Record<string, number> = {}
  for (const [damageType, proportion] of Object.entries(proportions)) {
    const quantized = quantize(proportion) * moddedBaseDamage
    if (quantized > 0) moddedByType[damageType] = quantized
  }
  const moddedTotal = sum(Object.values(moddedByType))

  // ---- 3. crit, faction, multishot, fire rate ----
  // Puncture and Cold add flat after mods, and don't apply to AoE
  // AoE can't headshot. weak point crit chance (Primary Acuity, Cascadia Accuracy) only counts on headshots
  const isHeadshot = target.headshot && !attack.isAoE
  // null/undefined = follow the faction, so stale or missing settings can't silently turn headcrits off
  const headMultiplier = target.headshotMultiplier ?? headMultiplierFor(target.faction)
  const headcrit = target.headcrit ?? hasHeadcrits(target.faction)
  const weakpointCritBonus = isHeadshot ? bonus.weakpointCritChance : 0
  const critChance =
    attack.critChance * (1 + bonus.critChance + weakpointCritBonus) + perkFlat.critChance +
    (attack.isAoE ? 0 : punctureCritChanceBonus(stacks('puncture')))
  // headcrit doubles the weapon's *base* crit multiplier, so mods scale it but Cold's flat bonus doesn't
  const headcritFactor = isHeadshot && headcrit ? HEADCRIT_MULTIPLIER : 1
  const critMultiplier =
    attack.critMultiplier * headcritFactor * (1 + bonus.critDamage) + (attack.isAoE ? 0 : coldCritMultiplierBonus(stacks('cold')))
  // over 100% the lowest tier is the "normal" hit and the next tier up is the "crit" (Damage/Calculation 4.3)
  const normalCritMultiplier = 1 + Math.floor(critChance) * (critMultiplier - 1)
  const critHitMultiplier = 1 + Math.ceil(critChance) * (critMultiplier - 1)
  const averageCritMultiplier = 1 + critChance * (critMultiplier - 1)
  // Devouring Attrition style: non-crit hits have a chance at a huge bonus. only matters below 100% crit
  const attritionBonus = Math.max(0, 1 - critChance) * nonCritChanceBonus

  const factionMultiplier = 1 + factionBonus
  // Acuity: multishot mods/arcanes don't apply, the weapon keeps its base (Incarnon base multishot perks still count)
  const multishot = weapon.category === 'Melee' ? 1 : weapon.multishot * (multishotLocked ? 1 : 1 + bonus.multishot)
  // charged attacks (wiki Damage/Calculation): effective rate = 1 / (charge time + 1 / fire rate), and fire rate
  // mods also speed up the charge (modded charge time = base / (1 + speed bonuses))
  const fireRateBonus = fireRateLocked ? 0 : bonus.fireRate
  const moddedFireRate = attack.fireRate * (1 + fireRateBonus)
  const fireRate = attack.chargeTime
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
  const statusChance = attack.statusChance * (1 + bonus.statusChance) + perkFlat.statusChance + tauStatusChanceBonus(stacks('tau'))
  const pelletsPerSecond = multishot * fireRate
  const procsPerSecond = statusChance * pelletsPerSecond
  const procShare = (damageType: string) => (moddedTotal > 0 ? (moddedByType[damageType] ?? 0) / moddedTotal : 0)

  const procRates: Record<string, number> = {}
  for (const damageType of Object.keys(moddedByType)) procRates[damageType] = procsPerSecond * procShare(damageType)
  // Hunter Munitions: chance per crit, so it caps once every pellet crits
  procRates.slash = (procRates.slash ?? 0) + Math.min(critChance, 1) * slashOnCritChance * pelletsPerSecond
  // Internal Bleeding: doubled when fire rate is below 2.5
  procRates.slash += (procRates.impact ?? 0) * slashOnImpactChance * (fireRate < 2.5 ? 2 : 1)

  // procs inherit the crit of the hit that applied them, so I keep the normal/crit/average split.
  // modded base here is NOT quantized and uses the full base damage, not just that element's share.
  // procs carry the CO bonus from the hit that applied them (wiki: Blast/Electricity/Gas carry it into their radius)
  const statusBase = baseDamage * damageScale * factionMultiplier
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
      const perProc = scaleSplit(tick, info.ticks)

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
        ticks: info.ticks,
        perProc,
        dps: perProc.average * procRates[damageType],
        aoe,
        note: info.note,
      }
    })
  const dotDps = sum(dots.map((dot) => dot.dps))

  // ---- 6. magazine + reload (wiki Damage/Calculation, Sustained DPS) ----
  // sustained = burst x shots per mag / (fire rate x reload + shots per mag). melee has no magazine, and
  // Incarnon forms run on Incarnon charge which the data doesn't have, so neither reloads here
  const reloads = weapon.category !== 'Melee' && !isIncarnonAttack && Boolean(weapon.magazineSize) && Boolean(weapon.reloadTime)
  const magazineSize = reloads ? Math.max(1, Math.round(weapon.magazineSize! * (1 + bonus.magazineCapacity))) : null
  const reloadTime = reloads ? weapon.reloadTime! / Math.max(0.01, 1 + bonus.reloadSpeed) : null
  const uptime = magazineSize && reloadTime ? magazineSize / (fireRate * reloadTime + magazineSize) : 1
  const sustainedDps = (burstDps + dotDps) * uptime

  // damage dealt in the first `seconds`: first shot at t = 0, a full magazine, then a reload, repeat.
  // DoT procs count the part of their duration that fits in the window (Blast pops after its 1.5s fuse).
  // tight loop on purpose, the optimizer calls this thousands of times per attack
  const shotInterval = 1 / fireRate
  let tickingDotPerShot = 0 // damage per shot from Slash/Heat/Toxin/Electricity/Gas procs over their full 6s
  let blastPerShot = 0
  for (const dot of dots) {
    const perShot = (dot.procsPerSecond / fireRate) * dot.perProc.average
    if (dot.damageType === 'blast') blastPerShot += perShot
    else tickingDotPerShot += perShot
  }
  const damageInWindow = (seconds: number) => {
    let total = 0
    let time = 0
    let roundsLeft = magazineSize ?? Infinity
    for (let shots = 0; time < seconds && shots < 200000; shots++) {
      const remaining = seconds - time
      total += averageShot + tickingDotPerShot * Math.min(1, remaining / 6) + (remaining >= 1.5 ? blastPerShot : 0)
      time += shotInterval
      if (--roundsLeft <= 0 && reloadTime) {
        time += reloadTime
        roundsLeft = magazineSize!
      }
    }
    return total
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
    damageInWindow,
    fireRateLocked,
    statusTypeSource: debuffs.statusTypeSource === 'debuffs' ? 'debuffs' : 'build',
    unparsed,
  }
}
