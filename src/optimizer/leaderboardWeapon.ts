// everything the leaderboard does for one weapon: every attack x every ranking. lives here (not in the build script)
// so it's part of the engine fingerprint in scripts/leaderboardFingerprint.ts, changing it reruns every weapon
import { evaluateSeed, optimizeAttack, type OptimizedBuild, type SeedBuild } from './optimize'
import { raisesFireRate } from '../calc/parseMod'
import { BOARDS, boardKey } from './objectives'
import { heavyComboFor } from '../data/heavyAttacks'
import type { LeaderboardStats, StoredEntry } from './leaderboardTypes'
import type { Weapon } from '../types'

const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits

// mods stay as [uniqueName, name, rank, stacks] here, the build script turns them into indexes into the shared table.
// fresh runs keep every stat, the file only keeps what the leaderboard rows show
export interface WeaponEntry extends Omit<StoredEntry, 'stats'> {
  stats: LeaderboardStats
}

export function toEntry(build: OptimizedBuild): WeaponEntry {
  const { result } = build
  const totalModded = result.damageTypes.reduce((total, row) => total + row.modded, 0)
  return {
    weaponId: build.weapon.uniqueName,
    weaponName: build.weapon.name,
    category: build.weapon.category,
    type: build.weapon.type,
    attack: build.attack.name,
    incarnonForm: /incarnon/i.test(build.attack.name),
    score: round(build.score, 2),
    stats: {
      critChance: round(result.critChance),
      critMultiplier: round(result.critMultiplier),
      statusChance: round(result.statusChance),
      multishot: round(result.multishot),
      fireRate: round(result.fireRate),
      magazineSize: result.magazineSize,
      reloadTime: result.reloadTime === null ? null : round(result.reloadTime, 2),
      uptime: round(result.uptime, 3),
      sustainedDps: round(result.sustainedDps, 1),
      burstDps: round(result.totalDps, 1),
      singleHit: round(result.hit.average * result.beamMerge, 1), // a beam's merged tick
      statusTypes: result.activeStatusTypes,
      damageTypes: result.damageTypes.slice(0, 3).map((row) => ({ type: row.damageType, share: round(row.modded / (totalModded || 1), 3) })),
    },
    mods: build.mods.map(({ mod, rank, conditionalStacks }) => [mod.uniqueName, mod.name, rank, conditionalStacks]),
    arcane: build.arcane ? [build.arcane.arcane.uniqueName, build.arcane.arcane.name, build.arcane.rank, build.arcane.conditionalStacks] : null,
    perks: build.perks.map(({ perk }) => ({ tier: perk.tier, name: perk.name })),
    passives: build.result.passives,
    bonusElement: build.bonusElement,
  }
}

// board key -> this weapon's entries on it
// seeds: builds found in the Compare tab (scripts/leaderboard-seeds.json). each one is scored the leaderboard's way and
// only replaces the search's build when it scores higher, so a seed can never make an entry worse
export function optimizeWeapon(weapon: Weapon, seeds: SeedBuild[] = []): Record<string, WeaponEntry[]> {
  const boards = Object.fromEntries(BOARDS.map((board) => [board.key, [] as WeaponEntry[]]))
  // event-only attacks (reload explosions, turret expiry) don't fire at the fire rate, so they're skipped
  const attacks = weapon.attacks.filter(
    (attack) => Object.values(attack.damage).some((amount) => amount > 0) && !/reload|expiry|turret/i.test(attack.name),
  )
  // every attack (component) gets its own listing: slam, heavy slam, heavy attack, alt-fire, Incarnon form...
  for (const attack of attacks) {
    const builds = new Map<string, OptimizedBuild>()
    for (const { key, objective, allowFireRateMods, heavyMode, heavyOnly } of BOARDS) {
      // heavies use up the combo, so spamming them at max combo isn't real DPS. they only compete for single hits
      if (attack.heavy && objective.usesFireRate) continue
      // the full-heavy board only holds multi-hit Heavy Attacks
      if (heavyOnly && !(attack.heavyMultiplier && heavyComboFor(weapon.name))) continue
      builds.set(key, optimizeAttack(weapon, attack, objective, allowFireRateMods, heavyMode))
    }
    // the search is a heuristic, so the no-fire-rate build can come out ahead. it's a legal build either way
    for (const { key, objective, allowFireRateMods } of BOARDS) {
      const without = builds.get(boardKey(objective.id, false))
      if (allowFireRateMods && objective.usesFireRate && without && without.score > (builds.get(key)?.score ?? 0)) builds.set(key, without)
    }
    for (const seed of seeds) {
      if (seed.weaponId !== weapon.uniqueName || seed.attack !== attack.name) continue
      const spec = BOARDS.find((candidate) => candidate.key === seed.board)
      if (!spec || !builds.has(spec.key)) continue
      const seeded = evaluateSeed(weapon, attack, spec.objective, spec.heavyMode ?? 'biggestHit', seed)
      // "no fire rate" boards stay that way
      if (!seeded || (!spec.allowFireRateMods && (seeded.mods.some(({ mod, rank }) => raisesFireRate(mod.levelStats, rank)) || (seeded.arcane && raisesFireRate(seeded.arcane.arcane.levelStats))))) continue
      if (seeded.score > builds.get(spec.key)!.score) builds.set(spec.key, seeded)
    }
    for (const [key, build] of builds) if (build.score > 0) boards[key].push(toEntry(build))
  }
  return boards
}
