// the Rivens page's god-roll finder: which riven stats raise this attack the most once the other 7 mods are rebuilt
// around it. a riven is never worth much on its own (a Heat riven is worth less next to Hellfire, Multishot less next
// to Galvanized Chamber), so every candidate goes through the full optimizer with the riven locked in.
//  1. screen: each stat alone on a 2-stat + curse riven, at the roll you picked
//  2. combine: every 2- and 3-stat riven from the best screened stats (at most 3 elements in that shortlist, at most one
//     spliced stat per riven, like the game)
//  3. curses: the best riven's build with each curse swapped in, to see which ones cost nothing
// pure data in and out so it runs in a Web Worker (src/optimizer/rivenWorker.ts)
import { weaponsById } from '../data'
import { calculate } from '../calc/damage'
import { resolveCoBehavior } from '../calc/conditionOverload'
import { RIVEN_DISPOSITION, RIVEN_MOD_ID, isSpliced, rivenMod, rivenPool, rivenRange, rivenTypeFor, statName, type RivenStat, type RivenType } from '../calc/riven'
import { optimizeAttack, type OptimizedBuild } from './optimize'
import { BOARDS } from './objectives'
import { toEntry, type WeaponEntry } from './leaderboardWeapon'
import { SCENARIO_BUFFS, SCENARIO_DEBUFFS, SCENARIO_TARGET } from './scenario'
import type { CompareScenario } from './compare'

export interface RivenSearchRequest {
  weaponId: string
  attackIndex: number
  board: string // leaderboard board key: 'sustained', 'window3', 'single'...
  scenario: CompareScenario | null // null = the leaderboard's neutral scenario
  roll: 'max' | 'average'
}

export interface RivenStatScore {
  tag: string
  name: string
  value: number // the roll it was tested at (display units)
  gain: number // vs no riven, 0.1 = +10%
  spliced: boolean
}

export interface RivenCandidate {
  stats: RivenStat[] // positives, then the curse
  score: number
  gain: number // vs no riven
  entry: WeaponEntry // the build around it (riven listed as RIVEN_MOD_ID)
}

export interface CurseScore { tag: string; name: string; value: number; change: number } // change in score, -0.02 = 2% worse

export interface RivenSearchResult {
  baseline: { score: number; entry: WeaponEntry }
  stats: RivenStatScore[] // screening, best first
  twoStat: RivenCandidate[]
  threeStat: RivenCandidate[]
  curses: CurseScore[] // for the best riven, least harmful first
  harmlessCurse: string
}

export type RivenProgress = { done: number; total: number; label: string }

// stats that never move a damage number in the calc (or need a scenario this search doesn't use)
const NO_DAMAGE = /AmmoMax|ProjectileSpeed|PunctureDepth|RecoilReduction|ZoomFov|MeleeRangeInc|ParryAngle|ComboDuration|SlideAttackCrit|MagazineReloadHolstered|AmmoEfficiency|ComboPointsOnHit|ComboInitialBonus|Finisher|SlamDamage/
const isFaction = (tag: string) => /FactionDamage/.test(tag)
const isElementTag = (tag: string) => /(Fire|Freeze|Electricity|Toxin|Gas|Corrosive|Viral|Radiation|Blast|Magnetic)DamageMod$/.test(tag)
const isWeakPoint = (tag: string) => /Weakpoint/.test(tag)
// a curse with nothing to hurt, used while the positives are searched (the "+ curse" layouts roll higher)
export const harmlessCurseFor = (type: RivenType) => (type === 'Melee' ? 'WeaponMeleeRangeIncMod' : 'WeaponZoomFovMod')

// a positive's god roll is the top of its range, a curse's is the mildest end (closest to 0)
const pick = (range: [number, number], roll: 'max' | 'average', negative: boolean) => {
  if (roll === 'average') return (range[0] + range[1]) / 2
  if (!negative) return range[1]
  return Math.abs(range[0]) < Math.abs(range[1]) ? range[0] : range[1]
}

