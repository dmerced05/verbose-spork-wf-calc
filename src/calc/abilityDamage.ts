// Warframe ability damage. each ability (src/data/abilityDamage.ts) turns its wiki numbers into a timeline of hits, raw
// damage with Ability Strength already in, and I run that against the target here: damage type vs faction, armor, Viral,
// vulnerability, Roar and the Archon Shard "Ability Damage on enemies affected by X" bonuses, plus the DoTs from the
// status procs the ability puts out (same tick rules as weapons, src/calc/constants.ts DOT_STATUSES)
//  - wiki Ability_Damage: sources are the shards (+10%, +15% tauforged), Shattering Frost and Roar ("bonus damage to all
//    weapons and abilities")
//  - wiki Damage_Vulnerability: "Damage Vulnerability effects multiply the damage that a target receives"
//  - abilities don't crit unless their page says so, so there's no crit here at all
import { DOT_STATUSES, FACTION_DAMAGE_MODIFIERS, viralMultiplier } from './constants'
import { armorDamageMultiplier, effectiveArmor } from './target'
import type { Debuffs } from '../types'

export interface AbilityContext {
  strength: number // 1 = 100%
  duration: number
  range: number
  roar: number // bonus fraction from Roar casts
  shardVsStatus: { electricity: number; radiation: number; corrosive: number } // Archon Shard ability damage bonuses
  subsumed: boolean // cast through the Helminth (some abilities are weaker subsumed)
  uwb?: UniversalBonuses // weapon buffs that also reach "weapon damage abilities" (wiki Universal_Weapon_Bonuses)
  target: {
    faction: string
    armor: number // before debuffs
    debuffs: Debuffs
    health: number // max health/shields for the % of health abilities (Reave, Smite)
    shield: number
  }
}

// wiki Universal_Weapon_Bonuses: some abilities count as weapons for these. which ones an ability takes is on the hit (uwb)
//  - base: "Damage" bonuses (Arcane Arachne 150%, Vigorous Swap 165%, Vex Armor...), added up like Serration
//  - elemental: "Lavos's Valence Formation - 200%" (any element, "Also increases DoT damage by 200% for the selected element"),
//    "Grendel's Nourish - 75%" Viral, "Hydroid's Plunder - Up to 200%" Corrosive
//  - multiplier: "Mirage's Eclipse - 200%", Nidus's Parasitic Link, Vauban's passive... ("multiplicative to each other")
//  - crit: "base critical chance of 0% ... Absolute bonuses like Arcane Avenger instead add a flat amount", the 1.0x multiplier
//    goes up with flat additions ("Arcane Crepuscular, Tenacious Bond, or Grave Spirit")
export interface UniversalBonuses {
  base: number
  elemental: { damageType: string; value: number }[]
  multiplier: number // 1 = none
  flatCritChance: number
  critMultiplierBonus: number // added to the 1.0x
}
export const NO_UWB: UniversalBonuses = { base: 0, elemental: [], multiplier: 1, flatCritChance: 0, critMultiplierBonus: 0 }
export interface UwbTakes { base?: boolean; elemental?: boolean; multiplier?: boolean; crit?: boolean }

// one damage instance from the ability itself. raw has Ability Strength in already
export interface DamageEvent {
  t: number // seconds after cast
  label: string
  raw: number
  types: Record<string, number> // share of raw per damage type
  procs?: Record<string, number> // status procs this hit applies (fractions = expected value)
  procSeconds?: number // status duration of those procs (default 6 s)
  trueDamage?: boolean // True damage / % of health drains: no armor, no type modifiers, straight to health (Viral still counts)
  // % of what the target has left right now, on top of raw (Smite: "% of their current Health, Shields"; Reap on a Sown enemy:
  // "25% of their current health as True damage")
  percentCurrent?: { fraction: number; of: 'health' | 'healthAndShields' }
  skipShields?: boolean // defaults to trueDamage: True damage goes straight to health, a drain of both (Reave) doesn't
  armorStripBefore?: number // fraction of the target's remaining armor removed before this hit lands
  clearProcs?: string[] // statuses this hit removes (Thermal Sunder's combine cancels the old proc)
  vulnerability?: number // Damage Vulnerability this hit leaves on the target for everything after it (Demonium, Light's Judgment)
  uwb?: UwbTakes // which Universal Weapon Bonuses this hit takes (Jade Stars: elemental and crit, not base or multipliers)
}
export interface AbilityRun {
  events: DamageEvent[]
  notes?: string[] // what this run assumed, shown under the numbers
}

