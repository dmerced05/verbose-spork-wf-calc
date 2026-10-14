// what the Warframe build adds up to: Ability Strength, armor/health/shields, damage reduction, and the auras that buff
// weapons. mod and arcane text goes through the same parser as weapon mods (frameStat effects), auras and a few odd lines
// are read straight from the text here ("Squad receives +60% Melee Damage", Power Donation, Growing Power)
// damage reduction (wiki Damage_Reduction): "Sources of damage reduction (including armor) stack multiplicatively with each
// other", armor DR = armor / (armor + 300) and only on health, and the page's example gives shields "an innate 50% DR"
import { warframeBaseName } from '../data'
import { abilitiesById, type AbilityCast, type WarframeState } from '../data/warframeAbilities'
import type { Arcane, Mod, Warframe } from '../types'
import { parseUpgrade, type FrameStat, type ModEffect } from './parseMod'
import { countSets, setEnhancement, type SetPieces } from './modSets'

export interface EquippedWarframeMod {
  mod: Mod
  rank: number
  conditionalStacks?: number
}
export interface EquippedWarframeArcane {
  arcane: Arcane
  rank: number
  conditionalStacks: number
}

export interface WarframeBuild {
  frame: Warframe
  mods: EquippedWarframeMod[]
  arcanes: EquippedWarframeArcane[] // the frame's two arcane slots
  extraStrength: number // archon shards, anything not in the mods (fraction, 0.1 = +10%)
  extraArmor: number // flat armor from shards etc.
  teammateStrength: number // strength allies cast at
  casts: AbilityCast[] // your abilities, your subsumed one and allies' (built by the panel)
  shieldInnateDr?: boolean // shields' innate 50% DR, on unless turned off
  otherDr?: number // any other DR source not modeled (fraction)
}

export interface DrSource {
  label: string
  value: number // fraction of damage removed
  on: 'health' | 'shields' | 'both'
}

export interface WarframeTotals {
  abilityStrength: number // 1 = 100%
  armor: number
  health: number
  shields: number
  // damage reduction, multiplicative between sources
  drSources: DrSource[]
  healthDr: number // total vs health (armor included)
  shieldDr: number // total vs shields (no armor)
  effectiveHealth: number // health / (1 - healthDr) + shields / (1 - shieldDr)
  // Arcane Persistence's hit cap (needs armor above the threshold, Magnetic and nullifiers turn it off)
  damageCap: { source: string; armorNeeded: number; perSecond: number; active: boolean } | null
  setPieces: SetPieces // mod set pieces on the frame, they count with the weapon's for set bonuses
  // weapon damage from squad auras (Steel Charge, Rifle Amp, ...), by weapon group
  auraDamage: { melee: number; rifle: number; sniper: number; pistol: number; shotgun: number }
  weakpointCritChance: number // Worthy Comradery
  corrosiveProjections: number // auras that strip 18% armor each
  lines: string[] // what got counted, for the panel
}

const segments = (lines: string[]) => lines.flatMap((line) => line.split(/\\n|\n/)).map((segment) => segment.trim()).filter(Boolean)
const percent = (text: string) => Number(text) / 100
export const SHIELD_INNATE_DR = 0.5
export const armorDr = (armor: number) => (armor > 0 ? armor / (armor + 300) : 0)
const combineDr = (values: number[]) => 1 - values.reduce((taken, value) => taken * (1 - Math.min(1, Math.max(0, value))), 1)

