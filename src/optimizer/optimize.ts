// finds a strong build for one attack + objective in the fixed leaderboard scenario.
// beam search over a pruned mod pool, then single swaps, Incarnon perks, arcane, and elemental slot order.
// it's a heuristic, not a proof of the best build, but it's checked against hand-built meta builds.
import { resolveCoBehavior } from '../calc/conditionOverload'
import { calculate, type CalcResult, type SelectedPassive } from '../calc/damage'
import type { HeavyMode } from '../data/heavyAttacks'
import { BONUS_ELEMENT_RANGE, BONUS_ELEMENTS, hasBonusElement, passivesFor, type BonusElement } from '../data/passives'
import { getIncarnonTiers, type SelectedPerk } from '../calc/incarnon'
import { defaultConditionalStacks, parseUpgrade, raisesFireRate, utilityValue } from '../calc/parseMod'
import { getCompatibleArcanes, getCompatibleMods } from '../data'
import type { Arcane, Attack, Buffs, Debuffs, EquippedArcane, EquippedMod, Mod, TargetSettings, Weapon } from '../types'
import { conflicts, damageModPool } from './modPool'
import type { Objective } from './objectives'
import { SCENARIO_BUFFS, SCENARIO_DEBUFFS, SCENARIO_TARGET } from './scenario'

const SLOT_COUNT = 8
const BEAM_WIDTH = 8
const MAX_SWAP_PASSES = 4
const MAX_ELEMENT_ORDERS = 120 // 5 elemental mods = 120 orders, more than that I just keep the found order

export interface OptimizedBuild {
  weapon: Weapon
  attack: Attack
  score: number
  result: CalcResult
  mods: EquippedMod[] // slot order matters for element combining
  arcane: EquippedArcane | null
  perks: SelectedPerk[]
  passives: SelectedPassive[]
  bonusElement: BonusElement | null
}

// mods and arcanes go in at max rank with conditionals at the scenario's stacks (src/calc/parseMod.ts triggerUptime):
// max for most, off for headshot-hit triggers (body shots), half for melee kills on a gun and armor thresholds
export const equipMod = (mod: Mod, isMelee: boolean): EquippedMod => ({
  mod, rank: mod.fusionLimit, conditionalStacks: defaultConditionalStacks(mod.levelStats, mod.fusionLimit, { isMelee, bodyShots: true }),
})
export const equipArcane = (arcane: Arcane, isMelee: boolean): EquippedArcane => {
  const rank = arcane.levelStats.length - 1
  return { arcane, rank, conditionalStacks: defaultConditionalStacks(arcane.levelStats, rank, { isMelee, bodyShots: true }) }
}

const isElementalMod = (equipped: EquippedMod) =>
  parseUpgrade(equipped.mod.levelStats, equipped.rank).effects.some(
    (effect) => effect.kind === 'damageType' && !['impact', 'puncture', 'slash'].includes(effect.damageType),
  )

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield items
    return
  }
  for (let i = 0; i < items.length; i++) {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest]
  }
}

// the Compare tab's rules for one build path. the leaderboard never passes any, so its search is unchanged
export interface OptimizeConstraints {
  lockedMods?: EquippedMod[] // always equipped (a riven goes here too), they still count toward the 8 slots
  excludedModNames?: string[]
  lockedArcane?: EquippedArcane | 'none' | null // null = let the search pick
  excludedArcaneIds?: string[]
  lockedPerks?: Record<string, string | null> // tier -> perk name (null = nothing in that tier). unlisted tiers are searched
  excludedPerkNames?: string[]
  // crit chance limits on the final build. soft at first (the search needs a gradient to walk), flagged if missed
  maxCritChance?: number | null
  minCritChance?: number | null
  // the Calculator's target/debuffs/buffs instead of the leaderboard's neutral scenario
  scenario?: { target: TargetSettings; armor: number; debuffs: Debuffs; buffs: Buffs } | null
  beamWidth?: number
}

