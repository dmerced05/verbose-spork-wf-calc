// the Compare tab: optimize one weapon attack several times, each under a different set of rules (a "path"), for a
// few goals. pure data in and out so it can run in a Web Worker (src/optimizer/compareWorker.ts) and in tests
import { arcanesById, modsById, weaponsById } from '../data'
import { rivenMod, type RivenConfig, RIVEN_MOD_ID } from '../calc/riven'
import { equipArcane, equipMod, optimizeAttack, critViolation, type OptimizeConstraints, type OptimizedBuild } from './optimize'
import { BOARDS, boardKey } from './objectives'
import { toEntry, type WeaponEntry } from './leaderboardWeapon'
import type { Buffs, Debuffs, EquippedMod, TargetSettings } from '../types'

export interface ComparePath {
  name: string
  lockedModIds: string[]
  excludedModNames: string[]
  riven: RivenConfig | null // always locked in when set
  lockedArcaneId: string | 'none' | null // null = search picks
  excludedArcaneIds: string[]
  lockedPerks: Record<string, string | null> // tier -> perk, null = no perk in that tier
  excludedPerkNames: string[]
  maxCritChance: number | null // fractions, 0.5 = 50%
  minCritChance: number | null
}

export interface CompareScenario {
  target: TargetSettings
  armor: number
  debuffs: Debuffs
  buffs: Buffs
}

export interface CompareRequest {
  weaponId: string
  attackIndex: number
  boards: string[] // leaderboard board keys: 'sustained', 'single', 'window10-nofr'...
  paths: ComparePath[]
  scenario: CompareScenario | null // null = the leaderboard's neutral scenario
  thorough: boolean // wider beam: slower, finds a bit more under tight rules
}

export interface CompareResult {
  pathIndex: number
  board: string
  entry: WeaponEntry // same shape as a leaderboard entry, mods by uniqueName
  critMiss: number // how far outside the crit limits it ended up, 0 = inside
  usedFireRateMods: boolean
}

export const emptyPath = (name: string): ComparePath => ({
  name, lockedModIds: [], excludedModNames: [], riven: null, lockedArcaneId: null, excludedArcaneIds: [], lockedPerks: {},
  excludedPerkNames: [], maxCritChance: null, minCritChance: null,
})

function constraintsFor(request: CompareRequest, path: ComparePath): OptimizeConstraints {
  const weapon = weaponsById.get(request.weaponId)!
  const isMelee = weapon.category === 'Melee'
  const lockedMods: EquippedMod[] = path.lockedModIds.flatMap((id) => {
    const mod = modsById.get(id)
    return mod ? [equipMod(mod, isMelee)] : []
  })
  const riven = path.riven ? rivenMod(weapon, path.riven) : null
  if (riven) lockedMods.push({ mod: riven, rank: riven.fusionLimit, conditionalStacks: 0 })
  const arcane = path.lockedArcaneId && path.lockedArcaneId !== 'none' ? arcanesById.get(path.lockedArcaneId) : undefined
  return {
    lockedMods,
    excludedModNames: path.excludedModNames,
    lockedArcane: path.lockedArcaneId === 'none' ? 'none' : arcane ? equipArcane(arcane, isMelee) : null,
    excludedArcaneIds: path.excludedArcaneIds,
    lockedPerks: path.lockedPerks,
    excludedPerkNames: path.excludedPerkNames,
    maxCritChance: path.maxCritChance,
    minCritChance: path.minCritChance,
    scenario: request.scenario,
    beamWidth: request.thorough ? 16 : 8,
  }
}

// one path on one board, the leaderboard's way: fire-rate boards also try the no-fire-rate build and keep the better
export function runPath(request: CompareRequest, pathIndex: number, board: string): CompareResult {
  const weapon = weaponsById.get(request.weaponId)!
  const attack = weapon.attacks[request.attackIndex] ?? weapon.attacks[0]
  const spec = BOARDS.find((candidate) => candidate.key === board)!
  const constraints = constraintsFor(request, request.paths[pathIndex])
  const build = (allowFireRate: boolean): OptimizedBuild => optimizeAttack(weapon, attack, spec.objective, allowFireRate, spec.heavyMode ?? 'biggestHit', constraints)
  const score = (candidate: OptimizedBuild) => (critViolation(candidate.result.critChance, constraints) > 0 ? candidate.score * 1e-6 : candidate.score)
  let best = build(spec.allowFireRateMods)
  let usedFireRateMods = spec.allowFireRateMods
  if (spec.allowFireRateMods && spec.objective.usesFireRate) {
    const without = build(false)
    if (score(without) > score(best)) {
      best = without
      usedFireRateMods = false
    }
  }
  return { pathIndex, board, entry: toEntry(best), critMiss: critViolation(best.result.critChance, constraints), usedFireRateMods }
}

// the board keys this attack can be ranked on (heavies skip the fire-rate ones like the leaderboard does)
export const boardsFor = (attack: { heavy?: boolean }) =>
  BOARDS.filter((spec) => !spec.heavyOnly && !(attack.heavy && spec.objective.usesFireRate)).map((spec) => spec.key)

export const isRivenId = (id: string) => id === RIVEN_MOD_ID
export { boardKey }
