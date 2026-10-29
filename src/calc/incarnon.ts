// turns the hand-collected Incarnon perk text (src/data/incarnon.ts) into effects the calc understands
import { INCARNON_FAMILIES } from '../data/incarnon'
import { parseStatLine, type ModEffect } from './parseMod'

export type PerkMode = 'both' | 'normal' | 'incarnon'
export type BaseStat = 'damage' | 'critChance' | 'critMultiplier' | 'statusChance' | 'multishot'

export type PerkEffect =
  | { kind: 'base'; stat: BaseStat; value: number } // added to the weapon's base stats before mods
  | { kind: 'flat'; stat: 'critChance' | 'statusChance'; value: number } // native Incarnons: added after mods
  | { kind: 'mod'; effect: ModEffect } // works like a mod line (+% Damage, +% Multishot, ...)
  | { kind: 'nonCritBonus'; chance: number; value: number } // Devouring/Devastating Attrition
  | { kind: 'armorStripPerPuncture'; value: number } // Latron's Flensing Spikes
  // Wiseman's Regard / Decisive Stature: base chance goes up by a share of the other modded chance, capped
  | { kind: 'convert'; stat: 'critChance' | 'statusChance'; from: 'critChance' | 'statusChance'; ratio: number; max: number }

export interface PerkStatement {
  text: string
  effect: PerkEffect | null // null = not modeled (ammo, recoil, combo...)
  mode: PerkMode
  condition: string | null
  maxStacks: number
}

export interface IncarnonPerk {
  tier: string
  name: string
  statements: PerkStatement[]
  maxStacks: number // 0 = no conditional part, 1 = on/off, more = stacks
}

export interface IncarnonTier {
  tier: string
  perks: IncarnonPerk[]
}

const TIER_ORDER = ['II', 'III', 'IV', 'V']
const percent = (text: string) => Number(text) / 100

function parsePerkBody(body: string, native: boolean): PerkEffect | null {
  const nonCrit = body.match(/^([\d.]+)% chance for \+([\d.]+)% Damage$/)
  if (nonCrit) return { kind: 'nonCritBonus', chance: percent(nonCrit[1]), value: percent(nonCrit[2]) }

  const armorStrip = body.match(/^Remove ([\d.]+)% Armor per Puncture stack$/)
  if (armorStrip) return { kind: 'armorStripPerPuncture', value: percent(armorStrip[1]) }

  const convert = body.match(/^\+([\d.]+)% of current (Critical|Status) Chance as Base (Critical|Status) Chance, up to ([\d.]+)%$/)
  if (convert) {
    const statOf = (word: string) => (word === 'Critical' ? 'critChance' : 'statusChance')
    return { kind: 'convert', stat: statOf(convert[3]), from: statOf(convert[2]), ratio: percent(convert[1]), max: percent(convert[4]) }
  }
  // timed genesis buffs whose wiki text has no "Base" (Prolific Perforation, Piercing Stature): I read them as flat after mods
  const flatChance = body.match(/^([+-][\d.]+)% Flat (Critical|Status) Chance$/)
  if (flatChance) return { kind: 'flat', stat: flatChance[2] === 'Critical' ? 'critChance' : 'statusChance', value: percent(flatChance[1]) }

  const baseDamage = body.match(/^\+?(-?[\d.]+) Base Damage$/)
  if (baseDamage) return { kind: 'base', stat: 'damage', value: Number(baseDamage[1]) }
  const baseCrit = body.match(/^([+-][\d.]+)% Base Critical Chance$/)
  if (baseCrit) return { kind: 'base', stat: 'critChance', value: percent(baseCrit[1]) }
  const baseCritMultiplier = body.match(/^([+-][\d.]+)x? Base Critical Multiplier$/)
  if (baseCritMultiplier) return { kind: 'base', stat: 'critMultiplier', value: Number(baseCritMultiplier[1]) }
  const baseStatus = body.match(/^([+-][\d.]+)% Base Status Chance$/)
  if (baseStatus) return { kind: 'base', stat: 'statusChance', value: percent(baseStatus[1]) }
  const baseMultishot = body.match(/^([+-][\d.]+) Base Multishot$/)
  if (baseMultishot) return { kind: 'base', stat: 'multishot', value: Number(baseMultishot[1]) }

  // plain crit/status chance: the native Incarnons add these flat after mods. on genesis weapons the
  // wiki text is "Base" (my notes dropped the word in a couple of spots), so treat it as base there
  const plainChance = body.match(/^([+-][\d.]+)% (Critical|Status) Chance$/)
  if (plainChance) {
    const stat = plainChance[2] === 'Critical' ? 'critChance' : 'statusChance'
    return native ? { kind: 'flat', stat, value: percent(plainChance[1]) } : { kind: 'base', stat, value: percent(plainChance[1]) }
  }

  const modEffect = parseStatLine(body)
  return modEffect ? { kind: 'mod', effect: modEffect } : null
}