// how far a result is from the crit limits, 0 = inside them
export const critViolation = (critChance: number, constraints?: OptimizeConstraints) =>
  Math.max(0, critChance - (constraints?.maxCritChance ?? Infinity)) + Math.max(0, (constraints?.minCritChance ?? -Infinity) - critChance)

// a build found elsewhere (the Compare tab), to be scored the leaderboard's way: same scenario, same passives,
// conditionals at the scenario's stacks. lets the leaderboard pick up builds its own search walks past
export interface SeedBuild {
  weaponId: string
  attack: string
  board: string
  mods: string[] // uniqueNames, slot order
  arcane: string | null
  perks: { tier: string; name: string }[]
  bonusElement?: BonusElement | null
}

export function evaluateSeed(weapon: Weapon, attack: Attack, objective: Objective, heavyMode: HeavyMode, seed: SeedBuild): OptimizedBuild | null {
  const isMelee = weapon.category === 'Melee'
  const compatible = new Map(getCompatibleMods(weapon).map((mod) => [mod.uniqueName, mod]))
  const mods = seed.mods.map((id) => compatible.get(id))
  // anything that no longer fits (data changed, wrong weapon) just means the seed is skipped
  if (mods.some((mod) => !mod) || mods.length > SLOT_COUNT) return null
  const equipped = mods.map((mod) => equipMod(mod!, isMelee))
  if (equipped.some((a, index) => equipped.some((b, other) => other > index && conflicts(a.mod, b.mod)))) return null
  const arcaneData = seed.arcane ? getCompatibleArcanes(weapon).find((option) => option.uniqueName === seed.arcane) : null
  if (seed.arcane && !arcaneData) return null
  const tiers = getIncarnonTiers(weapon.name) ?? []
  const perks: SelectedPerk[] = []
  for (const { tier, name } of seed.perks) {
    const perk = tiers.find((candidate) => candidate.tier === tier)?.perks.find((option) => option.name === name)
    if (!perk) return null
    perks.push({ perk, stacks: 0 })
  }
  const arcane = arcaneData ? equipArcane(arcaneData, isMelee) : null
  const passives = passivesFor(weapon.name).map((passive) => ({ passive, stacks: passive.condition ? passive.scenarioStacks ?? passive.maxStacks ?? 1 : 1 }))
  const bonusElement = hasBonusElement(weapon.name) ? seed.bonusElement ?? null : null
  const result = calculate({
    weapon, attack, mods: equipped, arcane, coBehavior: resolveCoBehavior(weapon, attack), incarnonPerks: perks, passives, bonusElement, heavyMode,
    target: SCENARIO_TARGET, armor: 0, debuffs: SCENARIO_DEBUFFS, buffs: SCENARIO_BUFFS,
  })
  return { weapon, attack, score: objective.score(result), result, mods: equipped, arcane, perks, passives, bonusElement }
}

