// all the game numbers live here so they're easy to check against the wiki
// sources: wiki.warframe.com/w/Damage/Calculation, /w/Status_Effect, /w/Damage/Overview_Table,
// /w/Heat, /w/Cold, /w/Viral, /w/Faction_Damage_Bonus, /w/Enemy_Level_Scaling

export const PHYSICAL_TYPES = ['impact', 'puncture', 'slash']
export const PRIMARY_ELEMENTS = ['heat', 'cold', 'electricity', 'toxin']
export const DAMAGE_TYPES = [
  'impact', 'puncture', 'slash', 'heat', 'cold', 'electricity', 'toxin',
  'blast', 'corrosive', 'gas', 'magnetic', 'radiation', 'viral', 'void', 'tau', 'true',
]

// elements combine in slot order, two at a time
export const COMBINED_ELEMENTS: Record<string, string> = {
  'cold+heat': 'blast',
  'electricity+toxin': 'corrosive',
  'heat+toxin': 'gas',
  'cold+electricity': 'magnetic',
  'cold+toxin': 'viral',
  'electricity+heat': 'radiation',
}

// Update 36 faction weaknesses: vulnerable = x1.5, resistant = x0.5 (Damage/Overview_Table)
export const FACTION_DAMAGE_MODIFIERS: Record<string, Record<string, number>> = {
  Grineer: { impact: 1.5, corrosive: 1.5 },
  'Kuva Grineer': { impact: 1.5, corrosive: 1.5, heat: 0.5 },
  Scaldra: { impact: 1.5, corrosive: 1.5, gas: 0.5 },
  Corpus: { puncture: 1.5, magnetic: 1.5 },
  'Corpus Amalgam': { electricity: 1.5, magnetic: 1.5, blast: 0.5 },
  Infested: { slash: 1.5, heat: 1.5 },
  'Infested Deimos': { blast: 1.5, gas: 1.5, viral: 0.5 },
  Orokin: { puncture: 1.5, viral: 1.5, radiation: 0.5 },
  Sentient: { cold: 1.5, radiation: 1.5, corrosive: 0.5 },
  Narmer: { slash: 1.5, toxin: 1.5, magnetic: 0.5 },
  'The Murmur': { electricity: 1.5, radiation: 1.5, viral: 0.5 },
  Techrot: { gas: 1.5, magnetic: 1.5, cold: 0.5 },
  Anarchs: { impact: 1.5, electricity: 1.5, radiation: 0.5 },
  Zariman: { void: 1.5 },
}
export const FACTIONS = ['None', ...Object.keys(FACTION_DAMAGE_MODIFIERS)]

// which Bane/Primed Bane mod ("x1.3 Damage to Grineer") counts against which faction
// TODO: double check Scaldra/Techrot/Narmer don't take any bane
export const BANE_TARGET: Record<string, string> = {
  Grineer: 'Grineer',
  'Kuva Grineer': 'Grineer',
  Corpus: 'Corpus',
  'Corpus Amalgam': 'Corpus',
  Infested: 'Infested',
  'Infested Deimos': 'Infested',
  Orokin: 'Orokin',
  'The Murmur': 'Murmur',
}

export interface StatusInfo {
  name: string
  maxStacks: number | null // null = stack count doesn't change any number here, it's just on/off
  effect: string
}

export const STATUS_EFFECTS: Record<string, StatusInfo> = {
  impact: { name: 'Knockback', maxStacks: 5, effect: 'No damage multiplier' },
  puncture: { name: 'Weakened', maxStacks: 5, effect: '+5% crit chance per stack (flat)' },
  slash: { name: 'Bleed', maxStacks: null, effect: 'DoT only' },
  heat: { name: 'Ignite', maxStacks: null, effect: 'Strips up to 50% armor' },
  cold: { name: 'Freeze', maxStacks: 10, effect: '+0.1x crit mult, +0.05x per stack, +1.0x at 10' },
  electricity: { name: 'Tesla Chain', maxStacks: null, effect: 'DoT only' },
  toxin: { name: 'Poison', maxStacks: null, effect: 'DoT only' },
  blast: { name: 'Detonate', maxStacks: 10, effect: 'No damage multiplier' },
  corrosive: { name: 'Corrosion', maxStacks: 10, effect: '-26% armor, -6% per stack (80% max)' },
  gas: { name: 'Gas Cloud', maxStacks: 10, effect: 'DoT only' },
  magnetic: { name: 'Disrupt', maxStacks: 10, effect: '+100% shield/overguard dmg, +25% per stack' },
  radiation: { name: 'Confusion', maxStacks: 10, effect: 'No damage multiplier' },
  viral: { name: 'Virus', maxStacks: 10, effect: '+100% health dmg, +25% per stack' },
  void: { name: 'Bullet Attractor', maxStacks: null, effect: 'No damage multiplier' },
  tau: { name: 'Status Vulnerability', maxStacks: 10, effect: '+10% status chance per stack (flat)' },
}
export const STATUS_TYPES = Object.keys(STATUS_EFFECTS)

export const viralMultiplier = (stacks: number) => (stacks > 0 ? 2 + 0.25 * (Math.min(stacks, 10) - 1) : 1)
export const magneticMultiplier = viralMultiplier // same curve, just for shields/overguard
export const corrosiveArmorReduction = (stacks: number) => (stacks > 0 ? 0.2 + 0.06 * Math.min(stacks, 10) : 0)
export const coldCritMultiplierBonus = (stacks: number) => {
  if (stacks <= 0) return 0
  if (stacks >= 10) return 1.0
  return 0.1 + 0.05 * (stacks - 1)
}
export const punctureCritChanceBonus = (stacks: number) => 0.05 * Math.min(stacks, 5)
export const tauStatusChanceBonus = (stacks: number) => 0.1 * Math.min(stacks, 10)

