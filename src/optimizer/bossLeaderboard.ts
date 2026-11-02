// the Boss Damage leaderboard: one tough target that doesn't die and takes status capped. built by
// `npm run leaderboard -- --boss` into public/boss-leaderboard.json, separate from the main boards so neither one
// reruns the other.
//  - status capped at 4 stacks of each type (most bosses; Heat, Slash, Viral... stop growing early)
//  - no kills: every on-kill conditional is off (Deadhead, Merciless, Galvanized stacks, Bladed Rounds, kill passives)
//  - perks bosses ignore are off (Devouring Attrition)
//  - otherwise the neutral scenario: no faction, no armor, body shots, sustained DPS over the 10 s fight
import { calculate } from '../calc/damage'
import { resolveCoBehavior } from '../calc/conditionOverload'
import { optimizeAttack, type OptimizedBuild } from './optimize'
import { objectiveById, type BoardSpec } from './objectives'
import { toEntry, type WeaponEntry } from './leaderboardWeapon'
import { SCENARIO_BUFFS, SCENARIO_DEBUFFS, SCENARIO_TARGET } from './scenario'
import type { Weapon } from '../types'

export const BOSS_BOARD = 'boss'
export const BOSS_BOARDS: BoardSpec[] = [{ key: BOSS_BOARD, objective: objectiveById('sustained'), allowFireRateMods: true }]
export const BOSS_SCENARIO = { target: { ...SCENARIO_TARGET, statusMode: 'capped' as const }, armor: 0, debuffs: SCENARIO_DEBUFFS, buffs: SCENARIO_BUFFS }
export const BOSS_DESCRIPTION =
  'Boss target: status capped at 4 stacks of each type, no kills (every on-kill conditional off: Deadhead, Merciless, Galvanized stacks, Bladed Rounds, kill-based passives), Devouring Attrition off (bosses ignore it), no faction, no armor, body shots, sustained DPS over a 10 s fight, melee at max combo, rank 30 with enough Forma, no rivens.'

// perks bosses ignore. wiki Laetum, Devouring Attrition: "Multiplicative to base damage sources such as Hornet Strike.
// Bosses ignore this perk." Phenmor has the same perk, so it's out there too. Felarx's Devastating Attrition has no
// such note on its page, so it stays
const BOSS_IGNORED_PERKS = ['Devouring Attrition']

// same attacks the main boards rank, minus heavies (they eat the combo, so they're never DPS)
const rankedAttacks = (weapon: Weapon) => weapon.attacks.filter(
  (attack) => Object.values(attack.damage).some((amount) => amount > 0) && !/reload|expiry|turret/i.test(attack.name) && !attack.headshotOnly && !attack.heavy,
)

export function optimizeWeaponBoss(weapon: Weapon): Record<string, WeaponEntry[]> {
  const { objective } = BOSS_BOARDS[0]
  const found = new Map<string, OptimizedBuild>()
  const entries: WeaponEntry[] = []
  for (const attack of rankedAttacks(weapon)) {
    let best = optimizeAttack(weapon, attack, objective, true, 'biggestHit', { scenario: BOSS_SCENARIO, noKills: true, excludedPerkNames: BOSS_IGNORED_PERKS })
    // a whole shot is at least as good as each part's build on it (the beam search can miss it)
    for (const part of attack.parts ?? []) {
      const other = found.get(part)
      if (!other) continue
      const result = calculate({
        weapon, attack, mods: other.mods, arcane: other.arcane, coBehavior: resolveCoBehavior(weapon, attack), incarnonPerks: other.perks,
        passives: other.passives, bonusElement: other.bonusElement, heavyMode: 'biggestHit', ...BOSS_SCENARIO,
      })
      const score = objective.score(result)
      if (score > best.score) best = { ...other, attack, result, score }
    }
    found.set(attack.name, best)
    if (best.score > 0) entries.push(toEntry(best))
  }
  return { [BOSS_BOARD]: entries }
}
