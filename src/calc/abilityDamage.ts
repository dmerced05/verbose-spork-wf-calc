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
  target: {
    faction: string
    armor: number // before debuffs
    debuffs: Debuffs
    health: number // max health/shields for the % of health abilities (Reave, Smite)
    shield: number
  }
}

// one damage instance from the ability itself. raw has Ability Strength in already
export interface DamageEvent {
  t: number // seconds after cast
  label: string
  raw: number
  types: Record<string, number> // share of raw per damage type
  procs?: Record<string, number> // status procs this hit applies (fractions = expected value)
  procSeconds?: number // status duration of those procs (default 6 s)
  trueDamage?: boolean // % of health drains: no armor, no type modifiers
  armorStripBefore?: number // fraction of the target's remaining armor removed before this hit lands
  clearProcs?: string[] // statuses this hit removes (Thermal Sunder's combine cancels the old proc)
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
  let armorLeft = 1 // fraction of armor the ability's own strips left
  // the ability's own non-DoT procs, for Viral/Corrosive stacks and the shard bonuses: [type, from, until]
  const ownStatus: [string, number, number][] = []
  const procs: ActiveProc[] = []
  const lines = new Map<string, InstanceLine>()
  const dotLines = new Map<string, InstanceLine>()
  let direct = 0, dot = 0, window10 = 0, biggestHit = 0, lastHitTime = 0

  const stacksAt = (type: string, t: number) => (target.debuffs.stacks[type] ?? 0) + ownStatus.filter(([kind, from, until]) => kind === type && from <= t && t < until).length
    + procs.filter((proc) => proc.type === type && proc.start <= t && t < proc.end).length
  const typeFactor = (damageType: string, t: number, bypassArmor: boolean) => {
    const corrosive = Math.min(10, stacksAt('corrosive', t))
    const armor = effectiveArmor(target.armor * armorLeft, { ...target.debuffs, stacks: { ...target.debuffs.stacks, corrosive } })
    const armorMultiplier = bypassArmor || damageType === 'true' ? 1 : armorDamageMultiplier(armor)
    return (weakness[damageType] ?? 1) * armorMultiplier * viralMultiplier(Math.min(10, stacksAt('viral', t)))
  }
  // Roar, vulnerability and the shards: "+10% Ability Damage on enemies affected by Electricity status"
  const bonusAt = (t: number) => {
    let shard = 0
    for (const [status, key] of Object.entries(SHARD_STATUS)) if (ctx.shardVsStatus[key] && stacksAt(status, t) > 0) shard += ctx.shardVsStatus[key]
    return (1 + ctx.roar) * (1 + shard) * (1 + target.debuffs.damageVulnerability)
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
    const amount = event.trueDamage
      ? event.raw * bonus
      : Object.entries(event.types).reduce((sum, [type, share]) => sum + event.raw * share * typeFactor(type, event.t, false), 0) * bonus
    direct += amount
    if (event.t < ABILITY_WINDOW) window10 += amount
    biggestHit = Math.max(biggestHit, amount)
    lastHitTime = Math.max(lastHitTime, event.t)
    add(lines, event.label, amount)

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
      const perTick = info.fraction * event.raw * (1 + ctx.roar)
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
          const ticks = Math.max(1, Math.round(info.ticks * seconds / STATUS_SECONDS))
          proc.ticksLeft = Array.from({ length: ticks }, (_, i) => event.t + 1 + i)
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

  const sorted = (map: Map<string, InstanceLine>) => [...map.values()].sort((a, b) => b.total - a.total)
  return { total: direct + dot, direct, dot, window10, biggestHit, lastHitTime, lines: sorted(lines), dotLines: sorted(dotLines), notes: run.notes ?? [] }
}

// the Ability Damage board: one strength build for everyone (300% Strength, 100% Duration/Range, no Roar or shards) on
// the neutral target (no faction, no armor, no status, 100,000 health for the % of health abilities), each ability at its
// default settings (the card's inputs)
export const ABILITY_BOARD_STRENGTH = 3
export const ABILITY_BOARD_HEALTH = 100_000
export const ABILITY_BOARD_DESCRIPTION =
  'One target, every ability at 300% Ability Strength, 100% Duration and Range, no Roar or shards, on the neutral target (no faction, no armor, no status, 100,000 health for % of health abilities like Reave and Smite), each at its default settings. Total = one cast with its status DoTs; first 10 s = what lands in the first 10 seconds'

export const neutralAbilityContext = (overrides: Partial<AbilityContext> = {}): AbilityContext => ({
  strength: ABILITY_BOARD_STRENGTH, duration: 1, range: 1, roar: 0, subsumed: false,
  shardVsStatus: { electricity: 0, radiation: 0, corrosive: 0 },
  target: {
    faction: 'None', armor: 0, health: ABILITY_BOARD_HEALTH, shield: 0,
    debuffs: { stacks: {}, heatArmorStrip: 0, corrosiveProjections: 0, otherArmorReduction: 0, damageVulnerability: 0, liftedOrKnockedDown: false, statusTypeSource: 'build' },
  },
  ...overrides,
})
