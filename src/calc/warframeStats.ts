// what the equipped Warframe mods add up to: Ability Strength, armor, and the auras that buff weapons.
// the mod text comes straight from the export ("+30% Ability Strength", "Squad receives +60% Melee Damage")
import { warframeBaseName } from '../data'
import type { WarframeState } from '../data/warframeAbilities'
import type { Mod, Warframe } from '../types'

export interface EquippedWarframeMod {
  mod: Mod
  rank: number
}

export interface WarframeBuild {
  frame: Warframe
  mods: EquippedWarframeMod[]
  extraStrength: number // archon shards, arcanes... (fraction, 0.1 = +10%)
  extraArmor: number // flat armor from shards etc.
  teammateStrength: number // strength used for abilities from other frames in the squad
  abilities: Record<string, boolean>
}

export interface WarframeTotals {
  abilityStrength: number // 1 = 100%
  armor: number
  // weapon damage from squad auras (Steel Charge, Rifle Amp, ...), by weapon group
  auraDamage: { melee: number; rifle: number; sniper: number; pistol: number; shotgun: number }
  weakpointCritChance: number // Worthy Comradery
  corrosiveProjections: number // auras that strip 18% armor each
  lines: string[] // what got counted, for the panel
}

const segments = (lines: string[]) => lines.flatMap((line) => line.split(/\\n|\n/)).map((segment) => segment.trim()).filter(Boolean)
const percent = (text: string) => Number(text) / 100

export function warframeTotals(build: WarframeBuild): WarframeTotals {
  let strength = 1 + build.extraStrength
  let armorPercent = 0
  const auraDamage = { melee: 0, rifle: 0, sniper: 0, pistol: 0, shotgun: 0 }
  let weakpointCritChance = 0
  let corrosiveProjections = 0
  const lines: string[] = []

  for (const { mod, rank } of build.mods) {
    const stats = mod.levelStats[Math.min(rank, mod.levelStats.length - 1)] ?? []
    for (const text of segments(stats)) {
      let match: RegExpMatchArray | null
      if ((match = text.match(/^([+-][\d.]+)% Ability Strength$/))) {
        strength += percent(match[1])
        lines.push(`${mod.name}: ${match[1]}% strength`)
      } else if ((match = text.match(/^You lose ([\d.]+)% Ability Strength/))) {
        strength -= percent(match[1]) // Power Donation
        lines.push(`${mod.name}: -${match[1]}% strength`)
      } else if ((match = text.match(/increases personal Ability Strength by ([\d.]+)%/))) {
        strength += percent(match[1]) // Growing Power, assumed up (weapon status procs keep it going)
        lines.push(`${mod.name}: +${match[1]}% strength (assumed up)`)
      } else if ((match = text.match(/^(?:Squad receives )?([+-][\d.]+)% Armor$/))) {
        armorPercent += percent(match[1])
        lines.push(`${mod.name}: ${match[1]}% armor`)
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

  return {
    abilityStrength: Math.max(0, strength),
    armor: Math.round(build.frame.armor * (1 + armorPercent) + build.extraArmor),
    auraDamage,
    weakpointCritChance,
    corrosiveProjections,
    lines,
  }
}

// what the damage calc gets (buffs.warframe)
export function warframeStateFor(build: WarframeBuild, totals: WarframeTotals): WarframeState {
  return {
    frameName: warframeBaseName(build.frame.name),
    abilityStrength: totals.abilityStrength,
    teammateStrength: build.teammateStrength,
    armor: totals.armor,
    abilities: build.abilities,
    auraDamage: totals.auraDamage,
    weakpointCritChance: totals.weakpointCritChance,
  }
}
