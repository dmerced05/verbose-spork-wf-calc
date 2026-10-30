// the build advisor: how much each stat is worth to *this* build right now, which real mod is the best (and cheapest)
// way to get it, which slots pull the least weight, and greedy build paths that show the order stats stop paying off.
// everything is measured by running the calc with one more (or one less) mod, so the weights move as the build does:
// Warframe damage is a product of buckets (base damage x multishot x crit x elements x fire rate...), and adding to a
// bucket that's already big moves the product less than adding to a small one. that's what "over-stacking" means here
import { calculate, type CalcInput, type CalcResult } from './damage'
import { parseUpgrade, type ModEffect } from './parseMod'
import { modsConflict } from './modConflicts'
import { BANE_TARGET } from './constants'
import type { EquippedMod, Mod } from '../types'

export type LeverId = string // 'damage', 'critChance', 'element:heat', 'physical:slash', 'faction', 'perStatus'...

export interface Lever {
  id: LeverId
  label: string
  line: string // the +10% test line fed to the calc
}

export interface LeverRow extends Lever {
  weight: number // score gain from +10% of this stat, 0.05 = +5%
  equippedCount: number // mods in the build that touch it
  bestMod: ModOption | null // the strongest real mod for it
  cheapestMod: ModOption | null // the most gain per capacity point, when it isn't the strongest
  combines: string[] // damage types it would create by combining with an element already there ("radiation")
}

export interface ModOption {
  mod: Mod
  gain: number // score gain from adding it (or swapping out the weakest slot when the build is full)
  drain: number // capacity at max rank
  swapsOut: string | null // the mod it replaces when the build is full
}

export interface SlotValue {
  mod: Mod
  contribution: number // how much the build loses without it, as a share of what's left (0.3 = the build is 30% bigger with it)
  levers: LeverId[]
}

export interface Advice {
  score: number
  levers: LeverRow[]
  slots: SlotValue[]
  swaps: { out: Mod; in: Mod; gain: number }[]
  flags: string[]
}

export interface PathStep {
  mod: Mod
  gain: number // this step's gain over the step before
  score: number
  levers: LeverId[]
}

export interface BuildPath {
  name: string
  note: string
  steps: PathStep[]
  score: number
}

const ELEMENTS = ['heat', 'cold', 'electricity', 'toxin']
const PHYSICALS = ['impact', 'puncture', 'slash']
const SLOTS = 8
const STEP = '+10%'

const cap = (word: string) => word[0].toUpperCase() + word.slice(1)
const drainOf = (mod: Mod) => mod.baseDrain + mod.fusionLimit

// which levers a mod line feeds. a dual-stat mod feeds two
function leversOfEffect(effect: ModEffect): LeverId[] {
  switch (effect.kind) {
    case 'damageType':
      return [PHYSICALS.includes(effect.damageType) ? `physical:${effect.damageType}` : `element:${effect.damageType}`]
    case 'faction':
      return ['faction']
    case 'stat':
      if (effect.value <= 0) return []
      if (effect.stat === 'damagePerStatusType') return ['perStatus']
      if (['damage', 'multishot', 'critChance', 'critDamage', 'statusChance', 'fireRate'].includes(effect.stat)) return [effect.stat]
      return []
    default:
      return []
  }
}
export function leversOf(mod: Mod): LeverId[] {
  const parsed = parseUpgrade(mod.levelStats, mod.fusionLimit)
  return [...new Set([...parsed.effects, ...parsed.conditionals.map((conditional) => conditional.effect)].flatMap(leversOfEffect))]
}

// the stats worth testing on this weapon: no multishot on melee, physical types only if the attack has them
export function leversFor(input: CalcInput): Lever[] {
  const melee = input.weapon.category === 'Melee'
  const levers: Lever[] = [
    { id: 'damage', label: 'Base damage (Serration-type)', line: `${STEP} Damage` },
    ...(melee ? [] : [{ id: 'multishot', label: 'Multishot', line: `${STEP} Multishot` }]),
    { id: 'critChance', label: 'Crit chance', line: `${STEP} Critical Chance` },
    { id: 'critDamage', label: 'Crit damage', line: `${STEP} Critical Damage` },
    { id: 'statusChance', label: 'Status chance', line: `${STEP} Status Chance` },
    { id: 'fireRate', label: melee ? 'Attack speed' : 'Fire rate', line: `${STEP} ${melee ? 'Attack Speed' : 'Fire Rate'}` },
    ...ELEMENTS.map((element) => ({ id: `element:${element}`, label: `${cap(element)} (elemental)`, line: `${STEP} ${cap(element)}` })),
    ...PHYSICALS.filter((type) => (input.attack.damage[type] ?? 0) > 0)
      .map((type) => ({ id: `physical:${type}`, label: `${cap(type)} (IPS)`, line: `${STEP} ${cap(type)}` })),
    { id: 'perStatus', label: 'Per status type (CO / Galvanized)', line: `${STEP} Damage per Status Type affecting target` },
  ]
  // a Bane only does something against its faction
  const bane = BANE_TARGET[input.target.faction]
  if (bane) levers.push({ id: 'faction', label: `Faction (Bane of ${bane})`, line: `x1.1 Damage to ${bane}` })
  return levers
}