export function warframeTotals(build: WarframeBuild): WarframeTotals {
  const flat = { armor: build.extraArmor, health: 0 }
  const scaling = { strength: build.extraStrength, armorPercent: 0, healthPercent: 0, shieldPercent: 0 }
  const drSources: DrSource[] = []
  const auraDamage = { melee: 0, rifle: 0, sniper: 0, pistol: 0, shotgun: 0 }
  let weakpointCritChance = 0
  let corrosiveProjections = 0
  const lines: string[] = []

  // frameStat effects from mods/arcanes, times their active stacks
  const addFrameStat = (source: string, stat: FrameStat, value: number, times: number) => {
    const total = value * times
    if (stat === 'damageResistance') drSources.push({ label: source, value: Math.min(0.9, total), on: 'both' })
    else if (stat === 'armor' || stat === 'health') flat[stat] += total
    else if (stat === 'strength') scaling.strength += total
    else scaling[stat] += total
    lines.push(`${source}: ${stat === 'armor' || stat === 'health' ? `+${Math.round(total)} ${stat}` : `${total >= 0 ? '+' : ''}${Math.round(total * 1000) / 10}% ${stat.replace('Percent', '').replace('damageResistance', 'DR')}`}`)
  }
  const addUpgrade = (name: string, levelStats: string[][], rank: number, stacks: number, enhance = 1) => {
    const parsed = parseUpgrade(levelStats, rank)
    const frameStat = (effect: ModEffect) => (effect.kind === 'frameStat' ? effect : null)
    for (const effect of parsed.effects) {
      const stat = frameStat(effect)
      if (stat) addFrameStat(name, stat.stat, stat.value, enhance)
    }
    for (const conditional of parsed.conditionals) {
      const stat = frameStat(conditional.effect)
      const active = Math.min(stacks, conditional.maxStacks)
      if (stat && active > 0) addFrameStat(name, stat.stat, stat.value, active * enhance)
    }
  }

  // mod sets on the frame (Umbra enhances its own mods: Fiber/Vitality x1.3 / x1.8, Intensify x1.25 / x1.75 with 2 / 3 pieces)
  const setPieces = countSets(build.mods.map(({ mod }) => mod))
  for (const { mod, rank, conditionalStacks } of build.mods) {
    const enhance = setEnhancement(mod, setPieces)
    addUpgrade(mod.name, mod.levelStats, rank, conditionalStacks ?? 0, enhance)
    if (enhance !== 1) lines.push(`${mod.name}: x${enhance} from its set`)
    // the lines the parser doesn't do: auras and a couple of strength oddballs
    const stats = mod.levelStats[Math.min(rank, mod.levelStats.length - 1)] ?? []
    for (const text of segments(stats)) {
      let match: RegExpMatchArray | null
      if ((match = text.match(/^You lose ([\d.]+)% Ability Strength/))) {
        scaling.strength -= percent(match[1]) // Power Donation
        lines.push(`${mod.name}: -${match[1]}% strength`)
      } else if ((match = text.match(/increases personal Ability Strength by ([\d.]+)%/))) {
        scaling.strength += percent(match[1]) // Growing Power, assumed up (weapon status procs keep it going)
        lines.push(`${mod.name}: +${match[1]}% strength (assumed up)`)
      } else if ((match = text.match(/^Squad receives \+([\d.]+)% Armor$/))) {
        scaling.armorPercent += percent(match[1]) // Stand United
        lines.push(`${mod.name}: +${match[1]}% armor`)
      } else if ((match = text.match(/^Squad gains \+([\d.]+)% Maximum Health$/))) {
        scaling.healthPercent += percent(match[1]) // Physique
        lines.push(`${mod.name}: +${match[1]}% health`)
      } else if ((match = text.match(/^Squad receives \+([\d.]+)% (Melee|Rifle|Sniper Rifle|Pistol|Shotgun) Damage$/))) {
        const group = ({ Melee: 'melee', Rifle: 'rifle', 'Sniper Rifle': 'sniper', Pistol: 'pistol', Shotgun: 'shotgun' } as const)[match[2] as 'Melee']
        auraDamage[group] += percent(match[1])
        lines.push(`${mod.name}: +${match[1]}% ${match[2].toLowerCase()} damage`)
      } else if ((match = text.match(/^Squad receives \+([\d.]+)% Weak Point Critical Chance$/))) {
        weakpointCritChance += percent(match[1])
        lines.push(`${mod.name}: +${match[1]}% weak point crit chance`)
      } else if (/^Enemies lose -18% Armor$/.test(text)) {
        corrosiveProjections += 1
        lines.push(`${mod.name}: -18% enemy armor`)
      }
    }
  }
  // Arcane Persistence: "Remove all Shields. If Armor is above 700: Cannot be hit for more than 500 Damage/s"
  let shieldsRemovedBy: string | null = null
  let damageCap: WarframeTotals['damageCap'] = null
  for (const { arcane, rank, conditionalStacks } of build.arcanes) {
    addUpgrade(arcane.name, arcane.levelStats, rank, conditionalStacks)
    const text = segments(arcane.levelStats[Math.min(rank, arcane.levelStats.length - 1)] ?? []).join(' ')
    if (/Remove all Shields/i.test(text)) shieldsRemovedBy = arcane.name
    const cap = text.match(/If Armor is above ([\d,]+): Cannot be hit for more than ([\d,]+) Damage\/s/i)
    if (cap) damageCap = { source: arcane.name, armorNeeded: Number(cap[1].replace(/,/g, '')), perSecond: Number(cap[2].replace(/,/g, '')), active: false }
  }

  const abilityStrength = Math.max(0, 1 + scaling.strength)

  // abilities: % of base armor/health/shields go in with the mods, DR sources stack multiplicatively
  const frameName = warframeBaseName(build.frame.name)
  for (const cast of build.casts) {
    const ability = abilitiesById.get(cast.id)
    if (!ability?.defense) continue
    if (ability.selfOnly && (cast.by !== 'self' || ability.warframe !== frameName)) continue
    const strength = !ability.scalesWithStrength ? 1 : cast.by === 'ally' ? build.teammateStrength : abilityStrength
    for (const effect of ability.defense) {
      if (effect.selfOnly && cast.by === 'ally') continue
      if (effect.kind === 'damageReduction') {
        const cap = cast.by === 'helminth' ? effect.helminthCap ?? effect.cap : effect.cap
        drSources.push({ label: ability.name, value: Math.min(cap, effect.perStack * effect.stacks * strength), on: 'both' })
      } else {
        scaling[effect.kind] += effect.value * strength
        lines.push(`${ability.name}: +${Math.round(effect.value * strength * 1000) / 10}% ${effect.kind.replace('Percent', '')}`)
      }
    }
  }

  const armor = Math.max(0, Math.round(build.frame.armor * (1 + scaling.armorPercent) + flat.armor))
  const health = Math.max(1, Math.round(build.frame.health * (1 + scaling.healthPercent) + flat.health))
  const shields = shieldsRemovedBy ? 0 : Math.max(0, Math.round(build.frame.shield * (1 + scaling.shieldPercent)))
  if (shieldsRemovedBy) lines.push(`${shieldsRemovedBy}: shields removed`)
  if (damageCap) damageCap.active = armor > damageCap.armorNeeded

  if ((build.otherDr ?? 0) > 0) drSources.push({ label: 'Other DR', value: build.otherDr!, on: 'both' })
  const allSources: DrSource[] = [
    { label: `Armor (${armor.toLocaleString()})`, value: armorDr(armor), on: 'health' },
    ...(build.shieldInnateDr === false || shields <= 0 ? [] : [{ label: 'Shields\' innate DR', value: SHIELD_INNATE_DR, on: 'shields' as const }]),
    ...drSources,
  ]
  const healthDr = combineDr(allSources.filter((source) => source.on !== 'shields').map((source) => source.value))
  const shieldDr = combineDr(allSources.filter((source) => source.on !== 'health').map((source) => source.value))
  const effectiveHealth = health / Math.max(1e-6, 1 - healthDr) + shields / Math.max(1e-6, 1 - shieldDr)

  return {
    abilityStrength, armor, health, shields,
    drSources: allSources, healthDr, shieldDr, effectiveHealth, damageCap, setPieces,
    auraDamage, weakpointCritChance, corrosiveProjections, lines,
  }
}

// what the damage calc gets (buffs.warframe)
export function warframeStateFor(build: WarframeBuild, totals: WarframeTotals): WarframeState {
  return {
    frameName: warframeBaseName(build.frame.name),
    abilityStrength: totals.abilityStrength,
    teammateStrength: build.teammateStrength,
    armor: totals.armor,
    health: totals.health,
    setPieces: totals.setPieces,
    casts: build.casts,
    arcanes: build.arcanes.map(({ arcane, rank, conditionalStacks }) => ({ arcaneId: arcane.uniqueName, rank, conditionalStacks })),
    auraDamage: totals.auraDamage,
    weakpointCritChance: totals.weakpointCritChance,
  }
}