export interface InstanceLine { label: string; hits: number; first: number; total: number }
export interface AbilityResult {
  total: number // everything from one cast on one target, DoT tails included
  direct: number
  dot: number
  window10: number // damage dealt in the first 10 s (the board's DPS window)
  biggestHit: number
  lastHitTime: number
  // against the target's health/shields (when it has some): how much of it one cast takes, and when it dies
  pool: number // health + shields
  poolFraction: number // damage dealt / pool, capped at 1
  killTime: number | null // seconds after cast, null if it lives
  lines: InstanceLine[]
  dotLines: InstanceLine[]
  notes: string[]
}

export const ABILITY_WINDOW = 10

interface ActiveProc { type: string; start: number; end: number; perTick: number; ticksLeft: number[] }

const SHARD_STATUS: Record<string, 'electricity' | 'radiation' | 'corrosive'> = { electricity: 'electricity', radiation: 'radiation', corrosive: 'corrosive' }
const STATUS_SECONDS = 6
// Gas clouds cap at 10 (DOT_STATUSES note), the rest stack freely
const MAX_ACTIVE: Record<string, number> = { gas: 10 }

export function runAbility(run: AbilityRun, ctx: AbilityContext): AbilityResult {
  const events = [...run.events].sort((a, b) => a.t - b.t)
  const { target } = ctx
  const weakness = FACTION_DAMAGE_MODIFIERS[target.faction] ?? {}
  const uwb = ctx.uwb ?? NO_UWB
  let armorLeft = 1 // fraction of armor the ability's own strips left
  // the ability's own non-DoT procs, for Viral/Corrosive stacks and the shard bonuses: [type, from, until]
  const ownStatus: [string, number, number][] = []
  const procs: ActiveProc[] = []
  const lines = new Map<string, InstanceLine>()
  const dotLines = new Map<string, InstanceLine>()
  let direct = 0, dot = 0, window10 = 0, biggestHit = 0, lastHitTime = 0
  // the target's pools: shields soak first (True damage skips them), the kill is when health hits 0
  let shieldLeft = target.shield, healthLeft = target.health
  let dealt = 0
  let killTime: number | null = null
  const land = (amount: number, t: number, skipShields: boolean) => {
    if (!(target.health > 0)) return
    let rest = amount
    if (!skipShields) { const soaked = Math.min(shieldLeft, rest); shieldLeft -= soaked; rest -= soaked }
    const taken = Math.min(healthLeft, rest)
    healthLeft -= taken
    dealt += (amount - rest) + taken
    if (healthLeft <= 0 && killTime === null) killTime = t
  }
  // the ability's own vulnerability debuffs: [value, from]. the same debuff doesn't stack with itself, so I keep the biggest
  const ownVulnerability: [number, number][] = []

  const stacksAt = (type: string, t: number) => (target.debuffs.stacks[type] ?? 0) + ownStatus.filter(([kind, from, until]) => kind === type && from <= t && t < until).length
    + procs.filter((proc) => proc.type === type && proc.start <= t && t < proc.end).length
  const typeFactor = (damageType: string, t: number, bypassArmor: boolean) => {
    const corrosive = Math.min(10, stacksAt('corrosive', t))
    // Heat on the target strips armor the same way it does for weapons (the Debuffs panel's 50% with Heat up)
    const heatArmorStrip = Math.max(target.debuffs.heatArmorStrip, stacksAt('heat', t) > 0 ? 0.5 : 0)
    const armor = effectiveArmor(target.armor * armorLeft, { ...target.debuffs, heatArmorStrip, stacks: { ...target.debuffs.stacks, corrosive } })
    const armorMultiplier = bypassArmor || damageType === 'true' ? 1 : armorDamageMultiplier(armor)
    return (weakness[damageType] ?? 1) * armorMultiplier * viralMultiplier(Math.min(10, stacksAt('viral', t)))
  }
  // Roar, vulnerability and the shards: "+10% Ability Damage on enemies affected by Electricity status"
  const bonusAt = (t: number) => {
    let shard = 0
    for (const [status, key] of Object.entries(SHARD_STATUS)) if (ctx.shardVsStatus[key] && stacksAt(status, t) > 0) shard += ctx.shardVsStatus[key]
    // Roar: "bonus damage to all weapons and abilities", and "Multiple Roars do not stack" (the panel passes the strongest)
    const own = Math.max(0, ...ownVulnerability.filter(([, from]) => from < t).map(([value]) => value))
    return (1 + ctx.roar) * (1 + shard) * (1 + target.debuffs.damageVulnerability) * (1 + own)
  }
  const add = (map: Map<string, InstanceLine>, label: string, amount: number) => {
    const line = map.get(label) ?? { label, hits: 0, first: amount, total: 0 }
    line.hits++
    line.total += amount
    map.set(label, line)
  }

  // DoT ticks that are due before time t
  const tickUntil = (t: number) => {
    for (const proc of procs) {
      while (proc.ticksLeft.length && proc.ticksLeft[0] <= t) {
        const at = proc.ticksLeft.shift()!
        const info = DOT_STATUSES[proc.type]
        const amount = proc.perTick * typeFactor(proc.type, at, info.bypassesArmor) * bonusAt(at)
        dot += amount
        land(amount, at, proc.type === 'toxin') // Toxin ticks skip shields (DOT_STATUSES note)
        if (at < ABILITY_WINDOW) window10 += amount
        add(dotLines, `${proc.type[0].toUpperCase()}${proc.type.slice(1)} status`, amount)
      }
    }
  }

  for (const event of events) {
    tickUntil(event.t)
    if (event.armorStripBefore) armorLeft *= Math.max(0, 1 - event.armorStripBefore)
    if (event.clearProcs) for (const proc of procs) if (event.clearProcs.includes(proc.type)) proc.ticksLeft = []
    const bonus = bonusAt(event.t)
    const current = event.percentCurrent
      ? event.percentCurrent.fraction * (healthLeft + (event.percentCurrent.of === 'healthAndShields' ? shieldLeft : 0))
      : 0
    // Universal Weapon Bonuses on the hits that take them: base adds, multipliers multiply, crit averages in, and elemental
    // bonuses grow their own element (and its DoT) or add a new one on top of the base
    const takes = event.uwb ?? {}
    const crit = takes.crit ? 1 + uwb.flatCritChance * uwb.critMultiplierBonus : 1
    const raw = (event.raw * (takes.base ? 1 + uwb.base : 1) * (takes.multiplier ? uwb.multiplier : 1) + current) * crit
    const elementalOf = (type: string) => (takes.elemental ? uwb.elemental.filter((bonus) => bonus.damageType === type).reduce((sum, bonus) => sum + bonus.value, 0) : 0)
    const types: Record<string, number> = { ...event.types }
    for (const bonus of takes.elemental ? uwb.elemental : []) if (!(bonus.damageType in types)) types[bonus.damageType] = 0
    const shareOf = (type: string) => (event.types[type] ?? 0) * (1 + elementalOf(type)) + (event.types[type] === undefined ? elementalOf(type) : 0)
    const amount = event.trueDamage
      ? raw * bonus * viralMultiplier(Math.min(10, stacksAt('viral', event.t)))
      : Object.keys(types).reduce((sum, type) => sum + raw * shareOf(type) * typeFactor(type, event.t, false), 0) * bonus
    direct += amount
    land(amount, event.t, event.skipShields ?? Boolean(event.trueDamage))
    if (event.t < ABILITY_WINDOW) window10 += amount
    biggestHit = Math.max(biggestHit, amount)
    lastHitTime = Math.max(lastHitTime, event.t)
    add(lines, event.label, amount)
    if (event.vulnerability) ownVulnerability.push([event.vulnerability, event.t])

    // status procs: DoTs tick off the hit's raw damage (wiki: "Heat ... 50% of base damage per tick"), the rest just sit
    // on the target for Viral/Corrosive/shard bonuses
    const seconds = event.procSeconds ?? STATUS_SECONDS
    for (const [type, count] of Object.entries(event.procs ?? {})) {
      if (count <= 0) continue
      const info = DOT_STATUSES[type]
      if (!info) {
        // whole procs only, the expected share goes in as a share of one
        for (let n = 0; n < Math.ceil(count); n++) ownStatus.push([type, event.t, event.t + seconds])
        continue
      }
      // one proc's tick: its fraction of the hit's raw damage (Roar's in, the target's modifiers go on at tick time)
      const perTick = info.fraction * raw * (1 + elementalOf(type)) * (1 + ctx.roar)
      const whole = Math.floor(count), part = count - whole
      // Electricity ticks right away (0-5 s), the others 1 s after the hit, Blast once after its 1.5 s fuse
      const firstTick = type === 'electricity' ? 0 : type === 'blast' ? 1.5 : 1
      const ticks = type === 'blast' ? 1 : Math.max(1, Math.round(info.ticks * seconds / STATUS_SECONDS))
      for (let n = 0; n < whole + (part > 0 ? 1 : 0); n++) {
        const scale = n < whole ? 1 : part // an expected-value share of a proc (50% status chance) ticks for that share
        procs.push({ type, start: event.t, end: event.t + seconds, perTick: perTick * scale, ticksLeft: Array.from({ length: ticks }, (_, i) => event.t + firstTick + i) })
      }
      // Heat: a new proc refreshes every Heat stack on the target (DOT_STATUSES note), so older ones keep ticking
      if (type === 'heat') {
        for (const proc of procs) {
          if (proc.type !== 'heat' || !proc.ticksLeft.length) continue
          // the duration resets but the old stack keeps its tick rhythm (once a second from where it was), else a Heat proc
          // every 0.25 s would push every tick to the end of the cast
          const next = proc.ticksLeft[0]
          const ticks = Math.max(1, Math.floor(event.t + seconds - next) + 1)
          proc.ticksLeft = Array.from({ length: ticks }, (_, i) => next + i)
          proc.end = event.t + seconds
        }
      }
      const cap = MAX_ACTIVE[type]
      if (cap) {
        const live = procs.filter((proc) => proc.type === type && proc.ticksLeft.length)
        for (const old of live.slice(0, Math.max(0, live.length - cap))) old.ticksLeft = []
      }
    }
  }
  tickUntil(Infinity)
  // the target's worst moment in the window: what status the ability itself kept on it (level cap is about these)
  const peak = (type: string) => Math.max(0, ...events.filter((event) => event.t < ABILITY_WINDOW).map((event) => stacksAt(type, event.t + 0.001)))
  const statusNotes: string[] = []
  const viralPeak = Math.min(10, peak('viral')), corrosivePeak = Math.min(10, peak('corrosive')), heatPeak = peak('heat')
  if (viralPeak) statusNotes.push(`Viral x${viralPeak} (health damage x${viralMultiplier(viralPeak)})`)
  if (corrosivePeak || heatPeak) {
    const armorLeftNow = effectiveArmor(target.armor * armorLeft, { ...target.debuffs, heatArmorStrip: heatPeak ? Math.max(0.5, target.debuffs.heatArmorStrip) : target.debuffs.heatArmorStrip, stacks: { ...target.debuffs.stacks, corrosive: corrosivePeak } })
    if (target.armor > 0) statusNotes.push(`${corrosivePeak ? `Corrosive x${corrosivePeak}` : ''}${corrosivePeak && heatPeak ? ' + ' : ''}${heatPeak ? 'Heat' : ''}: armor ${Math.round(target.armor)} -> ${Math.round(armorLeftNow)} at its lowest`)
  }

  const sorted = (map: Map<string, InstanceLine>) => [...map.values()].sort((a, b) => b.total - a.total)
  const pool = target.health + target.shield
  return {
    total: direct + dot, direct, dot, window10, biggestHit, lastHitTime, pool, poolFraction: pool > 0 ? Math.min(1, dealt / pool) : 0, killTime,
    lines: sorted(lines), dotLines: sorted(dotLines), notes: [...(run.notes ?? []), ...statusNotes],
  }
}

// a neutral context for checks: 300% Strength, 100% Duration/Range, no faction/armor/status, 100,000 health
export const ABILITY_BOARD_STRENGTH = 3
export const ABILITY_BOARD_HEALTH = 100_000
export const neutralAbilityContext = (overrides: Partial<AbilityContext> = {}): AbilityContext => ({
  strength: ABILITY_BOARD_STRENGTH, duration: 1, range: 1, roar: 0, subsumed: false,
  shardVsStatus: { electricity: 0, radiation: 0, corrosive: 0 },
  target: {
    faction: 'None', armor: 0, health: ABILITY_BOARD_HEALTH, shield: 0,
    debuffs: { stacks: {}, heatArmorStrip: 0, corrosiveProjections: 0, otherArmorReduction: 0, damageVulnerability: 0, liftedOrKnockedDown: false, statusTypeSource: 'build' },
  },
  ...overrides,
})
