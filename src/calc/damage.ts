// the damage pipeline, following wiki.warframe.com/w/Damage/Calculation:
//   1. proportions of each damage type vs base damage (physical/elemental mods, element combining)
//   2. quantize each type to the nearest 1/32 of base damage
//   3. x modded base damage (base x (1 + damage mods)), x faction bonus, x crit
//   4. per type: faction weakness x armor (health only) x viral/magnetic, then other vulnerabilities
// status DoTs use the same modded base, but faction applies twice and only literal element mods count.

import {
  AMMO_EFFICIENCY_CAP, BANE_TARGET, BLAST_DETONATION_MULTIPLIER, CAPPED_STATUS_STACKS, GLADIATOR_CRIT_PER_PIECE, GLADIATOR_MAX_PIECES, MAX_HEAVY_EFFICIENCY, hitsPerComboTier, maxComboFor, HEADCRIT_MULTIPLIER, WEAK_POINT_BONUS_RATE_ON_HEAD, hasHeadcrits, headMultiplierFor, COMBINED_ELEMENTS, DAMAGE_TYPES, DOT_STATUSES, FACTION_DAMAGE_MODIFIERS, PHYSICAL_TYPES, PRIMARY_ELEMENTS,
  coldCritMultiplierBonus, magneticMultiplier, punctureCritChanceBonus, tauStatusChanceBonus, viralMultiplier,
} from './constants'
import { parseUpgrade, scopeApplies, type ModEffect, type StatKey } from './parseMod'
import { arcanesById } from '../data'
import { exaltedRuleFor } from '../data/exalted'
import { NIRA_SLAM_PER_PIECE, VIGILANTE_ENHANCE_PER_PIECE, addPieces, countSets, setEnhancement, setSummary } from './modSets'
import { resolveCoBehavior, type CoBehavior } from './conditionOverload'
import { perkAppliesTo, type PerkEffect, type SelectedPerk } from './incarnon'
import { armorDamageMultiplier, effectiveArmor } from './target'
import { hasBonusElement, type BonusElement, type WeaponPassive } from '../data/passives'
import { SHELL_BY_SHELL_RELOAD } from '../data/reloads'
import { abilitiesById, abilityApplies, castStacks, effectsFor, scaledValue, strengthFor, type AbilityCast } from '../data/warframeAbilities'
import { biggestHit, comboTotal, heavyComboFor, type HeavyCombo, type HeavyMode } from '../data/heavyAttacks'
import { expectedDamage, simulateDamage, type DamageRange, type ShotModel } from './simulate'

// "sustained" = average DPS over a fight this long: reloads, DoT ramp-up and Heat stacking count, and DoT ticks
// after the fight ends don't (so long Status Duration tails stop inflating it)
export const SUSTAINED_FIGHT_SECONDS = 10 // about how long one tough enemy lives; Heat stacks die with it
// the DoTs a beam's merged tick feeds twice (wiki Multishot)
const BEAM_MERGED_DOTS = ['slash', 'heat', 'toxin', 'electricity', 'blast', 'gas'] // wiki Multishot's list, Blast included
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
  heavyMode?: HeavyMode // multi-hit heavies: score the biggest hit (default) or every hit added up
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
  // what the tick is made of (the formula panel), tick = fraction x statusBase x element x faction x (1 + status damage)
  // x (1 + vulnerability) x headshot x merged x type, crits on top
  factors: {
    fraction: number; statusBase: number; element: number; faction: number; statusDamage: number; vulnerability: number
    headshot: number; merged: number; type: number
  }
}

// the factors behind one hit (the formula panel). hit.average = (sum of modded x type + extraHit) x faction x
// (1 + vulnerability) x headshot x (critAverage + attrition)
// one piece of a damage type's share of base damage
export type TypePart =
  | { kind: 'physical'; base: number; mod: number } // base share x (1 + IPS mods)
  | { kind: 'element'; element: string; mod: number; innate: number } // element mods (% of all base) + innate share
  | { kind: 'separate'; source: 'passive' | 'ability'; value: number } // doesn't combine (Tonkkatt, Freeze Force)