export const HEAT_ARMOR_STRIP_STAGES = [0, 0.15, 0.3, 0.4, 0.5] // ramps every 0.5s after the proc
export const CORROSIVE_PROJECTION_PER_AURA = 0.18

// status proc damage, per Damage_over_Time / Gas / Blast wiki pages:
//   tick = fraction x modded base x (1 + element mod) x (1 + faction) x (1 + status damage) x crit x body part
//   modded base = base x (1 + damage mods) x (1 + faction)   <- so faction counts twice
// ticks: Total Ticks = floor(rate x (duration - delay)) + 1. Slash/Heat/Toxin start after 1s and tick 1-6s,
// Electricity/Gas tick 0-5s (the 7th tick at 6s deals nothing), so 6 damaging ticks for all of them.
export interface DotInfo {
  fraction: number
  ticks: number
  usesElementMods: boolean // only literal element mods count (Hellfire -> Heat). Blast/Slash get none
  bypassesArmor: boolean
  fullHeadshot: boolean // Gas clouds only get headshot *bonuses* (Target Acquired etc), base 1x
  note: string
}

export const DOT_STATUSES: Record<string, DotInfo> = {
  slash: { fraction: 0.35, ticks: 6, usesElementMods: false, bypassesArmor: true, fullHeadshot: true, note: 'Ticks 1-6s, ignores armor. Physical mods (Sawtooth Clip) don\'t buff it.' },
  heat: { fraction: 0.5, ticks: 6, usesElementMods: true, bypassesArmor: false, fullHeadshot: true, note: 'Ticks 1-6s. New Heat procs refresh every Heat stack, so sustained fire keeps them ticking longer than this.' },
  toxin: { fraction: 0.5, ticks: 6, usesElementMods: true, bypassesArmor: false, fullHeadshot: true, note: 'Ticks 1-6s, skips shields.' },
  electricity: { fraction: 0.5, ticks: 6, usesElementMods: true, bypassesArmor: false, fullHeadshot: true, note: 'Ticks 0-5s, also hits enemies within 3m and stuns.' },
  gas: { fraction: 0.5, ticks: 6, usesElementMods: true, bypassesArmor: false, fullHeadshot: false, note: 'Cloud ticks 0-5s on everything within 3m (+0.3m per stack, 10 clouds max). Heat/Toxin mods don\'t buff it.' },
  blast: { fraction: 0.3, ticks: 1, usesElementMods: false, bypassesArmor: false, fullHeadshot: true, note: 'Single hit after a 1.5s fuse. 10-stack AoE = all stacks popping for 300% to enemies within 5m (not the target). Heat/Cold/Blast mods don\'t buff it.' },
}

// at 10 stacks (or on death) every Blast stack pops at once: the target takes the 10 x 30% it was owed,
// and enemies within 5m (not the target) take 300% modded base, no falloff
export const BLAST_DETONATION_MULTIPLIER = 3

// wiki Weak_Point: heads are 3x on most factions, ~1.5x on Murmur and Techrot.
// "headcrit" heads also double the weapon's base crit multiplier on crits. Grineer (incl. Corrupted, Narmer,
// Anarchs), Scaldra and most Infested/Sentients have them, most Corpus, Murmur and much of Techrot don't.
export const HEAD_WEAK_POINT_MULTIPLIER: Record<string, number> = { 'The Murmur': 1.5, Techrot: 1.5 }
export const DEFAULT_HEAD_MULTIPLIER = 3
export const HEADCRIT_FACTIONS = new Set([
  'None', 'Grineer', 'Kuva Grineer', 'Scaldra', 'Orokin', 'Narmer', 'Anarchs', 'Infested', 'Infested Deimos', 'Sentient',
])
export const HEADCRIT_MULTIPLIER = 2

// auto values when the target panel isn't overriding them
export const headMultiplierFor = (faction: string) => HEAD_WEAK_POINT_MULTIPLIER[faction] ?? DEFAULT_HEAD_MULTIPLIER
export const hasHeadcrits = (faction: string) => HEADCRIT_FACTIONS.has(faction)

// a couple of the U36 faction names don't match what people call them in game
export const FACTION_LABELS: Record<string, string> = { Orokin: 'Orokin (Corrupted)', Zariman: 'Zariman (Void)' }
export const factionLabel = (faction: string) => FACTION_LABELS[faction] ?? faction
export const WEAK_POINT_BONUS_RATE_ON_HEAD = 1.5 // weak point damage bonuses count 1.5x on heads

// ---- melee combo (wiki Melee_Combo) ----
// every 20 hits adds 1x, starting at 1x and capping at 12x on 220 hits. Venka Prime goes to 13x,
// Dex Nikana needs only 11 hits per tier but caps at 11x
export const DEFAULT_MAX_COMBO = 12
const MAX_COMBO_BY_WEAPON: Record<string, number> = { 'Venka Prime': 13, 'Dex Nikana': 11 }
const HITS_PER_TIER_BY_WEAPON: Record<string, number> = { 'Dex Nikana': 11 }
export const maxComboFor = (weaponName: string) => MAX_COMBO_BY_WEAPON[weaponName] ?? DEFAULT_MAX_COMBO
export const hitsPerComboTier = (weaponName: string) => HITS_PER_TIER_BY_WEAPON[weaponName] ?? 20
// Heavy Attack Efficiency keeps part of the counter, capped at 90% (wiki Melee_Combo)
export const MAX_HEAVY_EFFICIENCY = 0.9
// Gladiator set bonus: +10% melee crit chance per piece, per combo multiplier, same shape as Blood Rush
export const GLADIATOR_CRIT_PER_PIECE = 0.1
export const GLADIATOR_MAX_PIECES = 6
