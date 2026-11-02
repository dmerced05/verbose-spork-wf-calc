// Incarnon evolutions change the weapon itself (the form's base damage, crit, status, fire rate...), so anywhere I talk
// about a weapon's "base stats" (Compare Weapons, the Rivens page) it's the evolved numbers, not the raw data. a weapon
// with an Incarnon form opens on that form, since that's how it's actually played
import { calculate } from './damage'
import { getIncarnonTiers, type SelectedPerk } from './incarnon'
import { attackMetrics, buildPool, damageSplit, groupMembers, isIncarnonAttack, metricsFromResult, type AttackMetrics, type Pool } from './weaponProfile'
import { SCENARIO_DEBUFFS, SCENARIO_TARGET } from '../optimizer/scenario'
import type { Leaderboard } from '../optimizer/leaderboardTypes'
import type { Attack, Weapon } from '../types'

export type Picks = Record<string, string> // evolution tier -> perk name

// the Incarnon form if there is one (Braton Prime, Boar...), else the first attack. melee Incarnons have no separate
// form (their evolutions apply to every swing), so they stay on the normal attack and get evolved there
export const defaultAttackIndex = (weapon: Weapon) => {
  if (!getIncarnonTiers(weapon.name)) return 0
  const index = weapon.attacks.findIndex(isIncarnonAttack)
  return index >= 0 ? index : 0
}

export function selectedPerks(weapon: Weapon, picks: Picks): SelectedPerk[] {
  return (getIncarnonTiers(weapon.name) ?? []).flatMap(({ tier, perks }) => {
    const perk = perks.find((option) => option.name === picks[tier])
    return perk ? [{ perk, stacks: 0 }] : []
  })
}

export interface Evolved {
  attack: Attack // same attack with the evolved numbers in it (damage per type, crit, status, fire rate)
  metrics: AttackMetrics
  shares: { type: string; share: number }[] // damage split, biggest first
  evolved: boolean // any evolution actually applied
}

// the attack with these evolutions on and no mods: what the arsenal shows with those perks picked. conditional parts of
// perks stay off, same as the leaderboard. no evolutions = straight from the data
export function evolve(weapon: Weapon, attack: Attack, picks: Picks): Evolved {
  const perks = selectedPerks(weapon, picks)
  if (!perks.length) return { attack, metrics: attackMetrics(weapon, attack), shares: damageSplit(attack).shares, evolved: false }
  const result = calculate({
    weapon, attack, mods: [], incarnonPerks: perks, target: SCENARIO_TARGET, armor: 0,
    debuffs: { ...SCENARIO_DEBUFFS, statusTypeSource: 'debuffs' }, buffs: { roar: 0, combo: 1 },
  })
  const damage = Object.fromEntries(result.damageTypes.filter((row) => row.modded > 0).map((row) => [row.damageType, row.modded]))
  const total = Object.values(damage).reduce((sum, amount) => sum + amount, 0)
  const shares = Object.entries(damage).map(([type, amount]) => ({ type, share: total > 0 ? amount / total : 0 })).sort((a, b) => b.share - a.share)
  return {
    attack: { ...attack, damage, critChance: result.critChance, critMultiplier: result.critMultiplier, statusChance: result.statusChance, fireRate: result.fireRate },
    metrics: metricsFromResult(weapon, attack, result),
    shares,
    evolved: true,
  }
}

// the leaderboard's evolutions for this attack on a board, the starting point when nobody's picked any
export function leaderboardPicks(leaderboard: Leaderboard | null, weapon: Weapon, attack: Attack, board = 'sustained'): Picks | null {
  const entry = (leaderboard?.boards[board] ?? leaderboard?.boards.sustained)?.find((candidate) => candidate.weaponId === weapon.uniqueName && candidate.attack === attack.name)
  return entry ? Object.fromEntries(entry.perks.map((perk) => [perk.tier, perk.name])) : null
}

// the Incarnon pool with every form evolved the leaderboard's way, so an evolved form isn't ranked against bare ones.
// one per ranking group (Incarnon rifles, Incarnon pistols...), cached per leaderboard
const pools = new WeakMap<Leaderboard, Map<string, Pool | undefined>>()
export function incarnonPool(leaderboard: Leaderboard | null, group: string): Pool | undefined {
  if (!leaderboard) return undefined
  let cache = pools.get(leaderboard)
  if (!cache) pools.set(leaderboard, (cache = new Map()))
  if (cache.has(group)) return cache.get(group)
  const list = groupMembers(group).flatMap((weapon) => {
    const attack = weapon.attacks.find(isIncarnonAttack)
    if (weapon.exalted || !attack) return []
    const { metrics } = evolve(weapon, attack, leaderboardPicks(leaderboard, weapon, attack) ?? {})
    return metrics.damage > 0 ? [metrics] : []
  })
  const pool = list.length > 1 ? buildPool(list) : undefined
  cache.set(group, pool)
  return pool
}
