// the Boss Damage leaderboard: one tough target that doesn't die and takes status capped. built by
// `npm run leaderboard -- --boss` into public/boss-leaderboard.json, separate from the main boards so neither one
// reruns the other.
//  - status capped at 4 stacks of each type (most bosses; Heat, Slash, Viral... stop growing early)
//  - no kills: every on-kill conditional is off (Deadhead, Merciless, Galvanized stacks, Bladed Rounds, kill passives)
//  - perks bosses ignore are off (Devouring Attrition), gauge-gated alt-fires are left out (they need kills or a meter)
//  - otherwise the neutral scenario: no faction, no armor, body shots, sustained DPS over the 10 s fight
import { calculate } from '../calc/damage'
import { resolveCoBehavior } from '../calc/conditionOverload'
import { optimizeAttack, type OptimizedBuild } from './optimize'
import { TTK_OBJECTIVE, type BoardSpec } from './objectives'
import { STEEL_PATH_LEVEL_BONUS, scaleArmor, scaleHealth, scaleShield } from '../calc/target'
import { toEntry, type WeaponEntry } from './leaderboardWeapon'
import { SCENARIO_BUFFS, SCENARIO_DEBUFFS, SCENARIO_TARGET } from './scenario'
import type { TargetSettings, Weapon } from '../types'

// the Boss board: time to kill a Steel Path hardmode boss, solo. one ranking per boss, each its own target:
//  - level-scaled health / shields / armor from the wiki's Module:Enemies/data, Steel Path on (+100 levels, x2.5 health/shields)
//  - status capped at 4 stacks of each type, no kills (on-kill conditionals off: Deadhead, Merciless, Galvanized stacks...)
//  - perks bosses ignore are off (Devouring Attrition), gauge-gated alt-fires left out (they need kills or a meter)
//  - scored on time to kill (damage.ts timeToReach): shields first, then health, reloads / Incarnon refills / DoTs included
//  - damage attenuation (simulate.ts attenuatedTimeToKill): Update 40 made it "proportional to Max Health" for "True Bosses /
//    HUD Health Bar enemies", but no boss's new numbers are published. the only post-rework ones on the wiki are Hemocyte's
//    ("Max Damage Per Hit = 0.05 x Maximum Health", "DPS Damage Attenuation that is based on 20% of the Hemocyte's maximum
//    health"), so both bosses get those: 5% of max health per trigger, 20% per second. a guess until someone measures them
// not modeled: invulnerable phases (Vor's shielded phases, the turrets), adds, movement
export const BOSS_ATTENUATION = { perTrigger: 0.05, perSecond: 0.2 }
export interface BossTarget { key: string; name: string; note: string; target: TargetSettings; armor: number }
const bossTarget = (stats: { faction: string; health: number; shield: number; armor: number; spawnLevel: number }, extra: Partial<TargetSettings>) => {
  const levelsAboveBase = stats.spawnLevel - 1 // base level 1 on both
  const settings: TargetSettings = {
    ...SCENARIO_TARGET, faction: stats.faction, layer: 'health', enemyId: null, baseLevel: 1, level: stats.spawnLevel - STEEL_PATH_LEVEL_BONUS,
    steelPath: true, statusMode: 'capped', attenuation: BOSS_ATTENUATION,
    pool: { health: scaleHealth(stats.health, levelsAboveBase, stats.faction, true), shield: scaleShield(stats.shield, levelsAboveBase, stats.faction, true) },
    ...extra,
  }
  return { target: settings, armor: scaleArmor(stats.armor, levelsAboveBase) }
}
export const BOSSES: BossTarget[] = [
  {
    // wiki Janus Captain Vor: "Health = 7500, Shield = 2750, Armor = 250", "SpawnLevel = 375", Steel Path Tolstoj, "Solo: 1x
    // health", "Janus Captain Vor is immune to armor reduction". Grineer
    key: 'boss-janus-vor', name: 'Janus Captain Vor',
    note: 'Steel Path hardmode Vor at level 375, solo: shields then health, armor 250 scaled (2,700 cap) and immune to armor reduction',
    ...bossTarget({ faction: 'Grineer', health: 7500, shield: 2750, armor: 250, spawnLevel: 375 }, { armorStripImmune: true }),
  },
  {
    // wiki The Fragmented One: "Health = 50000", "SpawnLevel = 225" (solo), The Murmur (Viral x0.5), "Viral damage resistance and
    // immunity to Viral status". no shields or armor. Update 40, The Fragmented: "Steel Path / Deep Archimedea base health
    // bonus: 150,000", so 200,000 base before level scaling
    key: 'boss-fragmented-one', name: 'The Fragmented One',
    note: 'Steel Path hardmode Fragmented at level 225, solo: health only (200,000 base with the Steel Path bonus), Viral resisted and no Viral status',
    ...bossTarget({ faction: 'The Murmur', health: 200000, shield: 0, armor: 0, spawnLevel: 225 }, { statusImmune: ['viral'] }),
  },
]
export const BOSS_BOARDS: BoardSpec[] = BOSSES.map((boss) => ({ key: boss.key, objective: TTK_OBJECTIVE, allowFireRateMods: true }))
const scenarioFor = (boss: BossTarget) => ({ target: boss.target, armor: boss.armor, debuffs: SCENARIO_DEBUFFS, buffs: SCENARIO_BUFFS })
export const BOSS_DESCRIPTION =
  'Boss boards: time to kill a Steel Path hardmode boss solo (Janus Captain Vor, The Fragmented One), level-scaled from the wiki, status capped at 4 stacks of each type, no kills (every on-kill conditional off), Devouring Attrition off (bosses ignore it), weapons that don\'t work on bosses left off (Shadow Clones, Shattered Lash), body shots, reloads / Incarnon refills / DoT ticks as they land, melee Normal Attacks as the best stance combo at max combo, rank 30 with enough Forma, no rivens. Damage attenuation is guessed at Hemocyte\'s published share (5% of max health per trigger, 20% per second). Invulnerable phases and adds aren\'t modeled.'