const fakeMod = (weaponType: string, name: string, line: string): Mod => ({
  uniqueName: `advisor/${name}`, name, type: weaponType, compatName: null, polarity: null, rarity: null,
  baseDrain: 0, fusionLimit: 0, imageName: null, isExilus: false, levelStats: [[line]],
})
const modTypeOf = (input: CalcInput) =>
  input.weapon.category === 'Melee' ? 'Melee Mod' : input.weapon.category === 'Secondary' ? 'Secondary Mod' : 'Primary Mod'

export type Scorer = (result: CalcResult) => number

export function advise(input: CalcInput, score: Scorer, pool: EquippedMod[]): Advice {
  const run = (mods: EquippedMod[]) => score(calculate({ ...input, mods }))
  const base = run(input.mods)
  const ratio = (value: number) => (base > 0 ? value / base - 1 : 0)
  const equipped = input.mods
  const equippedNames = new Set(equipped.map((slot) => slot.mod.name))
  const full = equipped.length >= SLOTS

  // what each equipped mod is pulling: the build with it vs without it
  const slots: SlotValue[] = equipped.map((slot, index) => {
    const without = run(equipped.filter((_, other) => other !== index))
    return { mod: slot.mod, contribution: without > 0 ? base / without - 1 : 0, levers: leversOf(slot.mod) }
  })
  const weakestIndex = slots.length ? slots.reduce((weakest, slot, index) => (slot.contribution < slots[weakest].contribution ? index : weakest), 0) : -1

  // a real mod's value: added to a free slot, or swapped for the weakest one when the build is full
  const candidates = pool.filter((option) => !equippedNames.has(option.mod.name) && !equipped.some((slot) => modsConflict(slot.mod, option.mod)))
  const optionFor = (option: EquippedMod): ModOption => {
    if (!full) return { mod: option.mod, gain: ratio(run([...equipped, option])), drain: drainOf(option.mod), swapsOut: null }
    const swapped = equipped.map((slot, index) => (index === weakestIndex ? option : slot))
    return { mod: option.mod, gain: ratio(run(swapped)), drain: drainOf(option.mod), swapsOut: equipped[weakestIndex].mod.name }
  }
  const options = candidates.map((option) => ({ option: optionFor(option), levers: leversOf(option.mod) }))

  const baseTypes = new Set(calculate({ ...input, mods: equipped }).damageTypes.map((row) => row.damageType))
  const levers: LeverRow[] = leversFor(input).map((lever) => {
    const withLever = calculate({ ...input, mods: [...equipped, { mod: fakeMod(modTypeOf(input), lever.id, lever.line), rank: 0, conditionalStacks: 0 }] })
    const weight = ratio(score(withLever))
    const own = lever.id.startsWith('element:') ? lever.id.slice(8) : null
    const combines = own ? withLever.damageTypes.map((row) => row.damageType).filter((type) => type !== own && !baseTypes.has(type)) : []
    // a full build shows the best swap even when it's a loss, so you can see how far off it is
    const forLever = options.filter((entry) => entry.levers.includes(lever.id) && (full || entry.option.gain > 1e-6)).map((entry) => entry.option)
    const bestMod = forLever.reduce<ModOption | null>((best, option) => (!best || option.gain > best.gain ? option : best), null)
    const cheapest = forLever.filter((option) => option.gain > 0)
      .reduce<ModOption | null>((best, option) => (!best || option.gain / option.drain > best.gain / best.drain ? option : best), null)
    return {
      ...lever, weight, combines,
      equippedCount: equipped.filter((slot) => leversOf(slot.mod).includes(lever.id)).length,
      bestMod,
      cheapestMod: cheapest && cheapest !== bestMod ? cheapest : null,
    }
  }).sort((a, b) => b.weight - a.weight)

  // swaps that beat the weakest slot (only meaningful when the build is full)
  const swaps = full
    ? options.filter((entry) => entry.option.gain > 0.005).sort((a, b) => b.option.gain - a.option.gain).slice(0, 3)
      .map((entry) => ({ out: equipped[weakestIndex].mod, in: entry.option.mod, gain: entry.option.gain }))
    : []

  // over-stacking: a stat with 2+ mods where one of them, swapped for the best mod from another stat, makes the build
  // bigger. a low "+10% adds" alone doesn't mean a mod is wasted (it can still be the best thing for its slot), a swap
  // that wins does
  const flags: string[] = []
  const flagged = new Set<string>()
  for (const lever of levers) {
    if (lever.equippedCount < 2) continue
    const stacked = equipped
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => leversOf(slot.mod).includes(lever.id) && !flagged.has(slot.mod.name))
    // the one in that stat pulling least
    const weakest = stacked.reduce<{ slot: EquippedMod; index: number } | null>((low, entry) =>
      (!low || slots[entry.index].contribution < slots[low.index].contribution ? entry : low), null)
    if (!weakest) continue
    let best: { mod: Mod; gain: number } | null = null
    for (const entry of options) {
      if (entry.levers.includes(lever.id)) continue // another mod of the same stat isn't "something else"
      const option = pool.find((candidate) => candidate.mod === entry.option.mod)!
      const gain = ratio(run(equipped.map((slot, index) => (index === weakest.index ? option : slot))))
      if (!best || gain > best.gain) best = { mod: option.mod, gain }
    }
    if (best && best.gain > 0.01) {
      flagged.add(weakest.slot.mod.name)
      flags.push(`${lever.label} is over-stacked (${lever.equippedCount} mods): ${weakest.slot.mod.name} adds ${pctText(slots[weakest.index].contribution)} now, ` +
        `${best.mod.name} in its place makes the build ${pctText(best.gain)} bigger. That stat's bucket is already big, so each extra point of it moves the total less.`)
    }
  }
  const result = calculate({ ...input, mods: equipped })
  if (result.critChance > 0 && result.critChance < 0.25 && levers.find((lever) => lever.id === 'critDamage')?.equippedCount) {
    flags.push(`Crit damage is modded but crit chance is only ${pctText(result.critChance)}, so most hits never crit. Crit chance first, or drop crit damage.`)
  }
  if (equipped.length && full && slots[weakestIndex].contribution < 0.03 && !flagged.has(slots[weakestIndex].mod.name)) {
    flags.push(`${slots[weakestIndex].mod.name} adds only ${pctText(slots[weakestIndex].contribution)}: that slot can go to something else.`)
  }

  return { score: base, levers, slots, swaps, flags }
}

