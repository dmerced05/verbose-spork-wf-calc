// riven mods (wiki Riven_Mods, Riven_Splicer). the user types in their riven's stats, I turn it into a normal Mod so
// the calc treats it like anything else. never offered to the optimizer or leaderboard since rolls are pure RNG.
//
// value at max rank = base x disposition x layout weight x roll, roll is 90%..110% ("randomly chosen between 90% and 110%
// of the base value, multiplied by the weapon's Riven Disposition"). base comes from the export (scripts/build-data.mjs)
// splicing (Update 44.1): two traits are consumed, the spliced trait "inherits the higher random value out of the
// consumed stats", a random trait fills the freed slot (negative if a negative was consumed), the spliced trait is
// always positive and there's only one per riven
import rivensJson from '../data/rivens.json'
import type { Mod, Weapon } from '../types'

export type RivenType = 'Rifle' | 'Shotgun' | 'Pistol' | 'Melee'

export interface RivenStatDef {
  tag: string
  text: string // "% Critical Chance", " Damage to Corpus", "s Combo Duration"
  base: number // max rank base before disposition/weight (0.9 = 90%)
  reversed?: boolean // shown with the opposite sign (Ammo Efficiency)
}

export interface RivenStat {
  tag: string
  value: number // as shown in game at rank 8, in the stat's units (percent for % stats)
  negative: boolean
}

export interface RivenConfig {
  stats: RivenStat[]
  polarity: 'madurai' | 'naramon' | 'vazarin'
  drain: number // at rank 8, 10..18
}

export const RIVEN_MOD_ID = 'riven'
// Hotfix 44.1.3 (2026-10-22, wiki Riven_Mods/Patch_History): "Removed Riven Dispositions. All Rivens now use the same
// multiplier for their possible value ranges, the equivalent of 1.2 Disposition in the old system."
export const RIVEN_DISPOSITION = 1.2
export const RIVEN_MAX_RANK = 8
export const emptyRiven = (): RivenConfig => ({ stats: [], polarity: 'madurai', drain: 18 })

const POOLS = rivensJson as Record<RivenType, RivenStatDef[]>

export const rivenTypeFor = (weapon: Weapon): RivenType | null => {
  if (!weapon.rivenDisposition) return null
  if (weapon.category === 'Melee') return 'Melee'
  if (weapon.category === 'Secondary') return 'Pistol'
  return weapon.type === 'Shotgun' ? 'Shotgun' : 'Rifle'
}
export const rivenPool = (type: RivenType) => POOLS[type]