export interface HitBreakdown {
  baseDamage: number
  damageBonus: number // damage mods (Serration...), as a fraction
  separateMultiplier: number // Sharpshot, slam/throw bonuses, exalted finals...
  coMode: 'add' | 'multiply' | 'none'
  coBonus: number
  heavyCombo: number // heavy attack / exalted combo multiplier, 1 otherwise
  damageScale: number
  types: { damageType: string; share: number; modded: number; type: number; weakness: number; armor: number; debuff: number; debuffName: string }[] // share = quantized fraction of base
  // where each type's share comes from, for the formula panel: raw = before quantizing, parts add up to raw
  typeParts: { damageType: string; raw: number; parts: TypePart[] }[]
  extraHit: number // Xata's Whisper style separate hits (faction already in)
  faction: number
  vulnerability: number
  headshot: number
  critChance: number
  critMultiplier: number
  critAverage: number
  critNormal: number
  critHit: number
  attrition: number
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
  beam: boolean // multishot beams merge into one tick (wiki Multishot)
  beamMerge: number // beams per merged tick (multishot on a beam, 1 otherwise): one instance = hit x beamMerge
  multishotModsIgnored: boolean // hitscan explosion / beam blast / speargun throw
  fireRate: number
  factionMultiplier: number
  activeStatusTypes: number
  conditionOverload: { mode: CoBehavior['mode']; bonus: number; source: CoBehavior['source']; note?: string }
  headshot: { applied: boolean; factor: number; weakPointMultiplier: number; headshotBonus: number; headcrit: boolean }
  armor: { before: number; after: number; damageMultiplier: number }
  hit: { normal: number; crit: number; average: number } // per projectile vs target
  // the biggest single damage instance this attack can land: top crit tier (or a Devouring Attrition non-crit if that's
  // bigger), a beam's merged tick. what matters for the 32-bit damage limit. DoT ticks are their own instances
  peakHit: number
  peakDotTick: { damageType: string; value: number } | null
  averageShot: number
  attackTotal: number // one attack: every pellet/duplicate + the full DoT of its procs
  duplicateStrikes: number // Melee Duplicate: average strikes per attack (1 without it)
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
  abilities: string[] // Warframe abilities that apply to this weapon
  setBonuses: ReturnType<typeof setSummary> // mod sets with pieces equipped (weapon + Warframe)
  requirements: string[] // every conditional the numbers assume (kills, headshots, buffs up, frozen target...)
  statusTriggers: { key: string; type: string }[] // status-triggered buffs that were on ("upgrade|trigger", status type or 'any')
  procTypes: string[] // statuses this attack actually applies
  heavyCombo: { combo: HeavyCombo; mode: HeavyMode; multiplier: number } | null // multi-hit heavy, what got scored
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
  breakdown: HitBreakdown
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

// Secondary Enervate (wiki): every hit adds a flat `step` crit chance ("Critical chance is an absolute bonus"), and it all
// resets after `resets` Big Critical Hits ("any tier above regular Critical Hits", so orange or better). a hit at crit c is
// big with chance c - 1 between 100% and 200%, always above. I follow the chance of being at each big-crit count hit by
// hit through one cycle; average crit per hit = expected crit summed over the cycle / expected cycle length
export function enervateAverageCrit(startCrit: number, step: number, resets: number): number {
  let alive: number[] = Array.from({ length: resets }, (_, index) => (index === 0 ? 1 : 0)) // chance of being on hit k with j big crits
  let critSum = 0
  let hits = 0
  for (let hit = 0; hit < 100000; hit++) {
    const mass = sum(alive)
    if (mass < 1e-12) break
    const crit = startCrit + step * hit
    critSum += mass * crit
    hits += mass
    const bigChance = Math.min(1, Math.max(0, crit - 1))
    const next = alive.map((share) => share * (1 - bigChance))
    for (let big = 0; big + 1 < resets; big++) next[big + 1] += alive[big] * bigChance // the last big crit ends the cycle
    alive = next
  }
  return hits > 0 ? critSum / hits : startCrit
}
// rounds to the nearest 1/32, sign(x) * floor(|x| * 32 + 0.5) / 32
const quantize = (proportion: number) => (Math.sign(proportion) * Math.floor(Math.abs(proportion) * 32 + 0.5)) / 32

// "On Toxin Status Effect:" (Primary Blight), "On Melee Electricity Status:", "On Status Effect:" -> the status it waits
// for ('any' for no type), null when the trigger isn't a status one
export function statusTrigger(trigger: string): string | null {
  const match = trigger.match(/^On (?:Weapon |Melee )?(?:([A-Za-z]+) )?Status\b/i)
  if (!match) return null
  const type = match[1]?.toLowerCase()
  return type && DAMAGE_TYPES.includes(type) ? type : 'any'
}

// status-triggered buffs only count when the build actually lands that status. Primary Blight on a pure Electricity
// Alternox never gets a stack, so the optimizer was picking it for free crit damage. I run the calc, and if a status
// trigger's type never procs, run it again with that trigger off (turning it off can't add a status, so once is enough)
export function calculate(input: CalcInput): CalcResult {
  // a whole shot: every part with the same build, each on its own rules, then added up per shot
  const parts = partsOf(input)
  // a whole shot's parts all hit the same enemy, so each part's CO / Galvanized count includes the status types the
  // other parts apply (Bubonico's Burst counts the Radial Attack's Viral). first pass finds them, second pass uses them
  const appliedTypes = (result: CalcResult) => [
    ...(result.statusChance > 0 ? result.damageTypes.filter((row) => row.modded > 0).map((row) => row.damageType) : []),
    ...result.procTypes,
  ].filter((type) => type !== 'true')
  const run = (off: string[], others: string[][]) => parts.map((part, index) => calculateOnce(part, off, others[index] ?? []))
  const first = run([], [])
  const procTypes = [...new Set(first.flatMap((result) => result.procTypes))]
  const dead = [...new Map(first.flatMap((result) => result.statusTriggers).map((trigger) => [trigger.key, trigger])).values()]
    .filter(({ type }) => (type === 'any' ? procTypes.length === 0 : !procTypes.includes(type)))
  const others = parts.length > 1 ? first.map((_, index) => first.filter((__, other) => other !== index).flatMap(appliedTypes)) : []
  const results = dead.length || others.some((list) => list.length) ? run(dead.map(({ key }) => key), others) : first
  return results.length === 1 ? results[0] : combineParts(results, parts.map((part) => part.attack.name))
}

// the attacks a whole shot is made of. each part gets its own CO rule (the radial part of a hitscan shot doesn't get
// the shot's CO), unless the CO was set by hand
function partsOf(input: CalcInput): CalcInput[] {
  if (!input.attack.parts?.length) return [input]
  const found = input.attack.parts.map((name) => input.weapon.attacks.find((attack) => attack.name === name && !attack.parts))
  if (found.some((attack) => !attack)) return [input]
  // parts that only happen on a headshot or only on a body shot follow the target's headshot toggle
  const happens = (attack: Attack) => (input.target.headshot ? !attack.bodyShotOnly : !attack.headshotOnly)
  return (found as Attack[]).filter(happens).map((attack) => ({
    ...input, attack, coBehavior: input.coBehavior?.source === 'override' ? input.coBehavior : resolveCoBehavior(input.weapon, attack),
  }))
}

// one shot's worth of every part. the direct part (first) is what the shot "is" for the stat lines (crit, status, fire
// rate, magazine); damage numbers are added up. the biggest single instance stays the biggest one part lands, since in
// game they're separate hits. parts at another fire rate keep their own (Alternox's alt-fire explosion)
function combineParts(results: CalcResult[], names: string[]): CalcResult {
  const [main] = results
  const add = (pick: (result: CalcResult) => number) => sum(results.map(pick))
  const labelFor = (index: number) => (index === 0 ? '' : ` (${names[index]})`)
  const byType = new Map<string, DamageTypeRow>()
  results.forEach((result) => result.damageTypes.forEach((row) => {
    const existing = byType.get(row.damageType)
    byType.set(row.damageType, existing
      ? { ...existing, modded: existing.modded + row.modded, vsTarget: existing.vsTarget + row.vsTarget }
      : { ...row })
  }))
  const totalProcs = add((result) => result.procsPerSecond)
  const procsByType = new Map<string, number>()
  results.forEach((result) => result.damageTypes.forEach((row) => procsByType.set(row.damageType, (procsByType.get(row.damageType) ?? 0) + row.procShare * result.procsPerSecond)))
  const damageTypes = [...byType.values()].map((row) => ({ ...row, procShare: totalProcs > 0 ? (procsByType.get(row.damageType) ?? 0) / totalProcs : 0 }))
    .sort((a, b) => b.modded - a.modded)
  const dots = results.flatMap((result, index) => result.dots.map((dot) => ({ ...dot, damageType: `${dot.damageType}${labelFor(index)}` })))
  // the formula panel's timeline: the main part's shots, every part's damage per main-part pellet
  const mainPellets = Math.max(1e-9, main.shotModel.multishot)
  const scale = (result: CalcResult) => result.shotModel.multishot / mainPellets
  const shotModel: ShotModel = {
    ...main.shotModel,
    hit: {
      normal: add((result) => result.shotModel.hit.normal * scale(result)),
      crit: add((result) => result.shotModel.hit.crit * scale(result)),
      average: add((result) => result.shotModel.hit.average * scale(result)),
    },
    dots: results.flatMap((result, index) => result.shotModel.dots.map((dot) => ({ ...dot, damageType: `${dot.damageType}${labelFor(index)}`, procsPerPellet: dot.procsPerPellet * scale(result) }))),
  }
  const peak = results.reduce((best, result) => (result.peakHit > best.peakHit ? result : best), main)
  const peakDot = results.map((result) => result.peakDotTick).filter((tick): tick is NonNullable<typeof tick> => Boolean(tick))
    .sort((a, b) => b.value - a.value)[0] ?? null
  const unique = (lists: string[][]) => [...new Set(lists.flat())]
  return {
    ...main,
    damageTypes,
    moddedBaseDamage: add((result) => result.moddedBaseDamage),
    hit: { normal: add((result) => result.hit.normal), crit: add((result) => result.hit.crit), average: add((result) => result.hit.average) },
    peakHit: peak.peakHit,
    peakDotTick: peakDot,
    averageShot: add((result) => result.averageShot),
    attackTotal: add((result) => result.attackTotal),
    burstDps: add((result) => result.burstDps),
    procsPerSecond: totalProcs,
    dots,
    dotDps: add((result) => result.dotDps),
    totalDps: add((result) => result.totalDps),
    sustainedDps: add((result) => result.sustainedDps),
    steadyStateDps: add((result) => result.steadyStateDps),
    damageInWindow: (seconds: number) => sum(results.map((result) => result.damageInWindow(seconds))),
    // luck ranges added part by part, so the spread comes out a bit wider than one roll of the whole shot would be
    simulateWindows: (windows: number[], runs?: number) => {
      const each = results.map((result) => result.simulateWindows(windows, runs))
      return windows.map((_, index) => ({
        low: sum(each.map((ranges) => ranges[index].low)), expected: sum(each.map((ranges) => ranges[index].expected)),
        median: sum(each.map((ranges) => ranges[index].median)), high: sum(each.map((ranges) => ranges[index].high)),
      }))
    },
    shotModel,
    activeStatusTypes: Math.max(...results.map((result) => result.activeStatusTypes)),
    passives: unique(results.map((result) => result.passives)),
    abilities: unique(results.map((result) => result.abilities)),
    requirements: unique([[`Whole shot: ${names.join(' + ')}, each part on its own rules (CO, multishot, headshots), added up per shot`], ...results.map((result) => result.requirements)]),
    statusTriggers: [...new Map(results.flatMap((result) => result.statusTriggers).map((trigger) => [trigger.key, trigger])).values()],
    procTypes: unique(results.map((result) => result.procTypes)),
    unparsed: unique(results.map((result) => result.unparsed)),
  }
}

function calculateOnce({
  weapon, attack, mods, arcane, coBehavior, incarnonPerks = [], passives = [], bonusElement, heavyMode = 'biggestHit', target, armor, debuffs, buffs,
}: CalcInput, offTriggers: string[], otherPartStatusTypes: string[] = []): CalcResult {
  // multi-hit heavies (src/data/heavyAttacks.ts): the export's heavy number isn't one hit, so rescale the Heavy Attack to
  // the biggest single hit, or every hit added up for the "full heavy" ranking
  const heavyComboData = attack.heavy && attack.heavyMultiplier ? heavyComboFor(weapon.name) : null
  let heavyCombo: CalcResult['heavyCombo'] = null
  if (heavyComboData && attack.heavyMultiplier) {
    const multiplier = heavyMode === 'fullCombo' ? comboTotal(heavyComboData) : biggestHit(heavyComboData)
    const scale = multiplier / attack.heavyMultiplier
    attack = {
      ...attack,
      damage: Object.fromEntries(Object.entries(attack.damage).map(([damageType, amount]) => [damageType, amount * scale])),
      heavyMultiplier: multiplier,
    }
    heavyCombo = { combo: heavyComboData, mode: heavyMode, multiplier }
  }
  // exalted / pseudo-exalted weapons (src/data/exalted.ts): base damage x your Ability Strength, or a strength damage bonus
  const exalted = exaltedRuleFor(weapon)
  const exaltedStrength = buffs.warframe?.abilityStrength ?? 1
  if (exalted?.strength === 'base') {
    attack = { ...attack, damage: Object.fromEntries(Object.entries(attack.damage).map(([damageType, amount]) => [damageType, amount * exaltedStrength])) }
  }
  // the target's status behaviour: an immune one has no statuses on it at all (no CO count, no Viral, no Heat strip, no
  // procs), a capped one holds at most 4 stacks of each
  const statusMode = target.statusMode ?? 'normal'
  if (statusMode !== 'normal') {
    const immune = statusMode === 'immune'
    debuffs = {
      ...debuffs,
      stacks: Object.fromEntries(Object.entries(debuffs.stacks).map(([statusType, count]) => [statusType, immune ? 0 : Math.min(count, CAPPED_STATUS_STACKS)])),
      heatArmorStrip: immune ? 0 : debuffs.heatArmorStrip,
      liftedOrKnockedDown: immune ? false : debuffs.liftedOrKnockedDown,
    }
  }
  const stacks = (statusType: string) => debuffs.stacks[statusType] ?? 0
  // CO counts status *types*, not stacks. Lifted/knocked down is a hidden status that also counts
  const debuffStatusTypes = Object.values(debuffs.stacks).filter((count) => count > 0).length

  // ---- 1. collect mod effects ----
  const bonus: Record<StatKey, number> = {
    damage: 0, damagePerStatusType: 0, damagePerColdStack: 0, critChance: 0, weakpointCritChance: 0,
    critDamage: 0, multishot: 0, fireRate: 0, statusChance: 0, statusDamage: 0, headshotMultiplier: 0, weakpointDamage: 0,
    magazineCapacity: 0, reloadSpeed: 0, ammoEfficiency: 0,
    critChancePerCombo: 0, statusChancePerCombo: 0, heavyCritChance: 0, heavyDamage: 0, heavyWindUpSpeed: 0, heavyEfficiency: 0,
    statusDuration: 0, slamDamage: 0, throwDamage: 0, finisherDamage: 0,
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
  let duplicateOnCritChance = 0 // Melee Duplicate
  let napalm: Extract<ModEffect, { kind: 'napalm' }> | null = null // Nightwatch Napalm
  let critPerPunctureStatus = 0 // Melee Doughty
  const modFlat = { critChance: 0, statusChance: 0 } // "+20 Final Status Chance" (Entropy Burst, Napalm Grenades)
  let critPerHit: { value: number; resetsAfter: number } | null = null // Secondary Enervate
  let infiniteAmmo = false
  const fireRateLocked = mods.some(({ mod }) => mod.locksFireRate) // Semi-___ Cannonade: fire rate stays at base
  const unparsed: string[] = []
  // elements added on top of the weapon's own (Melee Exposure's Corrosive, Tonkkatt's Heat, Lesion's Toxin): they add
  // damage but don't combine with other elements and don't take a share of the status procs, so they can't dilute
  // your procs and don't proc on their own. you still need status chance + your own elements for procs
  const separateElements: Record<string, number> = {}
  const forcedProcsPerPellet: Record<string, number> = {} // guaranteed procs on every hit (Reconifex's Heat rounds)
  // the attack's own forced procs (glaive detonations, from build-data)
  for (const damageType of attack.forcedProcs ?? []) forcedProcsPerPellet[damageType] = (forcedProcsPerPellet[damageType] ?? 0) + 1

  const applyEffect = (effect: ModEffect, times: number) => {
    switch (effect.kind) {
      case 'stat':
        bonus[effect.stat] += effect.value * times
        // a single 100%+ Ammo Efficiency source (Skull Shots, Brain Storm, Arcane Pistoleer) is "Infinite Ammo" now
        if (effect.stat === 'ammoEfficiency' && effect.value >= 1 && times > 0) infiniteAmmo = true
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
        separateDamageMultiplier *= 1 + effect.value * times
        break
      case 'lockMultishot':
        multishotLocked = true
        break
      case 'flatStat':
        modFlat[effect.stat] += effect.value * times
        break
      case 'critPerHit':
        if (times > 0) critPerHit = { value: effect.value, resetsAfter: effect.resetsAfter }
        break
      case 'forcedProcChance':
        forcedProcsPerPellet[effect.damageType] = (forcedProcsPerPellet[effect.damageType] ?? 0) + effect.value * times
        break
      case 'duplicateOnCrit':
        duplicateOnCritChance += effect.value * times
        break
      case 'napalm':
        napalm = effect
        break
      case 'critPerPunctureStatus':
        critPerPunctureStatus += effect.value * times
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

  // mod sets: pieces on this weapon + on the Warframe (src/calc/modSets.ts)
  const setPieces = addPieces(countSets(mods.map(({ mod }) => mod)), buffs.warframe?.setPieces)

  // mods and the arcane use the same stat text, so they go through the same parser
  const upgrades = [
    // set members get their set's enhancement (Umbra, Sacrificial: "Enhance mods in this set")
    ...mods.map(({ mod, rank, conditionalStacks }) => ({ name: mod.name, levelStats: mod.levelStats, rank, conditionalStacks, enhance: setEnhancement(mod, setPieces) })),
    ...(arcane ? [{ name: arcane.arcane.name, levelStats: arcane.arcane.levelStats, rank: arcane.rank, conditionalStacks: arcane.conditionalStacks, isArcane: true }] : []),
    // the Warframe's arcanes (Arcane Avenger, Arcane Fury...), their weapon lines only count on the weapon type they name
    ...(buffs.warframe?.arcanes ?? []).flatMap(({ arcaneId, rank, conditionalStacks }) => {
      const frameArcane = arcanesById.get(arcaneId)
      return frameArcane ? [{ name: frameArcane.name, levelStats: frameArcane.levelStats, rank, conditionalStacks, isFrameArcane: true }] : []
    }),
  ]
  // everything the build's numbers assume is happening in the fight (shown in red under the results)
  const requirements: string[] = []
  const statusTriggers: CalcResult['statusTriggers'] = []
  let frameArcaneFlatCrit = 0 // Arcane Avenger: "adds 45 percentage points to a weapon's critical chance after other bonuses"
  for (const upgrade of upgrades) {
    const parsed = parseUpgrade(upgrade.levelStats, upgrade.rank)
    // arcane elements (Melee Exposure) are separate elements, see separateElements
    const enhance = 'enhance' in upgrade ? upgrade.enhance : 1
    const apply = (effect: ModEffect, rawTimes: number) => {
      const times = rawTimes * enhance
      if ('isFrameArcane' in upgrade && effect.kind === 'stat' && effect.stat === 'critChance') frameArcaneFlatCrit += effect.value * times
      else if ('isArcane' in upgrade && effect.kind === 'damageType' && !PHYSICAL_TYPES.includes(effect.damageType)) {
        separateElements[effect.damageType] = (separateElements[effect.damageType] ?? 0) + effect.value * times
      } else applyEffect(effect, times)
    }
    parsed.effects.forEach((effect) => apply(effect, 1))
    for (const conditional of parsed.conditionals) {
      if (!scopeApplies(conditional.scope, weapon)) continue
      const triggerType = statusTrigger(conditional.trigger)
      const triggerKey = `${upgrade.name}|${conditional.trigger}`
      if (triggerType && offTriggers.includes(triggerKey)) {
        const line = `${upgrade.name}: off, this build never applies ${triggerType === 'any' ? 'a status effect' : `${triggerType[0].toUpperCase()}${triggerType.slice(1)} procs`} (its trigger)`
        if (!requirements.includes(line)) requirements.push(line)
        continue
      }
      let activeStacks = Math.min(upgrade.conditionalStacks, conditional.maxStacks)
      // Primary Bulwark: with a Warframe armor set in the Warframe panel, its stacks come from that (1 stack = 1 armor past 1,000)
      const armorThreshold = conditional.trigger.match(/^Warframe armor past ([\d,]+)/)
      const warframeArmor = buffs.warframe?.armor ?? 0
      if (armorThreshold && warframeArmor > 0) {
        activeStacks = Math.min(conditional.maxStacks, Math.max(0, warframeArmor - Number(armorThreshold[1].replace(/,/g, ''))))
      }
      // Dreadful Killshot: "for every 75 Warframe Health", from the Warframe panel when there is one
      const healthStep = conditional.trigger.match(/^Warframe health per ([\d,]+)/)
      if (healthStep && (buffs.warframe?.health ?? 0) > 0) {
        activeStacks = Math.min(conditional.maxStacks, Math.floor(buffs.warframe!.health! / Number(healthStep[1].replace(/,/g, ''))))
      }
      if (activeStacks > 0) {
        if (triggerType) statusTriggers.push({ key: triggerKey, type: triggerType })
        apply(conditional.effect, activeStacks)
        const label = `${upgrade.name}: ${conditional.trigger.replace(/:$/, '').replace(/^On /, 'on ').replace(/^When /, 'when ').replace(/^While /, 'while ')}` +
          (conditional.maxStacks > 1 ? ` (${activeStacks}/${conditional.maxStacks} stacks)` : '')
        if (!requirements.includes(label)) requirements.push(label)
      }
    }
    if (!('isFrameArcane' in upgrade)) unparsed.push(...parsed.unparsed.map((line) => `${upgrade.name}: ${line}`))
  }

  // ---- weapon passives (hand-kept table, see src/data/passives.ts) ----
  // mod-like parts go through applyEffect, the rest gets collected here and used further down
  const passiveFlat = { critChance: 0, statusChance: 0 }
  let critPerStatusType = 0 // Galariak Prime, flat after mods
  let damagePerStatusTypePassive = 0 // Cedo, additive with damage mods
  let finalCritMultiplierBonus = 0 // Knell
  const statusDurationByType: Record<string, number> = {} // '*' = every DoT
  const statusDamageByType: Record<string, number> = {} // Ash's passive: Slash procs deal 25% more
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
    if (passive.condition) requirements.push(`${passive.name} (weapon passive): ${passive.condition}${(passive.maxStacks ?? 1) > 1 ? ` (${times}/${passive.maxStacks} stacks)` : ''}`)
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

  // ---- Warframe abilities (src/data/warframeAbilities.ts), scaled by Ability Strength ----
  let abilityFlatCritChance = 0 // Wrathful Advance, after mods
  let abilityCritDamageScale = 1 // Electric Shield, multiplies every other crit damage source
  const extraHits: Record<string, number> = {} // separate hits worth this share of the weapon's damage (Xata's Whisper Void, Resupply...)
  let xataShare = 0 // the Xata's Whisper part of that: headshot counts twice on it, and it also goes off on Blast detonations
  let abilityVulnerability = 0 // Petrify: the target takes more from everything
  let finisherVulnerability = 0 // Savage Silence / Radiant Finish, only on finisher attacks
  let oneShotFlat = 0 // Ballistic Battery: flat base damage on one shot, only for the biggest-hit numbers
  const uncombinedElements: Record<string, number> = {} // Freeze Force / Electric Shield: don't combine, do proc
  const statusElementBonus: Record<string, number> = {} // uncombined ability elements that still count for their DoT
  const activeAbilities: string[] = []
  const warframe = buffs.warframe
  if (warframe) {
    // squad auras that buff weapons (Steel Charge, Rifle Amp...), added in with the damage mods
    const aura = warframe.auraDamage
    if (aura) {
      bonus.damage +=
        weapon.category === 'Melee' ? aura.melee
          : weapon.category === 'Secondary' ? aura.pistol
            : weapon.type === 'Shotgun' ? aura.shotgun
              : aura.rifle + (weapon.type === 'Sniper' ? aura.sniper : 0)
    }
    bonus.weakpointCritChance += warframe.weakpointCritChance ?? 0
    // Archon Shards: additive with the matching mods ("Melee Critical Damage is additive with Organ Shatter"), and they
    // work on exalted weapons of the same class. the Violet electricity goes in after the mods in the combine order
    const shards = warframe.shards
    if (shards) {
      if (weapon.category === 'Melee') bonus.critDamage += shards.meleeCritDamage
      if (weapon.category === 'Primary') {
        bonus.statusChance += shards.primaryStatusChance
        if (shards.primaryElectricity > 0) {
          if (!('electricity' in elementBonus)) elementOrder.push('electricity')
          elementBonus.electricity = (elementBonus.electricity ?? 0) + shards.primaryElectricity
        }
      }
      if (weapon.category === 'Secondary') bonus.critChance += shards.secondaryCritChance
      if (shards.toxinStatusDamage) statusDamageByType.toxin = (statusDamageByType.toxin ?? 0) + shards.toxinStatusDamage
    }
    // the same buff twice doesn't stack, the strongest one applies (Shock Trooper wiki: "Multiple Shock Troopers don't stack.
    // The one with the highest Ability Strength applies")
    const strongest = new Map<string, AbilityCast>()
    for (const cast of warframe.casts) {
      const current = strongest.get(cast.id)
      if (!current || strengthFor(cast, warframe) > strengthFor(current, warframe)) strongest.set(cast.id, cast)
    }
    for (const cast of strongest.values()) {
      const ability = abilitiesById.get(cast.id)
      if (!ability || !abilityApplies(ability, weapon)) continue
      // passives only work on that frame, cast by you
      if (ability.selfOnly && (cast.by !== 'self' || ability.warframe !== warframe.frameName)) continue
      // caster-only buffs (Eclipse, Xata's Whisper) do nothing when a teammate casts them
      if (ability.casterOnly && cast.by === 'ally') continue
      const times = castStacks(ability, cast)
      const effects = effectsFor(ability, cast.by)
      if (effects.length === 0 || effects.every((effect) => effect.perStack && times <= 0)) continue
      const caster = cast.by === 'helminth' ? 'your subsumed' : cast.by === 'ally' ? 'an ally\'s' : 'your'
      activeAbilities.push(`${ability.name}${cast.by === 'helminth' ? ' (subsumed)' : cast.by === 'ally' ? ' (ally)' : ''}`)
      // passives (no ability to cast) just need their condition
      const needs = ability.ability ? `${caster} ${ability.ability} up${ability.condition ? `, ${ability.condition}` : ''}` : ability.condition ?? `playing ${ability.warframe}`
      requirements.push(`${ability.name}: ${needs}${ability.stacks ? ` (${times} ${ability.stacks.label})` : ''}`)
      for (const effect of effects) {
        const value = scaledValue(ability, effect.value, strengthFor(cast, warframe)) * (effect.perStack ? times : 1)
        switch (effect.kind) {
          case 'factionDamage':
            factionBonus += value
            break
          case 'damageMultiplier':
            separateDamageMultiplier *= 1 + value
            break
          case 'baseDamage':
            bonus.damage += value
            break
          case 'element':
            // Shock Trooper: extra Electricity that doesn't dilute your procs, plus a guaranteed Electricity proc per hit
            if (effect.forcedProc) {
              separateElements[effect.damageType] = (separateElements[effect.damageType] ?? 0) + value
              forcedProcsPerPellet[effect.damageType] = (forcedProcsPerPellet[effect.damageType] ?? 0) + 1
              if (effect.boostsStatus) statusElementBonus[effect.damageType] = (statusElementBonus[effect.damageType] ?? 0) + value
              break
            }
            if (effect.combines) applyEffect({ kind: 'damageType', damageType: effect.damageType, value }, 1)
            else uncombinedElements[effect.damageType] = (uncombinedElements[effect.damageType] ?? 0) + value
            // Thermal Transfer: "the Heat bonus is additive with other Heat bonuses for status"
            if (!effect.combines && effect.boostsStatus) statusElementBonus[effect.damageType] = (statusElementBonus[effect.damageType] ?? 0) + value
            break
          case 'extraHit': {
            // Resupply's sniper bonus is doubled (Neutralizer gets it too, it's a sniper)
            const amount = weapon.type === 'Sniper' && effect.sniperValue ? value * (effect.sniperValue / effect.value) : value
            extraHits[effect.damageType] = (extraHits[effect.damageType] ?? 0) + amount
            if (effect.xata) xataShare += amount
            if (effect.forcedProc) forcedProcsPerPellet[effect.damageType] = (forcedProcsPerPellet[effect.damageType] ?? 0) + 1
            break
          }
          case 'attackSpeed':
            bonus.fireRate += value
            break
          case 'flatCritChance':
            abilityFlatCritChance += value
            break
          case 'critDamageMultiplier':
            abilityCritDamageScale *= 1 + value
            break
          case 'critChanceMod':
            bonus.critChance += value
            break
          case 'critDamageMod':
            bonus.critDamage += value
            break
          case 'finisherVulnerability':
            finisherVulnerability += value
            break
          case 'statusTypeDamage':
            statusDamageByType[effect.damageType] = (statusDamageByType[effect.damageType] ?? 0) + value
            break
          case 'statusTypeDuration':
            statusDurationByType[effect.damageType] = (statusDurationByType[effect.damageType] ?? 0) + value
            break
          case 'statusChanceMod':
            bonus.statusChance += value
            break
          case 'statusDurationMod':
            bonus.statusDuration += value
            break
          case 'weakpointDamage':
            bonus.weakpointDamage += value
            break
          case 'targetVulnerability':
            abilityVulnerability += value
            break
          case 'oneShotFlat':
            oneShotFlat += value
        }
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
  // the combo only matters if something reads it
  if (isMelee && combo > 1 && (Boolean(attack.heavy) || Boolean(exalted?.abilityCombo) || bonus.critChancePerCombo > 0 || bonus.statusChancePerCombo > 0 || mods.some(({ mod }) => mod.name.startsWith('Gladiator ')))) {
    requirements.push(`Melee combo at ${combo}x${attack.heavy ? ' (spent by the heavy)' : ''}`)
  }
  const gladiatorPieces = Math.min(
    GLADIATOR_MAX_PIECES,
    (setPieces.Gladiator ?? 0) + (buffs.gladiatorWarframePieces ?? 0),
  )
  const critFromCombo = isMelee ? (bonus.critChancePerCombo + GLADIATOR_CRIT_PER_PIECE * gladiatorPieces) * comboSteps : 0
  const statusFromCombo = isMelee ? bonus.statusChancePerCombo * comboSteps : 0
  // Killing Blow style "Melee Damage on Heavy Attack" just adds to the damage mods
  if (isHeavy) bonus.damage += bonus.heavyDamage
  // Seismic Wave / Power Throw are their own multipliers (wiki: multiplicative with Pressure Point), only on those attacks.
  // Power Throw counts on the throw itself, the wiki doesn't say it reaches the explosion so I leave that out
  // Nira's set: +150% slam damage per piece, "additive to" Seismic Wave
  if (isMelee && /slam/i.test(attack.name)) separateDamageMultiplier *= 1 + bonus.slamDamage + NIRA_SLAM_PER_PIECE * Math.min(3, setPieces.Nira ?? 0)
  if (isMelee && /throw$/i.test(attack.name)) separateDamageMultiplier *= 1 + bonus.throwDamage
  // finisher attacks (Blade Storm): Finisher Damage bonuses add together (Obex page: Armored Finisher "is additive to other
  // sources of Finisher Damage such as Finishing Touch"), and Savage Silence / Radiant Finish multiply on top ("Multiplicative
  // to Finishing Touch")
  if (attack.finisher) separateDamageMultiplier *= (1 + bonus.finisherDamage) * (1 + finisherVulnerability)
  // pseudo-exalted (Landslide, Shattered Lash, Whipclaw, Blade Storm): "1x additional damage per combo multiplier" on every hit
  const heavyComboFactor = isHeavy || (isMelee && exalted?.abilityCombo) ? combo : 1
  if (exalted && exalted.strength !== 'none') {
    requirements.push(`${exalted.ability} active (${exalted.strength === 'base' ? 'base damage' : `+${Math.round((exalted.strengthBonus ?? 0) * 100)}% damage`} x ${Math.round(exaltedStrength * 100)}% Ability Strength)`)
  }
  // Regulators' innate +150% / Neutralizer's x1.25: Ability Strength damage bonuses added in with Hornet Strike / Serration
  if (exalted?.strength === 'bonus') bonus.damage += (exalted.strengthBonus ?? 0) * exaltedStrength
  // Peacemaker's ramp-up multiplies final damage
  if (exalted?.finalMultiplier) {
    separateDamageMultiplier *= exalted.finalMultiplier.value
    requirements.push(exalted.finalMultiplier.requirement)
  }

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
  let nonCritPeakBonus = 0 // the bonus itself, for the biggest possible hit
  let armorStripPerPuncture = 0
  const conversions: Extract<PerkEffect, { kind: 'convert' }>[] = []
  for (const { perk, stacks: perkStacks } of incarnonPerks) {
    for (const statement of perk.statements) {
      if (!statement.effect || !perkAppliesTo(statement.mode, isIncarnonAttack, weapon.category === 'Melee')) continue
      const times = statement.condition ? Math.min(perkStacks, statement.maxStacks) : 1
      if (times <= 0) continue
      if (statement.condition) {
        const label = `${perk.name} (Incarnon): ${statement.condition.replace(/:$/, '')}${statement.maxStacks > 1 ? ` (${times}/${statement.maxStacks} stacks)` : ''}`
        if (!requirements.includes(label)) requirements.push(label)
      }
      const effect = statement.effect
      if (effect.kind === 'base') perkBase[effect.stat] += effect.value * times
      else if (effect.kind === 'flat') perkFlat[effect.stat] += effect.value * times
      else if (effect.kind === 'mod') applyEffect(effect.effect, times)
      else if (effect.kind === 'nonCritBonus') {
        nonCritChanceBonus += effect.chance * effect.value
        nonCritPeakBonus += effect.value
      }
      else if (effect.kind === 'convert') conversions.push(effect)
      else armorStripPerPuncture += effect.value
    }
    for (const statement of perk.statements) {
      if (!statement.effect && /Damage|Critical|Status|Multishot|Fire Rate|Attack Speed/.test(statement.text)) {
        unparsed.push(`${perk.name}: ${statement.text}`)
      }
    }
  }
  // "+N Base Damage" grows every damage type by the same proportion, and every part of a multi-part shot together
  const unmoddedBase = attack.baseDamagePool ?? sum(Object.values(attack.damage))
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
  const typeParts: Record<string, TypePart[]> = {}
  const addProportion = (damageType: string, amount: number, ...parts: TypePart[]) => {
    proportions[damageType] = (proportions[damageType] ?? 0) + amount
    typeParts[damageType] = [...(typeParts[damageType] ?? []), ...parts]
  }

  for (const damageType of PHYSICAL_TYPES) {
    const base = attack.damage[damageType] ?? 0
    const mod = physicalBonus[damageType] ?? 0
    if (base > 0) addProportion(damageType, (base / baseDamage) * (1 + mod), { kind: 'physical', base: base / baseDamage, mod })
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
  const elementPart = (element: string): TypePart => {
    const innate = (attack.damage[element] ?? 0) / baseDamage
    return { kind: 'element', element, mod: elementAmounts[element] - innate, innate }
  }
  for (const damageType of combineQueue) {
    if (!PRIMARY_ELEMENTS.includes(damageType)) addProportion(damageType, elementAmounts[damageType], elementPart(damageType))
  }
  for (let i = 0; i < primaryQueue.length; i += 2) {
    const first = primaryQueue[i]
    const second = primaryQueue[i + 1]
    if (!second) addProportion(first, elementAmounts[first], elementPart(first))
    else addProportion(COMBINED_ELEMENTS[[first, second].sort().join('+')], elementAmounts[first] + elementAmounts[second], elementPart(first), elementPart(second))
  }
  // passive elements that skip combining (Tonkkatt's heat stays heat)
  for (const [damageType, amount] of Object.entries(separateElements)) addProportion(damageType, amount, { kind: 'separate', source: 'passive', value: amount })
  // ability elements (Freeze Force, Electric Shield) also skip combining, but they do take their share of procs
  for (const [damageType, amount] of Object.entries(uncombinedElements)) addProportion(damageType, amount, { kind: 'separate', source: 'ability', value: amount })

  // which status types the target has, for CO / Galvanized. by default it's the build's own damage types
  // (base physical + modded elements), so a gun can't count statuses it never applies
  // the build's own status types, plus (in a whole shot) the ones the other parts put on the same enemy
  const ownStatusTypes = attack.statusChance > 0
    ? Object.entries(proportions).filter(([damageType, proportion]) => damageType !== 'true' && quantize(proportion) > 0).map(([damageType]) => damageType)
    : []
  const buildStatusTypes = statusMode === 'immune' ? 0 : new Set([...ownStatusTypes, ...otherPartStatusTypes]).size
  const activeStatusTypes =
    (debuffs.statusTypeSource === 'debuffs' ? debuffStatusTypes : buildStatusTypes) + (debuffs.liftedOrKnockedDown ? 1 : 0)
  // Cedo: +60% per status type, in with the damage mods (not CO-style)
  bonus.damage += damagePerStatusTypePassive * activeStatusTypes

  // Condition Overload style bonuses (CO, Galvanized per-status, Secondary Shiver per Cold stack).
  // additive weapons: base x [(1 + mods) x other multipliers + CO]
  // multiplicative weapons: base x (1 + mods) x (1 + CO) x other multipliers
  const co = coBehavior ?? resolveCoBehavior(weapon, attack)
  // the adding kind ignores "Evolution base damage increases on Incarnon" (wiki CO page), so its share is worked out
  // on the base before the evolution's +N. the multiplying kind (Kunai Incarnon) does get it
  const coBaseShare = co.mode === 'add' ? 1 / baseDamageScale : 1
  const coBonus =
    co.mode === 'none'
      ? 0
      : (bonus.damagePerStatusType * activeStatusTypes + bonus.damagePerColdStack * Math.min(stacks('cold'), 10)) * co.scale * coBaseShare
  if (coBonus > 0 || (damagePerStatusTypePassive > 0 && activeStatusTypes > 0) || (critPerStatusType > 0 && activeStatusTypes > 0)) {
    requirements.push(`Target already has ${activeStatusTypes} status type${activeStatusTypes === 1 ? '' : 's'} on it (Condition Overload style bonuses)`)
  }
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
  if (isHeadshot) requirements.push('Headshots on every hit')
  // null/undefined = follow the faction, so stale or missing settings can't silently turn headcrits off
  const headMultiplier = target.headshotMultiplier ?? headMultiplierFor(target.faction)
  const headcrit = target.headcrit ?? hasHeadcrits(target.faction)
  // area parts take a 1x headshot multiplier and can't trigger headshot conditions, but when the projectile lands on the
  // head they still get its weak point crit chance (Acuity: "+350% Weak Point Critical Chance")
  const weakpointCritBonus = target.headshot ? bonus.weakpointCritChance : 0
  // status chance after mods, as a function of base status (Wiseman's Regard changes the base after crit is known)
  const moddedStatus = (baseStatus: number) =>
    baseStatus * (1 + bonus.statusChance + statusFromCombo) + perkFlat.statusChance + passiveFlat.statusChance + modFlat.statusChance +
    tauStatusChanceBonus(stacks('tau'))
  // Decisive Stature: +25% of current status chance as base crit chance, capped
  for (const conversion of conversions.filter((candidate) => candidate.stat === 'critChance')) {
    attack = { ...attack, critChance: attack.critChance + Math.min(conversion.max, conversion.ratio * moddedStatus(attack.statusChance)) }
  }
  const critBeforeEnervate =
    attack.critChance * (1 + bonus.critChance + weakpointCritBonus + critFromCombo + (isHeavy ? bonus.heavyCritChance : 0)) +
    perkFlat.critChance + passiveFlat.critChance + modFlat.critChance + frameArcaneFlatCrit + critPerStatusType * activeStatusTypes + abilityFlatCritChance +
    (attack.isAoE ? 0 : punctureCritChanceBonus(stacks('puncture')))
  // Enervate's stacks are flat on top of everything, taken as their average over a build-up-and-reset cycle
  const enervate = critPerHit as { value: number; resetsAfter: number } | null // set inside the effect loop, TS can't see it
  const critBeforeVigilante = enervate ? enervateAverageCrit(critBeforeEnervate, enervate.value, enervate.resetsAfter) : critBeforeEnervate
  if (enervate) requirements.push(`Secondary Enervate: +${Math.round(enervate.value * 100)}% crit per hit, reset after ${enervate.resetsAfter} big crits (averaged: +${Math.round((critBeforeVigilante - critBeforeEnervate) * 100)}%)`)
  // Vigilante set: "X% chance to enhance Critical Hits from Primary Weapons", a crit that gets enhanced goes up one tier, which
  // averages out the same as that much more crit chance on every hit that crits
  const vigilanteChance = weapon.category === 'Primary' ? VIGILANTE_ENHANCE_PER_PIECE * Math.min(6, setPieces.Vigilante ?? 0) : 0
  const critChance = critBeforeVigilante + vigilanteChance * Math.min(1, Math.max(0, critBeforeVigilante))
  // headcrit doubles the weapon's *base* crit multiplier, so mods scale it but Cold's flat bonus doesn't
  const headcritFactor = isHeadshot && headcrit ? HEADCRIT_MULTIPLIER : 1
  const critMultiplier =
    (attack.critMultiplier * headcritFactor * (1 + bonus.critDamage) + finalCritMultiplierBonus) * abilityCritDamageScale +
    (attack.isAoE ? 0 : coldCritMultiplierBonus(stacks('cold')))
  // over 100% the lowest tier is the "normal" hit and the next tier up is the "crit" (Damage/Calculation 4.3)
  const normalCritMultiplier = 1 + Math.floor(critChance) * (critMultiplier - 1)
  const critHitMultiplier = 1 + Math.ceil(critChance) * (critMultiplier - 1)
  // status chance before Sagek's override, Gotva needs it here
  // Wiseman's Regard: +30% of current crit chance as base status chance, capped
  const convertedBaseStatus = conversions
    .filter((conversion) => conversion.stat === 'statusChance')
    .reduce((total, conversion) => total + Math.min(conversion.max, conversion.ratio * Math.max(0, critChance)), 0)
  const rawStatusChance = moddedStatus(attack.statusChance + convertedBaseStatus)
  // Gotva Prime: a hit after a status proc has a chance to roll at a fixed crit chance instead
  const superCritShare = critOverride ? Math.min(1, rawStatusChance) * critOverride.chance : 0
  const superCritMultiplier = critOverride ? 1 + critOverride.critChance * (critMultiplier - 1) : 1
  const averageCritMultiplier = (1 - superCritShare) * (1 + critChance * (critMultiplier - 1)) + superCritShare * superCritMultiplier
  // Devouring Attrition style: non-crit hits have a chance at a huge bonus. only matters below 100% crit
  const attritionBonus = Math.max(0, 1 - critChance) * nonCritChanceBonus

  const factionMultiplier = 1 + factionBonus
  // Acuity: multishot mods/arcanes don't apply, the weapon keeps its base (Incarnon base multishot perks still count)
  // hitscan explosions, beam blasts and speargun throws keep their innate multishot too (build-data noMultishotMods)
  const multishot = weapon.category === 'Melee' ? 1 : weapon.multishot * (multishotLocked || attack.noMultishotMods ? 1 : 1 + bonus.multishot)
  // beams (wiki Multishot): extra beams on one target "merge into a singular damage tick" with the summed damage and
  // status chance, so damaging procs come from a tick worth all the beams. "Damaging status effects (Slash, Heat,
  // Toxin, Electricity, Blast, Gas) are affected twice by multishot on all continuous weapons." forced procs land after
  // the merge, one per tick, so those don't get the second helping
  const beamMerge = attack.continuous ? Math.max(1, multishot) : 1
  // charged attacks (wiki Damage/Calculation): effective rate = 1 / (charge time + 1 / fire rate), and fire rate
  // mods also speed up the charge (modded charge time = base / (1 + speed bonuses))
  // pseudo-exalted speed comes from Casting Speed, attack speed mods do nothing
  const fireRateBonus = fireRateLocked || exalted?.noAttackSpeed ? 0 : bonus.fireRate
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
  // the three pieces of T: faction weakness, armor, and the Viral (health) / Magnetic (shields, overguard) debuff
  const typeFactors = (damageType: string, bypassArmor = false) => {
    const weakness = factionWeakness[damageType] ?? 1
    const layer = target.layer === 'shield' && damageType === 'toxin' ? 'health' : target.layer
    if (layer === 'overguard') return { weakness: overguardMultiplier, armor: 1, debuff: magneticMultiplier(stacks('magnetic')), debuffName: 'magnetic' }
    if (layer === 'shield') return { weakness, armor: 1, debuff: magneticMultiplier(stacks('magnetic')), debuffName: 'magnetic' }
    return { weakness, armor: bypassArmor || damageType === 'true' ? 1 : armorMultiplier, debuff: viralMultiplier(stacks('viral')), debuffName: 'viral' }
  }
  const typeMultiplier = (damageType: string, bypassArmor = false): number => {
    const factors = typeFactors(damageType, bypassArmor)
    return factors.weakness * factors.armor * factors.debuff
  }

  // Weak_Point: (head multiplier + 1.5 x weak point damage bonuses) x (1 + headshot multiplier bonuses)
  const weakPointMultiplier = headMultiplier + WEAK_POINT_BONUS_RATE_ON_HEAD * bonus.weakpointDamage
  const headshotFactor = isHeadshot ? weakPointMultiplier * (1 + bonus.headshotMultiplier) : 1
  // Debuffs panel vulnerability + Petrify, added together
  const vulnerability = debuffs.damageVulnerability + abilityVulnerability
  const sharedMultiplier = (1 + vulnerability) * headshotFactor

  // Xata's Whisper: X% of the weapon's total damage as a separate Void hit, faction applies to it twice
  // faction counts twice on these (Xata's Whisper wiki: "double dips on faction damage, and body part weaknesses"), so
  // Xata's own share gets the headshot part again too
  const moddedTotal = sum(Object.values(moddedByType))
  const extraHitNoCrit = sum(Object.entries(extraHits).map(([damageType, fraction]) => {
    const xataPart = damageType === 'void' ? Math.min(fraction, xataShare) : 0
    return (fraction + xataPart * (headshotFactor - 1)) * moddedTotal * typeMultiplier(damageType)
  })) * factionMultiplier
  const vsTargetNoCrit = (sum(
    Object.entries(moddedByType).map(([damageType, amount]) => amount * typeMultiplier(damageType)),
  ) + extraHitNoCrit) * factionMultiplier * sharedMultiplier

  // Melee Doughty (wiki Melee_Doughty): "round(Puncture Status Chance×0.1×Critical Multiplier Bonus)" as extra crit
  // multiplier, to 0.1, "Capped at +50x Critical Multiplier". Puncture status chance = status chance x Puncture's share of
  // the proc weighting, so elements lower it, and since Update 38.6 "the bonus no longer applies to the non-Puncture
  // portion of a weapon's attack": only the Puncture part of the hit gets the bigger crits. DoTs don't get it
  const procWeightOf = (damageType: string) => Math.max(0, (moddedByType[damageType] ?? 0) - quantize(separateElements[damageType] ?? 0) * moddedBaseDamage)
  const weightTotal = sum(Object.keys(moddedByType).map(procWeightOf))
  const punctureStatusChance = weightTotal > 0 ? Math.max(0, rawStatusChance) * procWeightOf('puncture') / weightTotal : 0
  const doughtyBonus = critPerPunctureStatus > 0 ? Math.min(50, Math.round(punctureStatusChance * 100 * 0.1 * critPerPunctureStatus * 10) / 10) : 0
  const puncturePart = doughtyBonus > 0 ? (moddedByType.puncture ?? 0) * typeMultiplier('puncture') * factionMultiplier * sharedMultiplier : 0
  if (critPerPunctureStatus > 0) {
    requirements.push(`Melee Doughty: ${Math.round(punctureStatusChance * 1000) / 10}% Puncture status chance -> +${doughtyBonus}x crit multiplier on the Puncture part of the hit only`)
  }
  const hit = {
    normal: vsTargetNoCrit * normalCritMultiplier + puncturePart * Math.floor(Math.max(0, critChance)) * doughtyBonus,
    crit: vsTargetNoCrit * critHitMultiplier + puncturePart * Math.ceil(Math.max(0, critChance)) * doughtyBonus,
    average: vsTargetNoCrit * (averageCritMultiplier + attritionBonus) + puncturePart * Math.max(0, critChance) * (1 - superCritShare) * doughtyBonus,
  }
  // Melee Duplicate: "base (yellow) Critical Hits inflict a second instance of damage", the duplicate rerolls crit and
  // status (wiki). so a crit is worth one more hit and its procs. it's a separate instance, so hit.* stays one hit
  const strikes = isMelee ? 1 + Math.min(1, critChance) * duplicateOnCritChance : 1
  const hitsPerAttack = multishot * strikes
  const averageShot = hit.average * hitsPerAttack
  const burstDps = averageShot * fireRate

  // ---- 5. status procs + DoTs ----
  // Sagek Prime: a shot after a crit has a chance to roll at a fixed status chance instead
  const statusOverrideShare = statusOverride ? Math.min(1, critChance) * statusOverride.chance : 0
  const statusChance = statusOverride
    ? (1 - statusOverrideShare) * rawStatusChance + statusOverrideShare * statusOverride.statusChance
    : rawStatusChance
  const pelletsPerSecond = hitsPerAttack * fireRate
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
  // (on a beam that's per merged tick, not per beam)
  procRates.slash = (procRates.slash ?? 0) + Math.min(critChance, 1) * slashOnCritChance * pelletsPerSecond / beamMerge
  // Internal Bleeding: doubled when fire rate is below 2.5
  procRates.slash += (procRates.impact ?? 0) * slashOnImpactChance * (fireRate < 2.5 ? 2 : 1)
  // guaranteed procs ride on every pellet, on top of the status chance rolls (one per merged tick on a beam)
  for (const [damageType, perPellet] of Object.entries(forcedProcsPerPellet)) {
    procRates[damageType] = (procRates[damageType] ?? 0) + perPellet * pelletsPerSecond / beamMerge
  }

  // an immune target takes no procs at all, forced ones included
  if (statusMode === 'immune') for (const damageType of Object.keys(procRates)) procRates[damageType] = 0
  const procTypes = Object.keys(procRates).filter((damageType) => procRates[damageType] > 0)

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
      const elementMultiplier = info.usesElementMods ? 1 + (elementBonus[damageType] ?? 0) + (statusElementBonus[damageType] ?? 0) : 1
      const headshotPart = !isHeadshot ? 1 : info.fullHeadshot ? headshotFactor : 1 + bonus.headshotMultiplier
      const merged = BEAM_MERGED_DOTS.includes(damageType) ? beamMerge : 1
      const beforeCrit =
        info.fraction * statusBase * elementMultiplier * factionMultiplier * (1 + bonus.statusDamage + (statusDamageByType[damageType] ?? 0)) *
        (1 + vulnerability) * headshotPart * merged
      // Xata's Whisper also goes off on each Blast detonation: 26% x detonation x faction again x (1 + elemental mods),
      // "the Elemental Damage Bonus is applied even though Blast detonations don't scale off Elemental Damage Bonuses" (wiki)
      const xataOnBlast = damageType === 'blast' && xataShare > 0
        ? xataShare * beforeCrit * factionMultiplier * (1 + sum(Object.values(elementBonus))) * typeMultiplier('void')
        : 0
      const tick = critSplit(beforeCrit * typeMultiplier(damageType, info.bypassesArmor) + xataOnBlast)
      // Status Duration stretches the DoT, at one tick per second that's more ticks (wiki Status_Duration).
      // Blast is a single hit so it doesn't care
      const durationScale = 1 + bonus.statusDuration + (statusDurationByType['*'] ?? 0) + (statusDurationByType[damageType] ?? 0)
      const ticks = info.ticks > 1 ? Math.max(1, Math.floor(info.ticks * durationScale + 1e-9)) : info.ticks
      const perProc = scaleSplit(tick, ticks)
      // a status-capped target only holds 4 stacks: past procs/s x duration = 4, extra procs replace running ones, so
      // the DoT can't go above 4 running at once
      if (statusMode === 'capped' && ticks > 1) procRates[damageType] = Math.min(procRates[damageType], CAPPED_STATUS_STACKS / ticks)

      let aoe: DotRow['aoe'] = null
      if (damageType === 'blast') {
        // the explosion hits *other* enemies, so the target's armor/viral/vulnerability don't apply,
        // just the faction weakness (assuming they're the same faction)
        const detonationBase = (beforeCrit / (1 + vulnerability)) * (BLAST_DETONATION_MULTIPLIER / info.fraction)
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
        factors: {
          fraction: info.fraction, statusBase, element: elementMultiplier, faction: factionMultiplier,
          statusDamage: bonus.statusDamage + (statusDamageByType[damageType] ?? 0), vulnerability, headshot: headshotPart, merged,
          type: typeMultiplier(damageType, info.bypassesArmor),
        },
      }
    })
  // Nightwatch Napalm (wiki Nightwatch_Napalm): each rocket's explosion leaves fire that deals "30% of the weapon's
  // modified base damage as Heat damage ... over 6 seconds". "Damage output can only be increased by base damage mods"
  // and faction mods (Kuva bonus element too, it's already in the base here), "Napalm cannot deal critical damage via any
  // means", Status Damage mods don't touch it. so: base x (1 + damage mods) x faction, no CO, no elements, no crit.
  // the fire also procs Heat at a fixed 68% chance, "ticking for 50% of napalm's damage per second for 3 seconds", and
  // those procs do get Heat mods. I assume 1 tick/s, the target stays in the fire, and each rocket's patch burns on its own
  // (the cast: TS can't see the assignment inside applyEffect's closure)
  const napalmEffect = napalm as Extract<ModEffect, { kind: 'napalm' }> | null
  if (napalmEffect && attack.isAoE) {
    const napalm = napalmEffect
    const flat = (value: number): CritSplit => ({ normal: value, crit: value, average: value })
    const fireTick = (napalm.fraction / napalm.seconds) * baseDamage * (1 + bonus.damage) * heavyComboFactor * factionMultiplier * (1 + vulnerability)
    const ticks = Math.max(1, Math.round(napalm.seconds))
    const fireFactors = { fraction: napalm.fraction / napalm.seconds, statusBase: baseDamage * (1 + bonus.damage), element: 1, faction: factionMultiplier, statusDamage: 0, vulnerability, headshot: 1, merged: 1, type: typeMultiplier('heat') }
    const fire = flat(fireTick * typeMultiplier('heat'))
    dots.push({
      damageType: 'napalm', procsPerSecond: pelletsPerSecond, tick: fire, ticks, perProc: scaleSplit(fire, ticks), dps: fire.average * ticks * pelletsPerSecond, aoe: null,
      note: `Nightwatch Napalm: ${Math.round(napalm.fraction * 100)}% of the rocket's base damage (base damage and faction mods only) as Heat over ${napalm.seconds} s. No crits. Assumes the target stays in the fire and every rocket's patch burns separately.`,
      factors: fireFactors,
    })
    if (statusMode !== 'immune') {
      const heatScale = 1 + (elementBonus.heat ?? 0)
      const durationScale = 1 + bonus.statusDuration + (statusDurationByType['*'] ?? 0) + (statusDurationByType.heat ?? 0)
      const procTicks = Math.max(1, Math.floor(3 * durationScale + 1e-9))
      const procTick = flat(0.5 * fireTick * heatScale * typeMultiplier('heat'))
      const procsPerSecond = pelletsPerSecond * ticks * napalm.procChance
      dots.push({
        damageType: 'napalm-heat', procsPerSecond, tick: procTick, ticks: procTicks, perProc: scaleSplit(procTick, procTicks), dps: procTick.average * procTicks * procsPerSecond, aoe: null,
        note: `Heat procs from the napalm: ${Math.round(napalm.procChance * 100)}% per fire tick (mods don't change it), each ticking for 50% of a fire tick x (1 + Heat mods) for 3 s (longer with Status Duration). Counted from the moment the rocket lands.`,
        factors: { ...fireFactors, fraction: 0.5 * fireFactors.fraction, element: heatScale },
      })
    }
    const line = 'Nightwatch Napalm: target stays in the fire for the full burn'
    if (!requirements.includes(line)) requirements.push(line)
  }
  const dotDps = sum(dots.map((dot) => dot.dps))

  // ---- biggest single instance (damage cap tab) ----
  // any crit chance means the top tier can roll. a non-crit can only happen below 100%, Gotva's override rolls its own tiers
  const peakMultiplier = Math.max(
    critChance > 0 ? critHitMultiplier : normalCritMultiplier,
    critChance < 1 && nonCritPeakBonus > 0 ? 1 + nonCritPeakBonus : 0,
    critOverride ? 1 + Math.ceil(critOverride.critChance) * (critMultiplier - 1) : 0,
  )
  // Ballistic Battery adds to the base after damage mods, then elements/crit/faction/head scale it like the rest
  const batteryScale = moddedBaseDamage > 0 && oneShotFlat > 0 ? (moddedBaseDamage + oneShotFlat) / moddedBaseDamage : 1
  const peakHit = vsTargetNoCrit * peakMultiplier * beamMerge * batteryScale + (critChance > 0 ? puncturePart * Math.ceil(critChance) * doughtyBonus * beamMerge : 0)
  const peakDot = dots.filter((dot) => dot.damageType !== 'blast').sort((a, b) => b.tick.crit - a.tick.crit)[0]
  const peakDotTick = peakDot ? { damageType: peakDot.damageType, value: peakDot.tick.crit } : null

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
  // Ammo Efficiency: that share of shots is free, so a magazine fires magazine / (1 - efficiency) shots. capped at 75% in
  // total since Hotfix 44.1.3 ("only 1 in 4 shots uses ammo"); what used to be 100% is now "Infinite Ammo", which ignores it
  const ammoEfficiency = (infiniteAmmo as boolean) ? 0.99 : Math.min(AMMO_EFFICIENCY_CAP, bonus.ammoEfficiency)
  const shotsPerMagazine = magazineSize ? magazineSize / Math.max(0.01, 1 - ammoEfficiency) : null
  const uptime = shotsPerMagazine && reloadTime ? shotsPerMagazine / (fireRate * reloadTime + shotsPerMagazine) : 1
  const steadyStateDps = (burstDps + dotDps) * uptime

  // shots over time with procs on their own clocks (src/calc/simulate.ts)
  const pelletsPerSecondForModel = hitsPerAttack * fireRate
  const shotModel: ShotModel = {
    fireRate,
    multishot: hitsPerAttack,
    magazineSize: shotsPerMagazine,
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
      refreshes: dot.damageType === 'heat' && statusMode !== 'capped', // capped Heat can't pile past 4
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
      const elementMultiplier = info.usesElementMods ? 1 + (elementBonus[damageType] ?? 0) + (statusElementBonus[damageType] ?? 0) : 1
      const durationScale = 1 + bonus.statusDuration + (statusDurationByType['*'] ?? 0) + (statusDurationByType[damageType] ?? 0)
      const perProc =
        info.fraction * statusBase * elementMultiplier * factionMultiplier * (1 + bonus.statusDamage + (statusDamageByType[damageType] ?? 0)) * (1 + vulnerability) *
        typeMultiplier(damageType, info.bypassesArmor) * averageCritMultiplier * Math.floor(info.ticks * durationScale + 1e-9)
      existingStacks += stacks(damageType) * perProc * normalSwingScale
    }
    detonation = { ownProcs, existingStacks }
  }

  // everything one attack does: every pellet/duplicate plus the full DoT of each proc it lands (glaive detonations live on
  // their forced Slash, heavy Harmony on its procs). ticks that land later still count, unlike the single-hit score
  const attackTotal = averageShot + sum(dots.map((dot) => (fireRate > 0 ? dot.procsPerSecond / fireRate : 0) * dot.perProc.average))

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
    peakHit,
    peakDotTick,
    beam: Boolean(attack.continuous),
    beamMerge,
    multishotModsIgnored: Boolean(attack.noMultishotMods),
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
    attackTotal,
    duplicateStrikes: strikes,
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
    abilities: activeAbilities,
    requirements,
    statusTriggers,
    procTypes,
    setBonuses: setSummary(setPieces),
    heavyCombo,
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
    breakdown: {
      baseDamage, damageBonus: bonus.damage, separateMultiplier: separateDamageMultiplier, coMode: co.mode, coBonus,
      heavyCombo: heavyComboFactor, damageScale,
      types: Object.entries(moddedByType).map(([damageType, modded]) => ({
        damageType, share: moddedBaseDamage > 0 ? modded / moddedBaseDamage : 0, modded, type: typeMultiplier(damageType), ...typeFactors(damageType),
      })).sort((a, b) => b.modded - a.modded),
      typeParts: Object.entries(proportions).filter(([, raw]) => raw > 0)
        .map(([damageType, raw]) => ({ damageType, raw, parts: typeParts[damageType] ?? [] })).sort((a, b) => b.raw - a.raw),
      extraHit: extraHitNoCrit, faction: factionMultiplier, vulnerability, headshot: headshotFactor,
      critChance, critMultiplier, critAverage: averageCritMultiplier, critNormal: normalCritMultiplier, critHit: critHitMultiplier,
      attrition: attritionBonus,
    },
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