export function optimizeAttack(
  weapon: Weapon, attack: Attack, objective: Objective, allowFireRateMods = true, heavyMode: HeavyMode = 'biggestHit',
  constraints?: OptimizeConstraints,
): OptimizedBuild {
  const isMelee = weapon.category === 'Melee'
  const locked = constraints?.lockedMods ?? []
  const lockedNames = new Set(locked.map((equipped) => equipped.mod.name))
  const excludedNames = new Set(constraints?.excludedModNames ?? [])
  const pool = damageModPool(getCompatibleMods(weapon), objective.usesFireRate, { isHeavy: Boolean(attack.heavy), name: attack.name }, allowFireRateMods)
    .filter((mod) => !constraints || (!excludedNames.has(mod.name) && !lockedNames.has(mod.name)))
    .map((mod) => equipMod(mod, isMelee))
  // "no fire rate mods" rankings skip fire rate arcanes too
  const excludedArcanes = new Set(constraints?.excludedArcaneIds ?? [])
  const arcaneOptions = getCompatibleArcanes(weapon)
    .filter((option) => allowFireRateMods || !raisesFireRate(option.levelStats))
    .filter((option) => !excludedArcanes.has(option.uniqueName))
    .map((option) => equipArcane(option, isMelee))
  const excludedPerks = new Set(constraints?.excludedPerkNames ?? [])
  const lockedPerks = constraints?.lockedPerks ?? {}
  const incarnonTiers = (getIncarnonTiers(weapon.name) ?? []).map((tier) => ({ ...tier, perks: tier.perks.filter((perk) => !excludedPerks.has(perk.name)) }))
  const coBehavior = resolveCoBehavior(weapon, attack)
  const scenario = constraints?.scenario ?? { target: SCENARIO_TARGET, armor: 0, debuffs: SCENARIO_DEBUFFS, buffs: SCENARIO_BUFFS }
  const beamWidth = constraints?.beamWidth ?? BEAM_WIDTH
  const slotCount = SLOT_COUNT - locked.length

  let arcane: EquippedArcane | null = constraints?.lockedArcane && constraints.lockedArcane !== 'none' ? constraints.lockedArcane : null
  // locked tiers are set once up front and never revisited
  let perks: SelectedPerk[] = incarnonTiers.flatMap(({ tier, perks: options }) => {
    const perk = lockedPerks[tier] ? options.find((option) => option.name === lockedPerks[tier]) : undefined
    return perk ? [{ perk, stacks: 0 }] : []
  })
  // passives at the scenario's stacks, Kuva/Tenet/Coda element picked below (at the max 60%)
  const passives: SelectedPassive[] = passivesFor(weapon.name).map((passive) => ({
    passive, stacks: passive.condition ? passive.scenarioStacks ?? passive.maxStacks ?? 1 : 1,
  }))
  let bonusElement: BonusElement | null = null

  const run = (mods: EquippedMod[]) =>
    calculate({
      weapon, attack, mods: locked.length ? [...locked, ...mods] : mods, arcane, coBehavior, incarnonPerks: perks, passives, bonusElement, heavyMode,
      target: scenario.target, armor: scenario.armor, debuffs: scenario.debuffs, buffs: scenario.buffs,
    })
  // outside the crit limits the score drops off steeply but smoothly, so the search can still tell which way is better
  const evaluate = (mods: EquippedMod[]) => {
    const result = run(mods)
    const score = objective.score(result)
    if (!constraints) return score
    const miss = critViolation(result.critChance, constraints)
    return miss > 0 ? score * Math.exp(-20 * miss) * 1e-3 : score
  }
  const fits = (mods: EquippedMod[], candidate: EquippedMod) =>
    !mods.some((equipped) => conflicts(equipped.mod, candidate.mod)) && !locked.some((equipped) => conflicts(equipped.mod, candidate.mod))

  // ---- 0. bonus element: try each one (the element changes which mods are good, so it's picked again later) ----
  const pickBonusElement = (mods: EquippedMod[]) => {
    if (!hasBonusElement(weapon.name)) return
    let bestElement: BonusElement | null = null
    let bestScore = -1
    for (const damageType of BONUS_ELEMENTS) {
      bonusElement = { damageType, value: BONUS_ELEMENT_RANGE.max }
      const score = evaluate(mods)
      if (score > bestScore) {
        bestScore = score
        bestElement = bonusElement
      }
    }
    bonusElement = bestElement
  }
  pickBonusElement([])

  // ---- 1. beam search: grow builds one mod at a time, keep the best few at each size ----
  let beam = [{ mods: [] as EquippedMod[], score: evaluate([]) }]
  for (let slot = 0; slot < slotCount; slot++) {
    const next = new Map<string, { mods: EquippedMod[]; score: number }>()
    for (const state of beam) {
      for (const candidate of pool) {
        if (!fits(state.mods, candidate)) continue
        const mods = [...state.mods, candidate]
        const key = mods.map((equipped) => equipped.mod.uniqueName).sort().join('|')
        const score = evaluate(mods)
        if ((next.get(key)?.score ?? -1) < score) next.set(key, { mods, score })
      }
    }
    if (!next.size) break // ran out of compatible mods
    beam = [...next.values()].sort((a, b) => b.score - a.score).slice(0, beamWidth)
  }
  let best = beam[0]

  // ---- 2. single swaps until nothing improves (catches pairs the beam missed) ----
  const swapPass = () => {
    for (let pass = 0; pass < MAX_SWAP_PASSES; pass++) {
      let improved = false
      for (let index = 0; index < best.mods.length; index++) {
        const others = best.mods.filter((_, other) => other !== index)
        for (const candidate of pool) {
          if (best.mods.some((equipped) => equipped.mod.uniqueName === candidate.mod.uniqueName) || !fits(others, candidate)) continue
          const mods = [...best.mods]
          mods[index] = candidate
          const score = evaluate(mods)
          if (score > best.score * (1 + 1e-9)) {
            best = { mods, score }
            improved = true
          }
        }
      }
      if (!improved) break
    }
  }

  // ---- 3. Incarnon perks: best option per evolution tier (conditional parts left off) ----
  const pickPerks = () => {
    for (const { tier, perks: options } of incarnonTiers) {
      if (tier in lockedPerks) continue
      // baseline is "no perk in this tier", otherwise re-checking the perk picked last pass only ties and gets dropped
      let bestPerk: SelectedPerk | null = null
      const withoutTier = perks.filter((selected) => !options.includes(selected.perk))
      perks = withoutTier
      let bestScore = evaluate(best.mods)
      for (const perk of options) {
        perks = [...withoutTier, { perk, stacks: 0 }]
        const score = evaluate(best.mods)
        if (score > bestScore * (1 + 1e-9)) {
          bestScore = score
          bestPerk = { perk, stacks: 0 }
        }
      }
      perks = bestPerk ? [...withoutTier, bestPerk] : withoutTier
      best = { ...best, score: evaluate(best.mods) }
    }
  }

  // ---- 4. arcane: try each compatible one ----
  const pickArcane = () => {
    if (constraints?.lockedArcane) {
      best = { ...best, score: evaluate(best.mods) }
      return
    }
    let bestArcane: EquippedArcane | null = null
    let bestScore = -1
    const utility = (option: EquippedArcane | null) => (option ? utilityValue(option.arcane.levelStats, option.rank, !objective.usesFireRate) : 0)
    for (const option of [null, ...arcaneOptions]) {
      arcane = option
      const score = evaluate(best.mods)
      // a tie (Merciless vs Deadhead on body shots) goes to the one with headshot / reload value on top
      const tied = bestScore > 0 && Math.abs(score - bestScore) <= bestScore * 1e-6
      if ((score > bestScore && !tied) || (tied && utility(option) > utility(bestArcane))) {
        bestScore = Math.max(score, bestScore)
        bestArcane = option
      }
    }
    arcane = bestArcane
    best = { ...best, score: bestScore }
  }

  // ---- 5. elemental slot order (elements combine in slot order) ----
  const orderElements = () => {
    const elementSlots = best.mods.map((equipped, index) => (isElementalMod(equipped) ? index : -1)).filter((index) => index >= 0)
    if (elementSlots.length < 2) return
    let checked = 0
    for (const order of permutations(elementSlots.map((index) => best.mods[index]))) {
      if (++checked > MAX_ELEMENT_ORDERS) break
      const mods = [...best.mods]
      elementSlots.forEach((slotIndex, orderIndex) => (mods[slotIndex] = order[orderIndex]))
      const score = evaluate(mods)
      if (score > best.score * (1 + 1e-9)) best = { mods, score }
    }
  }

  const repickBonusElement = () => {
    if (!hasBonusElement(weapon.name)) return
    pickBonusElement(best.mods)
    best = { ...best, score: evaluate(best.mods) }
  }

  repickBonusElement()
  pickPerks()
  pickArcane()
  swapPass()
  orderElements()
  repickBonusElement()
  swapPass()
  pickPerks()
  pickArcane()

  // the reported score is the real one, not the penalized search score
  const result = run(best.mods)
  return { weapon, attack, score: objective.score(result), result, mods: [...locked, ...best.mods], arcane, perks, passives, bonusElement }
}