// wiki Riven_Splicer recipes. the spliced traits only come from splicing, never from a normal roll
const RANGED_RECIPES: [string, string, string][] = [
  ['WeaponWeakpointDamage', 'WeaponDamageAmountMod', 'WeaponZoomFovMod'],
  ['WeaponWeakpointDamage', 'WeaponDamageAmountMod', 'WeaponFireIterationsMod'],
  ['WeaponWeakpointCriticalChance', 'WeaponCritChanceMod', 'WeaponZoomFovMod'],
  ['WeaponWeakpointCriticalChance', 'WeaponCritChanceMod', 'WeaponFireIterationsMod'],
  ['WeaponAmmoEfficiency', 'WeaponClipMaxMod', 'WeaponReloadSpeedMod'],
  ['WeaponAmmoEfficiency', 'WeaponRecoilReductionMod', 'WeaponAmmoMaxMod'],
  ['WeaponMagazineReloadHolstered', 'WeaponAmmoMaxMod', 'WeaponReloadSpeedMod'],
  ['WeaponMagazineReloadHolstered', 'WeaponAmmoMaxMod', 'WeaponClipMaxMod'],
  ['WeaponStatusDamage', 'WeaponDamageAmountMod', 'WeaponStunChanceMod'],
  ['WeaponFactionDamageOrokin', 'WeaponFactionDamageCorpus', 'WeaponFactionDamageGrineer'],
  ['WeaponFactionDamageTechrot', 'WeaponFactionDamageCorpus', 'WeaponFactionDamageInfested'],
  ['WeaponFactionDamageScaldra', 'WeaponFactionDamageInfested', 'WeaponFactionDamageGrineer'],
]
const MELEE_RECIPES: [string, string, string][] = [
  ['WeaponMeleeHeavyAttackDamageMod', 'WeaponMeleeComboEfficiencyMod', 'WeaponMeleeComboBonusOnHitMod'],
  ['WeaponMeleeHeavyAttackChargeMod', 'WeaponMeleeComboEfficiencyMod', 'ComboDurationMod'],
  ['WeaponMeleeParryAngleMod', 'WeaponFireRateMod', 'WeaponMeleeRangeIncMod'],
  ['WeaponMeleeSlamDamageMod', 'WeaponMeleeDamageMod', 'WeaponFireRateMod'],
  ['WeaponStatusDamage', 'WeaponMeleeDamageMod', 'WeaponStunChanceMod'],
  ['WeaponFactionDamageOrokin', 'WeaponMeleeFactionDamageCorpus', 'WeaponMeleeFactionDamageGrineer'],
  ['WeaponFactionDamageTechrot', 'WeaponMeleeFactionDamageCorpus', 'WeaponMeleeFactionDamageInfested'],
  ['WeaponFactionDamageScaldra', 'WeaponMeleeFactionDamageInfested', 'WeaponMeleeFactionDamageGrineer'],
]
const ELEMENT_RECIPES: [string, string, string][] = [
  ['WeaponGasDamageMod', 'WeaponToxinDamageMod', 'WeaponFireDamageMod'],
  ['WeaponCorrosiveDamageMod', 'WeaponToxinDamageMod', 'WeaponElectricityDamageMod'],
  ['WeaponViralDamageMod', 'WeaponToxinDamageMod', 'WeaponFreezeDamageMod'],
  ['WeaponRadiationDamageMod', 'WeaponFireDamageMod', 'WeaponElectricityDamageMod'],
  ['WeaponBlastDamageMod', 'WeaponFireDamageMod', 'WeaponFreezeDamageMod'],
  ['WeaponMagneticDamageMod', 'WeaponElectricityDamageMod', 'WeaponFreezeDamageMod'],
]
export const spliceRecipes = (type: RivenType) => [...(type === 'Melee' ? MELEE_RECIPES : RANGED_RECIPES), ...ELEMENT_RECIPES]
const splicedTags = (type: RivenType) => new Set(spliceRecipes(type).map(([result]) => result))
export const isSpliced = (type: RivenType, tag: string) => splicedTags(type).has(tag)

// "% Critical Chance (x2 for Heavy Attacks)" -> "Critical Chance (x2 for Heavy Attacks)", for dropdowns
export const statName = (def: RivenStatDef) => def.text.replace(/^(%|s)?\s*/, '')
const statDef = (type: RivenType, tag: string) => POOLS[type].find((def) => def.tag === tag)

// wiki "Attribute Value Formula" weights
export function layoutWeight(positives: number, negatives: number, negative: boolean) {
  if (negative) return positives === 3 ? -0.75 : -0.495
  if (positives === 3) return negatives ? 0.9375 : 0.75
  return negatives ? 1.2375 : 0.99
}

// the stat as it shows in game: Ammo Efficiency's export value is negative but displays as a bonus
const displayBase = (def: RivenStatDef) => (def.reversed ? -def.base : def.base) * (def.text.startsWith('%') || def.text.includes('Damage to') ? 100 : 1)
// rows without a stat yet (the random trait after a splice) still hold a slot in the layout
const layoutOf = (stats: RivenStat[]) => ({ positives: stats.filter((stat) => !stat.negative).length, negatives: stats.filter((stat) => stat.negative).length })

// [low, high] at rank 8 in display units, for this stat in this riven's layout
export function rivenRange(type: RivenType, disposition: number, stats: RivenStat[], stat: Pick<RivenStat, 'tag' | 'negative'>): [number, number] | null {
  const def = statDef(type, stat.tag)
  if (!def) return null
  const { positives, negatives } = layoutOf(stats)
  const center = displayBase(def) * disposition * layoutWeight(Math.max(2, positives), negatives, stat.negative)
  const [a, b] = [center * 0.9, center * 1.1]
  return a < b ? [a, b] : [b, a]
}
// where the value sits in the 90-110% roll window, 1 = perfectly average
export function rivenRoll(type: RivenType, disposition: number, stats: RivenStat[], stat: RivenStat) {
  const range = rivenRange(type, disposition, stats, stat)
  if (!range) return null
  const center = (range[0] + range[1]) / 2
  return center === 0 ? null : stat.value / center
}