function parsePerkLine(effects: string, native: boolean): PerkStatement[] {
  const statements: PerkStatement[] = []
  let condition: string | null = null

  for (const rawStatement of effects.split(/;\s*/).map((part) => part.trim()).filter(Boolean)) {
    const stackCap = rawStatement.match(/^Stacks up to (\d+)x\.?$/)
    if (stackCap) {
      // the cap belongs to whatever condition is running
      for (const statement of statements) if (statement.condition === condition && condition) statement.maxStacks = Number(stackCap[1])
      continue
    }

    let text = rawStatement
    let mode: PerkMode = 'both'
    const modeTag = text.match(/\s*\[(Incarnon Form only|Normal only)\]$/)
    if (modeTag) {
      mode = modeTag[1] === 'Normal only' ? 'normal' : 'incarnon'
      text = text.slice(0, modeTag.index).trim()
    }

    // "On Non-Critical Hit: 50% chance for +2000% Damage" is a chance roll, not something you toggle
    const nonCrit = text.match(/^On Non-Critical Hit:\s*(.+)$/)
    if (nonCrit) {
      statements.push({ text: rawStatement, effect: parsePerkBody(nonCrit[1], native), mode, condition: null, maxStacks: 1 })
      continue
    }

    // "When ...:" / "On ...:" starts a condition that sticks for the rest of the line
    const conditional = text.match(/^((?:When|On|While|With)\b[^:]*):\s*(.+)$/)
    if (conditional) {
      condition = conditional[1]
      text = conditional[2]
    }

    // "+10 Base Damage and +10% Fire Rate" -> two statements
    for (const part of text.split(/\s+and\s+(?=[+-]?\d)/)) {
      statements.push({ text: rawStatement, effect: parsePerkBody(part.trim(), native), mode, condition, maxStacks: 1 })
    }
  }
  return statements
}

// tiers + perks for one weapon. VARIANT lines win over ALL lines, and if neither matches I fall back to
// the family's first variant so the picker still shows something
export function getIncarnonTiers(weaponName: string): IncarnonTier[] | null {
  const family = INCARNON_FAMILIES.find((candidate) => candidate.variants.includes(weaponName))
  if (!family) return null

  const rows = family.lines
    .trim()
    .split('\n')
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length === 4)
    .map(([tier, name, variant, effects]) => ({ tier, name, variant, effects }))

  const tiers: IncarnonTier[] = []
  for (const tier of TIER_ORDER) {
    const perkNames = [...new Set(rows.filter((row) => row.tier === tier).map((row) => row.name))]
    if (!perkNames.length) continue
    const perks = perkNames.map((name) => {
      const candidates = rows.filter((row) => row.tier === tier && row.name === name)
      const row =
        candidates.find((candidate) => candidate.variant === weaponName) ??
        candidates.find((candidate) => candidate.variant === 'ALL') ??
        candidates[0]
      const statements = parsePerkLine(row.effects, Boolean(family.native))
      const conditionalStacks = statements.filter((statement) => statement.condition && statement.effect).map((statement) => statement.maxStacks)
      return { tier, name, statements, maxStacks: conditionalStacks.length ? Math.max(...conditionalStacks) : 0 }
    })
    tiers.push({ tier, perks })
  }
  return tiers
}

export interface SelectedPerk {
  perk: IncarnonPerk
  stacks: number // how many stacks of the conditional part are up (0 = off)
}

// melee Incarnon form is a state, not a separate attack in the data, so mode tags don't filter melee
export const perkAppliesTo = (mode: PerkMode, isIncarnonAttack: boolean, isMelee: boolean) =>
  mode === 'both' || isMelee || (mode === 'incarnon') === isIncarnonAttack
