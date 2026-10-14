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
import type { Arcane, Attack, EquippedArcane, EquippedMod, Mod, Weapon } from '../types'
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
const equipMod = (mod: Mod, isMelee: boolean): EquippedMod => ({
  mod, rank: mod.fusionLimit, conditionalStacks: defaultConditionalStacks(mod.levelStats, mod.fusionLimit, { isMelee, bodyShots: true }),
})
const equipArcane = (arcane: Arcane, isMelee: boolean): EquippedArcane => {
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

export function optimizeAttack(
  weapon: Weapon, attack: Attack, objective: Objective, allowFireRateMods = true, heavyMode: HeavyMode = 'biggestHit',
): OptimizedBuild {
  const pool = damageModPool(getCompatibleMods(weapon), objective.usesFireRate, { isHeavy: Boolean(attack.heavy), name: attack.name }, allowFireRateMods).map((mod) => equipMod(mod, weapon.category === 'Melee'))
  // "no fire rate mods" rankings skip fire rate arcanes too
  const arcaneOptions = getCompatibleArcanes(weapon)
    .filter((option) => allowFireRateMods || !raisesFireRate(option.levelStats))
    .map((option) => equipArcane(option, weapon.category === 'Melee'))
  const incarnonTiers = getIncarnonTiers(weapon.name) ?? []
  const coBehavior = resolveCoBehavior(weapon, attack)

  let arcane: EquippedArcane | null = null
  let perks: SelectedPerk[] = []
  // passives at the scenario's stacks, Kuva/Tenet/Coda element picked below (at the max 60%)
  const passives: SelectedPassive[] = passivesFor(weapon.name).map((passive) => ({
    passive, stacks: passive.condition ? passive.scenarioStacks ?? passive.maxStacks ?? 1 : 1,
  }))
  let bonusElement: BonusElement | null = null

  const run = (mods: EquippedMod[]) =>
    calculate({
      weapon, attack, mods, arcane, coBehavior, incarnonPerks: perks, passives, bonusElement, heavyMode,
      target: SCENARIO_TARGET, armor: 0, debuffs: SCENARIO_DEBUFFS, buffs: SCENARIO_BUFFS,
    })
  const evaluate = (mods: EquippedMod[]) => objective.score(run(mods))
  const fits = (mods: EquippedMod[], candidate: EquippedMod) => !mods.some((equipped) => conflicts(equipped.mod, candidate.mod))

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
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
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
    beam = [...next.values()].sort((a, b) => b.score - a.score).slice(0, BEAM_WIDTH)
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
    for (const { perks: options } of incarnonTiers) {
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

  return { weapon, attack, score: best.score, result: run(best.mods), mods: best.mods, arcane, perks, passives, bonusElement }
}