// fills in the values for a set of tags, in the layout they make together
export function rollRiven(type: RivenType, positives: string[], curse: string | null, roll: 'max' | 'average'): RivenStat[] {
  const stats: RivenStat[] = [...positives.map((tag) => ({ tag, value: 0, negative: false })), ...(curse ? [{ tag: curse, value: 0, negative: true }] : [])]
  return stats.map((stat) => {
    const range = rivenRange(type, RIVEN_DISPOSITION, stats, stat)!
    return { ...stat, value: Number(pick(range, roll, stat.negative).toFixed(1)) }
  })
}

const combinations = <T>(items: T[], size: number): T[][] =>
  size === 0 ? [[]] : items.flatMap((item, index) => combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]))

export function searchRivens(request: RivenSearchRequest, onProgress: (progress: RivenProgress) => void = () => {}): RivenSearchResult {
  const weapon = weaponsById.get(request.weaponId)!
  const attack = weapon.attacks[request.attackIndex] ?? weapon.attacks[0]
  const type = rivenTypeFor(weapon)
  if (!type) throw new Error(`${weapon.name} can't take a riven`)
  const spec = BOARDS.find((candidate) => candidate.key === request.board)!
  const scenario = request.scenario ?? { target: SCENARIO_TARGET, armor: 0, debuffs: SCENARIO_DEBUFFS, buffs: SCENARIO_BUFFS }
  const curse = harmlessCurseFor(type)
  const name = (tag: string) => statName(rivenPool(type).find((def) => def.tag === tag)!)

  const optimizeWith = (stats: RivenStat[] | null): OptimizedBuild => {
    const riven = stats ? rivenMod(weapon, { stats, polarity: 'madurai', drain: 18 }) : null
    return optimizeAttack(weapon, attack, spec.objective, spec.allowFireRateMods, spec.heavyMode ?? 'biggestHit', {
      lockedMods: riven ? [{ mod: riven, rank: riven.fusionLimit, conditionalStacks: 0 }] : [],
      scenario: request.scenario,
    })
  }
  // a riven dropped into a build found for something else, no searching: the riven goes first (where the optimizer puts
  // locked mods) and, on a full riven-less build, takes the slot of whichever mod it hurts least to lose
  const scoreIn = (other: OptimizedBuild, stats: RivenStat[]): OptimizedBuild => {
    const riven = rivenMod(weapon, { stats, polarity: 'madurai', drain: 18 })!
    const rest = other.mods.filter((equipped) => equipped.mod.uniqueName !== RIVEN_MOD_ID)
    const options = rest.length >= 8 ? rest.map((_, drop) => rest.filter((__, index) => index !== drop)) : [rest]
    let best: OptimizedBuild | null = null
    for (const others of options) {
      const mods = [{ mod: riven, rank: riven.fusionLimit, conditionalStacks: 0 }, ...others]
      const result = calculate({
        weapon, attack, mods, arcane: other.arcane, coBehavior: resolveCoBehavior(weapon, attack), incarnonPerks: other.perks,
        passives: other.passives, bonusElement: other.bonusElement, heavyMode: spec.heavyMode ?? 'biggestHit',
        target: scenario.target, armor: scenario.armor, debuffs: scenario.debuffs, buffs: scenario.buffs,
      })
      const score = spec.objective.score(result)
      if (!best || score > best.score) best = { ...other, mods, result, score }
    }
    return best!
  }
  // the optimizer is a beam search, and a riven with two elements can walk it into a weak corner (Phenmor with Gas +
  // Heat + Multishot came out below no riven at all). so every candidate also tries the builds already found for its
  // smaller pieces with this riven dropped in, and keeps the best. a 3-stat riven can't come out below its 2-stat parts
  const found = new Map<string, OptimizedBuild>()
  const keyOf = (tags: string[]) => [...tags].sort().join('+')
  const bestFor = (tags: string[], rolled: RivenStat[]): OptimizedBuild => {
    let best = optimizeWith(rolled)
    const subsets = tags.length === 1 ? [[] as string[]] : combinations(tags, tags.length - 1)
    for (const subset of subsets) {
      const other = found.get(keyOf(subset))
      if (!other) continue
      const tried = scoreIn(other, rolled)
      if (tried.score > best.score) best = tried
    }
    found.set(keyOf(tags), best)
    return best
  }

  const pool = rivenPool(type).filter((def) => !NO_DAMAGE.test(def.tag))
    .filter((def) => !isFaction(def.tag) || (scenario.target.faction !== 'None' && def.text.includes(scenario.target.faction)))
    .filter((def) => !isWeakPoint(def.tag) || scenario.target.headshot)
    .filter((def) => !(weapon.category === 'Melee' && /FireIterations/.test(def.tag)))
  // a rough total for the progress bar: baseline + screening + ~80 combos, fixed once the shortlist is known
  let total = pool.length + 1 + 80 + 1
  let done = 0
  const step = (label: string) => onProgress({ done: ++done, total, label })

  const baseline = optimizeWith(null)
  found.set('', baseline)
  step('No riven')

  const stats: RivenStatScore[] = pool.map((def) => {
    const rolled = rollRiven(type, [def.tag], curse, request.roll)
    const build = bestFor([def.tag], rolled)
    step(`Testing ${statName(def)}`)
    return { tag: def.tag, name: statName(def), value: rolled[0].value, gain: build.score / baseline.score - 1, spliced: isSpliced(type, def.tag) }
  }).sort((a, b) => b.gain - a.gain)

  // the shortlist to combine: elements stand in for each other (a second one mostly just combines with the first), so at
  // most the 3 best of them, then the best of everything else, 8 in all. combined two and three at a time, at most one
  // spliced stat per riven
  const helpful = stats.filter((stat) => stat.gain > 0.001)
  const elements = helpful.filter((stat) => isElementTag(stat.tag)).slice(0, 3)
  const others = helpful.filter((stat) => !isElementTag(stat.tag)).slice(0, 8 - elements.length)
  const shortlist = [...elements, ...others].sort((a, b) => b.gain - a.gain).slice(0, 8).map((stat) => stat.tag)
  const valid = (tags: string[]) => tags.filter((tag) => isSpliced(type, tag)).length <= 1
  const pairs = combinations(shortlist, 2).filter(valid)
  const triples = combinations(shortlist, 3).filter(valid)
  total = done + pairs.length + triples.length + 1
  const builds = new Map<RivenCandidate, OptimizedBuild>()
  const run = (tags: string[]): RivenCandidate => {
    const rolled = rollRiven(type, tags, curse, request.roll)
    const build = bestFor(tags, rolled)
    step(tags.map(name).join(' + '))
    const candidate = { stats: rolled, score: build.score, gain: build.score / baseline.score - 1, entry: toEntry(build) }
    builds.set(candidate, build)
    return candidate
  }
  const byScore = (a: RivenCandidate, b: RivenCandidate) => b.score - a.score
  const allPairs = pairs.map(run).sort(byScore)
  const allTriples = triples.map(run).sort(byScore)
  const twoStat = allPairs.slice(0, 6)
  const threeStat = allTriples.slice(0, 6)

  // curses on the best riven: same build and same positive rolls, only the curse changes. the curse's own layout
  // weight is the same for every curse, so this is purely "what does this stat do when it's negative"
  const best = [...allPairs, ...allTriples].sort(byScore)[0]
  const curses: CurseScore[] = []
  if (best) {
    const bestBuild = builds.get(best)!
    const positives = best.stats.filter((stat) => !stat.negative)
    const positiveTags = positives.map((stat) => stat.tag)
    const score = (rolled: RivenStat[]) => scoreIn({ ...bestBuild, mods: bestBuild.mods }, rolled).score
    const reference = score(best.stats)
    for (const def of rivenPool(type)) {
      if (isSpliced(type, def.tag) || positiveTags.includes(def.tag)) continue
      const curseRoll = rollRiven(type, positiveTags, def.tag, 'average').at(-1)!
      const rolled = [...positives, curseRoll]
      curses.push({ tag: def.tag, name: statName(def), value: curseRoll.value, change: score(rolled) / reference - 1 })
    }
    curses.sort((a, b) => b.change - a.change)
    step('Curses')
  }

  return { baseline: { score: baseline.score, entry: toEntry(baseline) }, stats, twoStat, threeStat, curses, harmlessCurse: name(curse) }
}
