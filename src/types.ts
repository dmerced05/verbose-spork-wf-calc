import type { WarframeState } from './data/warframeAbilities'

export type DamageMap = Record<string, number>

export interface Attack {
  name: string
  isAoE: boolean
  fireRate: number
  chargeTime?: number | null // seconds, charged attacks only
  multishot?: number // per attack, falls back to the weapon's
  critChance: number // fraction, 0.3 = 30%
  critMultiplier: number
  statusChance: number // fraction
  damage: DamageMap
  heavy?: boolean // Heavy Attack / Heavy Slam: x combo multiplier, uses up the combo
  windUp?: number | null // heavy attack wind-up in seconds
  heavyMultiplier?: number // Heavy Attack only: how much bigger than the normal attack it is
}

export interface Weapon {
  uniqueName: string
  name: string
  type: string // Rifle, Sniper, Launcher, Bow, Shotgun, Pistol, Dual Pistols, Throwing, Melee
  category: string
  disposition: number | null
  multishot: number
  trigger?: string | null // Auto, Semi, Burst, Charge, Held, ...
  magazineSize?: number | null
  reloadTime?: number | null // seconds
  imageName: string | null
  polarities: string[]
  isBow: boolean
  attacks: Attack[]
}

export interface Mod {
  uniqueName: string
  name: string
  type: string // Primary Mod, Shotgun Mod, Secondary Mod, Melee Mod
  compatName: string | null
  polarity: string | null
  rarity: string | null
  baseDrain: number
  fusionLimit: number // max rank
  imageName: string | null
  isExilus: boolean
  semiOnly?: boolean // Semi-___ Cannonade
  locksFireRate?: boolean // Semi-___ Cannonade: fire rate mods stop working
  levelStats: string[][] // stat lines per rank, index 0 = rank 0
}

export interface Warframe {
  uniqueName: string
  name: string
  health: number
  shield: number
  armor: number
  energy: number
  auraPolarities: (string | null)[] // one per aura slot (Jade has two)
  polarities: string[]
  exilusPolarity: string | null
  passive: string | null
  imageName: string | null
}

export interface Arcane {
  uniqueName: string
  name: string
  type: string // Primary Arcane, Secondary Arcane, Melee Arcane, Bow Arcane, Shotgun Arcane
  rarity: string | null
  imageName: string | null
  levelStats: string[][] // index 0 = rank 0, max rank is levelStats.length - 1 (5)
}

export interface EquippedArcane {
  arcane: Arcane
  rank: number
  conditionalStacks: number
}

export interface Enemy {
  uniqueName: string
  name: string
  faction: string
  health: number
  shield: number
  armor: number
}

export interface EquippedMod {
  mod: Mod
  rank: number
  conditionalStacks: number // how many stacks of the "On Kill:" style bonus are up
}

export type TargetLayer = 'health' | 'shield' | 'overguard'

export interface TargetSettings {
  faction: string
  layer: TargetLayer
  enemyId: string | null // preset enemy, armor gets level scaled from it
  baseLevel: number
  level: number
  steelPath: boolean // +100 levels, x2.5 health and shields
  manualArmor: number // used when no preset is picked
  headshot: boolean // main results assume headshots
  headshotMultiplier?: number | null // the head's weak point multiplier, null = auto from faction (3x on most)
  headcrit?: boolean | null // crit headshots double the weapon's base crit multiplier, null = auto from faction
}

export interface Debuffs {
  stacks: Record<string, number> // status type -> stacks (on/off statuses use 0/1)
  heatArmorStrip: number // current Ignite strip stage, 0-0.5
  corrosiveProjections: number // number of Corrosive Projection auras, 0-4
  otherArmorReduction: number // fraction, any other % armor strip
  damageVulnerability: number // fraction, generic "takes X% more damage" multiplier
  liftedOrKnockedDown: boolean // hidden status, counts as a status type for Condition Overload
  // what Condition Overload / Galvanized count: the build's own damage types (default) or the stacks set above
  statusTypeSource: 'build' | 'debuffs'
}

export interface Buffs {
  roar: number // faction damage bonus from Roar etc, additive with bane mods
  combo?: number // melee combo multiplier (1x-12x), defaults to 1x
  gladiatorWarframePieces?: number // Gladiator set mods on the Warframe, they count toward the weapon's set bonus
  warframe?: WarframeState // ability strength, armor and active abilities (Warframe panel)
}