// perks bosses ignore. wiki Laetum, Devouring Attrition: "Multiplicative to base damage sources such as Hornet Strike.
// Bosses ignore this perk." Phenmor has the same perk, so it's out there too. Felarx's Devastating Attrition has no
// such note on its page, so it stays
const BOSS_IGNORED_PERKS = ['Devouring Attrition']

// weapons that don't work on bosses, left off the board entirely. Shadow Clones (Blade Storm) can't hit boss targets,
// Shattered Lash is buggy against them. add more here as they turn up
const BOSS_EXCLUDED_WEAPONS = /^(Shadow Clones|Shattered Lash)( Prime)?$/

// same attacks the main boards rank, minus heavies (they eat the combo, so they're never DPS)
const rankedAttacks = (weapon: Weapon) => weapon.attacks.filter(
  (attack) => Object.values(attack.damage).some((amount) => amount > 0) && !/reload|expiry|turret/i.test(attack.name) && !attack.headshotOnly && !attack.heavy
    // gauge-gated alt-fires (Trumna, Sepulcrum, Higasa: kills; Grimoire, Nunchasa: hits) are one volley now and then,
    // never sustained DPS, and the kill ones can't fire at all on a boss that doesn't die
    && !attack.altGate,
)

export function optimizeWeaponBoss(weapon: Weapon): Record<string, WeaponEntry[]> {
  const boards: Record<string, WeaponEntry[]> = Object.fromEntries(BOSSES.map((boss) => [boss.key, []]))
  if (BOSS_EXCLUDED_WEAPONS.test(weapon.name)) return boards
  for (const boss of BOSSES) {
    const scenario = scenarioFor(boss)
    const found = new Map<string, OptimizedBuild>()
    for (const attack of rankedAttacks(weapon)) {
      let best = optimizeAttack(weapon, attack, TTK_OBJECTIVE, true, 'biggestHit', { scenario, noKills: true, excludedPerkNames: BOSS_IGNORED_PERKS })
      // a whole shot is at least as good as each part's build on it (the beam search can miss it)
      for (const part of attack.parts ?? []) {
        const other = found.get(part)
        if (!other) continue
        const result = calculate({
          weapon, attack, mods: other.mods, arcane: other.arcane, coBehavior: resolveCoBehavior(weapon, attack), incarnonPerks: other.perks,
          passives: other.passives, bonusElement: other.bonusElement, heavyMode: 'biggestHit', ...scenario,
        })
        const score = TTK_OBJECTIVE.score(result)
        if (score > best.score) best = { ...other, attack, result, score }
      }
      // the search ran on the quick attenuation estimate, the board shows the full timeline for the build it picked
      const exact = calculate({
        weapon, attack, mods: best.mods, arcane: best.arcane, coBehavior: resolveCoBehavior(weapon, attack), incarnonPerks: best.perks,
        passives: best.passives, bonusElement: best.bonusElement, heavyMode: 'biggestHit', ...scenario, target: { ...scenario.target, exactTimeToKill: true },
      })
      best = { ...best, result: exact, score: TTK_OBJECTIVE.score(exact) }
      found.set(attack.name, best)
      if (best.score > 0) boards[boss.key].push(toEntry(best))
    }
  }
  return boards
}