// splice two of the riven's stats: the spliced trait takes the better roll, the freed slot gets an empty row of the
// same sign for the user to fill with whatever the game rolled
export function applySplice(type: RivenType, disposition: number, config: RivenConfig, recipe: [string, string, string]): RivenConfig {
  const [result, first, second] = recipe
  const consumed = config.stats.filter((stat) => stat.tag === first || stat.tag === second)
  const rolls = consumed.map((stat) => rivenRoll(type, disposition, config.stats, stat) ?? 1)
  const kept = config.stats.filter((stat) => !consumed.includes(stat))
  const anyNegative = consumed.some((stat) => stat.negative)
  const next = [...kept, { tag: result, value: 0, negative: false }, { tag: '', value: 0, negative: anyNegative }]
  const range = rivenRange(type, disposition, next, { tag: result, negative: false })!
  const value = ((range[0] + range[1]) / 2) * Math.max(...rolls)
  return { ...config, stats: next.map((stat) => (stat.tag === result ? { ...stat, value: Math.round(value * 10) / 10 } : stat)) }
}
export const availableSplices = (type: RivenType, config: RivenConfig) =>
  config.stats.some((stat) => isSpliced(type, stat.tag))
    ? [] // "only one spliced trait can be on a Riven at a time"
    : spliceRecipes(type).filter(([, first, second]) => config.stats.some((stat) => stat.tag === first) && config.stats.some((stat) => stat.tag === second))

export function rivenIssues(type: RivenType, disposition: number, config: RivenConfig): string[] {
  const issues: string[] = []
  const filled = config.stats.filter((stat) => stat.tag)
  const { positives, negatives } = layoutOf(config.stats)
  if (positives < 2 || positives > 3) issues.push('A riven has 2 or 3 positive stats')
  if (negatives > 1) issues.push('A riven has at most 1 negative stat')
  if (new Set(filled.map((stat) => stat.tag)).size !== filled.length) issues.push('The same stat can\'t roll twice')
  const spliced = filled.filter((stat) => isSpliced(type, stat.tag))
  if (spliced.length > 1) issues.push('Only one spliced stat per riven')
  if (spliced.some((stat) => stat.negative)) issues.push('Spliced stats are always positive')
  if (config.stats.some((stat) => !stat.tag)) issues.push('Pick the stat the game rolled into the freed slot')
  for (const stat of filled) {
    const range = rivenRange(type, disposition, config.stats, stat)
    if (range && (stat.value < range[0] - 0.05 || stat.value > range[1] + 0.05)) {
      issues.push(`${statName(statDef(type, stat.tag)!)} is outside ${fmt(range[0])} to ${fmt(range[1])} for this layout`)
    }
  }
  return issues
}
export const fmt = (value: number) => (Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2)).replace(/\.?0+$/, '')

// one stat line the way the mod parser reads it, at a given rank (values scale with rank: rank 0 is 1/9 of max)
function statLine(def: RivenStatDef, value: number, isBow: boolean): string {
  const text = def.text.replace(/^(%|s)?\s*/, '')
  if (text.startsWith('Damage to ')) return `x${fmt(1 + value / 100)} ${text}` // like the Expel/Bane mods
  // "x2 for Bows" is how the game shows it, the effect on a bow really is doubled
  if (text === 'Fire Rate (x2 for Bows)') return `${value >= 0 ? '+' : ''}${fmt(isBow ? value * 2 : value)}% Fire Rate`
  const unit = def.text.startsWith('%') ? '%' : def.text.startsWith('s') ? 's' : ''
  return `${value >= 0 ? '+' : ''}${fmt(value)}${unit} ${text}`
}

// the riven as a normal Mod, levelStats for ranks 0..8
export function rivenMod(weapon: Weapon, config: RivenConfig): Mod | null {
  const type = rivenTypeFor(weapon)
  if (!type) return null
  const stats = config.stats.filter((stat) => stat.tag && statDef(type, stat.tag))
  return {
    uniqueName: RIVEN_MOD_ID,
    name: `${weapon.name} Riven`,
    type: weapon.category === 'Melee' ? 'Melee Mod' : weapon.category === 'Secondary' ? 'Secondary Mod' : weapon.type === 'Shotgun' ? 'Shotgun Mod' : 'Primary Mod',
    compatName: weapon.name,
    polarity: config.polarity,
    rarity: 'Riven',
    baseDrain: config.drain - RIVEN_MAX_RANK,
    fusionLimit: RIVEN_MAX_RANK,
    imageName: null,
    isExilus: false,
    levelStats: Array.from({ length: RIVEN_MAX_RANK + 1 }, (_, rank) =>
      stats.map((stat) => statLine(statDef(type, stat.tag)!, (stat.value * (rank + 1)) / (RIVEN_MAX_RANK + 1), Boolean(weapon.isBow)))),
  }
}