export const pctText = (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(value !== 0 && Math.abs(value) < 0.1 ? 1 : 0)}%`

// one slot at a time, always the mod that adds the most right now. not the true best build (the optimizer looks further
// ahead), but it shows the order stats pay off in and where each one runs out
export function greedyPath(input: CalcInput, score: Scorer, pool: EquippedMod[], name: string, note: string, allow: (mod: Mod) => boolean, keep: EquippedMod[] = []): BuildPath {
  const run = (mods: EquippedMod[]) => score(calculate({ ...input, mods }))
  const picked: EquippedMod[] = [...keep]
  const steps: PathStep[] = []
  let current = run(picked)
  while (picked.length < SLOTS) {
    let best: { option: EquippedMod; score: number } | null = null
    for (const option of pool) {
      if (!allow(option.mod) || picked.some((slot) => slot.mod.name === option.mod.name || modsConflict(slot.mod, option.mod))) continue
      const next = run([...picked, option])
      if (!best || next > best.score) best = { option, score: next }
    }
    if (!best || best.score <= current * (1 + 1e-6)) break
    picked.push(best.option)
    steps.push({ mod: best.option.mod, gain: current > 0 ? best.score / current - 1 : 0, score: best.score, levers: leversOf(best.option.mod) })
    current = best.score
  }
  return { name, note, steps, score: current }
}

// the usual forks: pure greedy, crit (no status chance mods), status (no crit mods). an immune target skips status
export function buildPaths(input: CalcInput, score: Scorer, pool: EquippedMod[], keep: EquippedMod[], statusImmune: boolean): BuildPath[] {
  const touches = (mod: Mod, ids: LeverId[]) => leversOf(mod).some((id) => ids.includes(id))
  return [
    greedyPath(input, score, pool, 'Best each slot', 'Always the mod that adds the most right now.', () => true, keep),
    greedyPath(input, score, pool, 'Crit', 'No status chance mods.', (mod) => !touches(mod, ['statusChance']), keep),
    ...(statusImmune ? [] : [greedyPath(input, score, pool, 'Status', 'No crit chance / crit damage mods.', (mod) => !touches(mod, ['critChance', 'critDamage']), keep)]),
  ]
}
