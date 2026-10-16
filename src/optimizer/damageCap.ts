// Damage Cap tab: how much has to stack up for one hit of a weapon to pass the damage limit. a ladder where each step
// adds a layer and is optimized for the biggest single instance:
//   1. mods, weapon arcane and Incarnon   2. + headshot
//   3. + solo priming: the statuses the build applies itself plus what a Diriga primes, kept on through steps 4-6
//   4. + your Warframe: its own abilities/augments, one Helminth subsume (in a slot it can actually go in), and a real
//      frame mod build (8 slots + aura + exilus, frameBuild.ts) instead of a typed-in Strength
//   5. + Archon Shards (best 5 Tauforged, the frame mods re-picked with them: Violet wants a Flow mod)
//   6. + Warframe arcanes (best pair, Molt Augmented's Strength counts)
//   7. + enemy debuffs maxed (every status for CO, Viral 10...)   8. + allies' abilities
// steps 1-6 are doable solo, 7-8 need a team (or a lot of setup)
// the Warframe steps search every Warframe (or use the Calculator's Warframe panel). setups are scored on the previous step's
// build with a reference Strength first, then the best few get their frame mods picked and the weapon mods re-optimized
import { arcanes, warframes, warframeBaseName, weaponsById } from '../data'
import { SHARD_SLOTS, shardBuffsById, rank30Energy, type ShardSlot } from '../data/archonShards'
import { describeLoadout, evaluateFrame, optimizeFrameMods, REGULAR_SLOTS, type FrameEval, type FrameLoadout, type FrameSpec } from './frameBuild'
import { calculate, type CalcResult } from '../calc/damage'
import { resolveCoBehavior } from '../calc/conditionOverload'
import type { Warframe } from '../types'
import { rivenMod, type RivenConfig } from '../calc/riven'
import { STATUS_EFFECTS, STATUS_TYPES, maxComboFor } from '../calc/constants'
import type { HeavyMode } from '../data/heavyAttacks'
import {
  SUBSUMABLE, WARFRAME_ABILITIES, abilitiesById, canSubsumeInto, helpsAllies, modeledVariants,
  type AbilityCast, type WarframeAbility, type WarframeState,
} from '../data/warframeAbilities'
import { optimizeAttack, type OptimizeConstraints, type OptimizedBuild } from './optimize'
import { exaltedRuleFor } from '../data/exalted'
import type { Objective } from './objectives'
import { toEntry, type WeaponEntry } from './leaderboardWeapon'
import type { CompareScenario } from './compare'
import type { Buffs, Debuffs, TargetSettings } from '../types'

export interface CapStep {
  id: 'mods' | 'head' | 'debuffs' | 'frame' | 'shards' | 'frameArcanes' | 'priming' | 'allies'
  label: string
  description: string
}

export const CAP_STEPS: CapStep[] = [
  { id: 'mods', label: 'Mods, arcane & Incarnon', description: 'Best 8 mods (conditionals at max), weapon arcane, Incarnon perks' },
  { id: 'head', label: '+ Headshot', description: 'Weak point multiplier, and headcrits where the faction has them' },
  { id: 'priming', label: '+ Solo priming', description: 'Only the statuses your build applies (at max stacks), plus a Diriga primer (Impact, Puncture, Slash, Electricity + 3 modded elements). Its damage isn\'t counted. Kept on through the Warframe steps after it' },
  { id: 'frame', label: '+ Your Warframe', description: 'Its own abilities and augments, one Helminth subsume in a slot it can replace, and the best frame mods (8 slots, aura, exilus)' },
  { id: 'shards', label: '+ Archon Shards', description: 'The best 5 Tauforged shards, with the frame mods re-picked for them (Violet crit damage doubles past 500 Energy, so a Flow mod / Azure shard can earn a slot)' },
  { id: 'frameArcanes', label: '+ Warframe arcanes', description: 'The best two Warframe arcanes (Arcane Avenger, Molt Augmented\'s Strength...)' },
  { id: 'debuffs', label: '+ Enemy debuffs (maxed)', description: 'Every status type on the target (CO / Galvanized), 10 Viral, 10 Corrosive + full Heat strip, 10 Cold, 5 Puncture, 10 Tau, lifted' },
  { id: 'allies', label: '+ Allies', description: 'Teammates\' abilities (external Nourish, Roar...), at their strength' },
]

export interface CapRequest {
  weaponId: string
  attackIndex: number
  heavyMode: HeavyMode
  scenario: CompareScenario // the calculator's target (faction, level, armor) and Warframe panel
  riven: RivenConfig | null // locked into every step
  thorough: boolean
  frameMode: 'search' | 'panel' // find the best Warframe setup, or use the Calculator's Warframe panel
  allyStrength: number
  allyCount: number
  meleeHeadshots: boolean // most melee can't reliably headshot, so off unless asked
}

// one Warframe setup carried through the last four steps
export interface CapPath {
  index: number
  label: string // "Excalibur: Furious Javelin, Wrathful Advance (Helminth)"
  situational: string[] // "Empowered Quiver: only while standing in a Dashwire..."
  finalPeak: number
}

// enough to rebuild a Warframe setup in the Calculator's Warframe panel ("Load in calculator")
export interface FrameLoad {
  frame: string // "Excalibur", or a variant when its Energy matters ("Excalibur Umbra")
  allyStrength: number
  casts: AbilityCast[] // own (self), the subsumed one (helminth), allies' (ally)
  subsume: { from: string; name: string; replaces: string } | null
  arcaneIds: string[]
  shards?: (ShardSlot | null)[]
  mods: { regular: string[]; aura: string[]; exilus: string | null } // the frame mod build, augments included
}

// what the Warframe steps settled on, for the table, plus the load data
export interface CapSetup {
  frame: string
  priming?: { companion: string; types: string[]; own: string[] } // solo priming step: who applies what
  casts: { name: string; by: AbilityCast['by']; replaces?: string }[]
  arcanes: string[]
  shards?: string[] // "3x Violet Melee Critical Damage", for the table
  mods?: string[] // the frame mods, "Umbral Intensify", "Steel Charge (aura)"...
  strength?: number // what they add up to
  energy?: number
  allies: { frame: string; abilities: string[] }[]
  load?: FrameLoad // not in panel mode: those steps already come from the Warframe panel
}

export interface CapStepResult {
  stepIndex: number
  pathIndex: number | null // the Warframe steps run once per Warframe path, the first two are shared
  headshot: boolean // what this step was scored with, so "Load in calculator" can set the same
  debuffed: boolean
  debuffs: Debuffs // the exact debuffs it was scored with
  peakHit: number
  peakDotTick: { damageType: string; value: number } | null
  entry: WeaponEntry
  setup: CapSetup | null
}

// the Damage Cap tab's own target: a Steel Path Heavy Gunner at the level cap. Steel Path adds 100 levels, so 9,899
// spawns as 9,999. base level 8, 500 base armor, which is way past the 2,700 armor clamp by then
export const CAP_TARGET: TargetSettings = {
  faction: 'Grineer', layer: 'health', enemyId: '/Lotus/Types/Enemies/Grineer/AIWeek/Avatars/HeavyFemaleGrineerAvatar',
  baseLevel: 8, level: 9899, steelPath: true, manualArmor: 0, headshot: false, headshotMultiplier: null, headcrit: null,
}

const PEAK_OBJECTIVE: Objective = {
  id: 'single',
  label: 'Biggest single hit',
  unit: 'per hit',
  description: 'Top crit tier (or a Devouring Attrition non-crit), every multiplier, one instance',
  usesFireRate: false,
  score: (result) => result.peakHit,
}

const cleanDebuffs = (debuffs: Debuffs): Debuffs => ({
  ...debuffs,
  stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, 0])),
  heatArmorStrip: 0, corrosiveProjections: 0, otherArmorReduction: 0, damageVulnerability: 0, liftedOrKnockedDown: false, statusTypeSource: 'build',
})
// every status at its max (DoTs without a cap get 10), so CO / Galvanized count all of them
export const maxedDebuffs = (): Debuffs => ({
  stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, STATUS_EFFECTS[statusType].maxStacks ?? 10])),
  heatArmorStrip: 0.5, corrosiveProjections: 0, otherArmorReduction: 0, damageVulnerability: 0, liftedOrKnockedDown: true,
  statusTypeSource: 'debuffs',
})

// ---- Warframe search ----
interface Group { slot: string | null; options: WarframeAbility[] } // one ability (slot) and its variants, or a passive

const frameNames = [...new Set(warframes.map((frame) => warframeBaseName(frame.name)))].sort()
const frameSlots = (frame: string) => warframes.find((candidate) => candidate.name === frame)?.abilities.map((ability) => ability.name) ?? []
const hasEffects = (ability: WarframeAbility) => ability.effects.length > 0

// the frame's own modeled abilities, grouped by the ability they come from (Thermal Transfer's heat/cold/blast are one slot)
function ownGroups(frame: string, forAllies: boolean): Group[] {
  const groups = new Map<string, Group>()
  for (const ability of WARFRAME_ABILITIES) {
    if (ability.warframe !== frame || !hasEffects(ability)) continue
    if (forAllies && !helpsAllies(ability)) continue
    const key = ability.ability ?? ability.id
    if (!groups.has(key)) groups.set(key, { slot: ability.ability ?? null, options: [] })
    groups.get(key)!.options.push(ability)
  }
  return [...groups.values()]
}

// every pick of one option (or none) per group, capped so a frame with lots of variants can't blow up
function* combos(groups: Group[], limit = 400): Generator<WarframeAbility[]> {
  let count = 0
  function* walk(index: number, picked: WarframeAbility[]): Generator<WarframeAbility[]> {
    if (count >= limit) return
    if (index === groups.length) {
      count++
      yield picked
      return
    }
    yield* walk(index + 1, picked)
    for (const option of groups[index].options) yield* walk(index + 1, [...picked, option])
  }
  yield* walk(0, [])
}

// Helminth options: every other frame's subsumable ability that's modeled and buffs weapons
const subsumeOptions = frameNames.flatMap((frame) => {
  const name = SUBSUMABLE[frame]
  return name ? modeledVariants(frame, name).filter((ability) => hasEffects(ability) && !ability.selfOnly).map((ability) => ({ frame, name, ability })) : []
})

interface Snapshot { build: OptimizedBuild; target: TargetSettings; armor: number; debuffs: Debuffs; buffs: Buffs }
// corrosiveProjections: Corrosive Projection auras on the frame, they strip the target's armor
const rescore = (snapshot: Snapshot, warframe: WarframeState | undefined, corrosiveProjections = 0): CalcResult =>
  calculate({
    weapon: snapshot.build.weapon, attack: snapshot.build.attack, mods: snapshot.build.mods, arcane: snapshot.build.arcane,
    coBehavior: resolveCoBehavior(snapshot.build.weapon, snapshot.build.attack), incarnonPerks: snapshot.build.perks,
    passives: snapshot.build.passives, bonusElement: snapshot.build.bonusElement, heavyMode: 'biggestHit',
    target: snapshot.target, armor: snapshot.armor, buffs: { ...snapshot.buffs, warframe },
    debuffs: corrosiveProjections ? { ...snapshot.debuffs, corrosiveProjections: snapshot.debuffs.corrosiveProjections + corrosiveProjections } : snapshot.debuffs,
  })

const scoreEval = (snapshot: Snapshot, evaluated: FrameEval) => rescore(snapshot, evaluated.state, evaluated.corrosiveProjections).peakHit

interface FrameCandidate { spec: FrameSpec; setup: CapSetup; score: number; situational: string[] }

const frameByName = (name: string): Warframe => warframes.find((frame) => frame.name === name)!
// the frame's variants (Excalibur, Excalibur Prime, Excalibur Umbra): same kit, different Energy
const variantsOf = (name: string) => warframes.filter((frame) => warframeBaseName(frame.name) === name)

// the screening pass scores every setup at a reference Strength: what the best Strength-only mod build reaches with the
// slots the augments leave free (no shards, no arcanes)
const referenceStrength = new Map<number, number>()
function strengthWithFreeSlots(frame: Warframe, freeSlots: number): number {
  const cached = referenceStrength.get(freeSlots)
  if (cached !== undefined) return cached
  const result = optimizeFrameMods({ frame, subsume: null, casts: [], allyStrength: 1, arcaneIds: [], shards: [] }, (evaluated) => evaluated.strength, 4, freeSlots)
  referenceStrength.set(freeSlots, result.evaluated.strength)
  return result.evaluated.strength
}

// "any Warframe" still has to be a real one to load into the panel: the first frame with nothing of its own modeled
// that isn't a damage-buff frame (those restrict where a subsume can go)
const anyFrame = () => frameNames.find((frame) => ownGroups(frame, false).length === 0 && SUBSUMABLE[frame] && frameSlots(frame).length === 4) ?? 'Loki'

function searchFrames(snapshot: Snapshot, allyStrength: number): FrameCandidate[] {
  const candidates: FrameCandidate[] = []
  // an exalted weapon only exists on its own Warframe (Exalted Blade -> Excalibur). otherwise every frame with something
  // modeled, and frames with nothing of their own are all the same here: "any Warframe" with a subsume
  const exaltedRule = exaltedRuleFor(snapshot.build.weapon)
  const exaltedFrame = exaltedRule?.warframe
  const framesToTry = exaltedFrame ? [exaltedFrame] : [...frameNames.filter((frame) => ownGroups(frame, false).length > 0), 'Any Warframe']
  for (const frame of framesToTry) {
    const loadFrame = frame === 'Any Warframe' ? anyFrame() : frame
    const frameObject = frameByName(loadFrame)
    const groups = frame === 'Any Warframe' ? [] : ownGroups(frame, false)
    // the ability that summons an exalted weapon (Exalted Blade, Landslide) can't be swapped out for a subsume
    const slots = frameSlots(loadFrame).filter((slot) => !exaltedRule || slot.toLowerCase() !== exaltedRule.ability.toLowerCase())
    // per frame: the best setup, and the best one without situational abilities (Empowered Quiver), as separate paths
    let best: FrameCandidate | null = null
    let bestPlain: FrameCandidate | null = null
    for (const own of combos(groups)) {
      const usedSlots = new Set(own.flatMap((ability) => (ability.ability ? [ability.ability] : [])))
      const ownCasts: AbilityCast[] = own.map((ability) => ({ id: ability.id, by: 'self', ...(ability.stacks ? { stacks: ability.stacks.default } : {}) }))
      for (const subsume of [null, ...subsumeOptions]) {
        if (subsume && subsume.frame === frame) continue
        // it has to replace one of this frame's abilities that isn't in use (Roar/Eclipse/Xata only in a damage-buff slot)
        const slot = subsume
          ? slots.find((candidate) => !usedSlots.has(candidate) && canSubsumeInto(loadFrame, candidate, subsume.name))
          : undefined
        if (subsume && !slot) continue
        const picked = [...own, ...(subsume ? [subsume.ability] : [])]
        const casts: AbilityCast[] = subsume ? [...ownCasts, { id: subsume.ability.id, by: 'helminth', ...(subsume.ability.stacks ? { stacks: subsume.ability.stacks.default } : {}) }] : ownCasts
        // screening: the Strength a real build would have with the slots the augments leave
        const augments = new Set(picked.flatMap((ability) => (ability.augment ? [ability.augment] : []))).size
        const strength = strengthWithFreeSlots(frameObject, REGULAR_SLOTS - augments)
        const score = rescore(snapshot, { frameName: frame === 'Any Warframe' ? loadFrame : frame, abilityStrength: strength, teammateStrength: allyStrength, armor: 0, casts, arcanes: [] }).peakHit
        const situational = picked.flatMap((ability) => (ability.situational ? [`${ability.name}: ${ability.situational}`] : []))
        const better = (current: FrameCandidate | null) => !current || score > current.score
        if (better(best) || (!situational.length && better(bestPlain))) {
          const candidate: FrameCandidate = {
            score, situational,
            spec: { frame: frameObject, subsume: subsume ? { warframe: subsume.frame, ability: subsume.name } : null, casts, allyStrength, arcaneIds: [], shards: [] },
            setup: {
              frame: frame === 'Any Warframe' ? `Any Warframe (e.g. ${loadFrame})` : frame,
              casts: [
                ...own.map((ability) => ({ name: ability.name, by: 'self' as const })),
                ...(subsume ? [{ name: subsume.ability.name, by: 'helminth' as const, replaces: slot }] : []),
              ],
              arcanes: [], allies: [],
              load: {
                frame: loadFrame, allyStrength, casts, subsume: subsume && slot ? { from: subsume.frame, name: subsume.name, replaces: slot } : null,
                arcaneIds: [], mods: { regular: [], aura: [], exilus: null },
              },
            },
          }
          if (better(best)) best = candidate
          if (!situational.length && better(bestPlain)) bestPlain = candidate
        }
      }
    }
    if (best) candidates.push(best)
    if (bestPlain && bestPlain !== best) candidates.push(bestPlain)
  }
  return candidates.sort((a, b) => b.score - a.score)
}

// the frame mods picked for a spec, written into the setup (table text + what "Load in calculator" equips)
function withLoadout(setup: CapSetup, spec: FrameSpec, loadout: FrameLoadout, evaluated: FrameEval): CapSetup {
  return {
    ...setup,
    mods: describeLoadout(loadout),
    strength: evaluated.strength,
    energy: evaluated.energy,
    load: {
      ...setup.load!,
      frame: spec.frame.name,
      arcaneIds: spec.arcaneIds,
      shards: spec.shards.length ? spec.shards : undefined,
      mods: { regular: loadout.regular.map((mod) => mod.name), aura: loadout.aura.map((mod) => mod.name), exilus: loadout.exilus?.name ?? null },
    },
  }
}

// ---- Archon Shards ----
// shards that can matter for one hit of this weapon class
const shardOptionsFor = (category: string) =>
  category === 'Melee' ? ['crimson-strength', 'crimson-melee-cd', 'violet-melee-cd', 'azure-energy']
    : category === 'Primary' ? ['crimson-strength', 'violet-primary-electricity', 'crimson-primary-sc']
      : category === 'Secondary' ? ['crimson-strength', 'crimson-secondary-cc', 'topaz-secondary-cc']
        : ['crimson-strength']

// every way to fill 5 slots from the options (order doesn't matter), all Tauforged
function* shardMultisets(options: string[], slots = SHARD_SLOTS, start = 0, picked: string[] = []): Generator<string[]> {
  if (picked.length === slots) {
    yield picked
    return
  }
  for (let index = start; index < options.length; index++) yield* shardMultisets(options, slots, index, [...picked, options[index]])
}

export const shardNames = (slots: ShardSlot[]) => {
  const counts = new Map<string, number>()
  for (const slot of slots) counts.set(slot.buffId, (counts.get(slot.buffId) ?? 0) + 1)
  return [...counts].map(([id, count]) => {
    const shard = shardBuffsById.get(id)!
    return `${count}x ${shard.color} ${shard.label.replace(/ \(.*\)$/, '')}`
  })
}

interface ShardPick { spec: FrameSpec; loadout: FrameLoadout; evaluated: FrameEval; score: number }

// every shard set, each with its own frame mods (a quick narrow search), then the best few searched properly.
// Violet sets go on the frame variant with the most Energy (Excalibur Umbra's 225 vs Excalibur's 150)
function searchShards(snapshot: Snapshot, spec: FrameSpec, keep: number): ShardPick[] {
  const roomiest = variantsOf(warframeBaseName(spec.frame.name)).reduce((best, frame) => (rank30Energy(frame) > rank30Energy(best) ? frame : best), spec.frame)
  const score = (evaluated: FrameEval) => scoreEval(snapshot, evaluated)
  const quick: ShardPick[] = []
  for (const ids of shardMultisets(shardOptionsFor(snapshot.build.weapon.category))) {
    const shards = ids.map((buffId) => ({ buffId, tauforged: true }))
    const frame = ids.includes('violet-melee-cd') ? roomiest : spec.frame
    const shardSpec: FrameSpec = { ...spec, frame, shards }
    const result = optimizeFrameMods(shardSpec, score, 2)
    quick.push({ spec: shardSpec, ...result })
  }
  quick.sort((a, b) => b.score - a.score)
  return quick.slice(0, keep)
    .map((pick) => ({ spec: pick.spec, ...optimizeFrameMods(pick.spec, score, 6) }))
    .sort((a, b) => b.score - a.score)
}

// ---- solo priming ----
// the companion primer: what it keeps on enemies for you. its damage isn't counted, only the statuses it leaves.
// Diriga primes all three physicals and Electricity (Arc Coil), and with Manifold Bond up to 3 more elemental statuses
// from its weapon's mods, 7 in all. Hounds and Nautilus prime as much or one less, so Diriga stands in for all of them
interface Companion { id: string; name: string; fixed: string[]; free: number; exclude?: string; note: string }
export const COMPANIONS: Companion[] = [
  {
    id: 'diriga', name: 'Diriga', fixed: ['impact', 'puncture', 'slash', 'electricity'], free: 3, exclude: 'electricity',
    note: 'Arc Coil Electricity + all three physicals, and with Manifold Bond 3 modded elements other than Electricity (7 statuses)',
  },
]
const ELEMENT_PARTS: Record<string, string[]> = {
  heat: ['heat'], cold: ['cold'], electricity: ['electricity'], toxin: ['toxin'],
  blast: ['cold', 'heat'], corrosive: ['electricity', 'toxin'], gas: ['heat', 'toxin'], magnetic: ['cold', 'electricity'],
  radiation: ['electricity', 'heat'], viral: ['cold', 'toxin'],
}
// every elemental status combo a modded companion weapon can carry: up to `count` types with no base element reused
// exclude: a base element the weapon's mods can't use (Diriga's Electricity comes from Arc Coil)
export function elementCombos(count: number, exclude?: string): string[][] {
  const types = Object.keys(ELEMENT_PARTS)
  const out: string[][] = []
  const walk = (start: number, picked: string[], used: Set<string>) => {
    if (picked.length) out.push(picked)
    if (picked.length === count) return
    for (let index = start; index < types.length; index++) {
      const parts = ELEMENT_PARTS[types[index]]
      if (parts.some((part) => used.has(part) || part === exclude)) continue
      walk(index + 1, [...picked, types[index]], new Set([...used, ...parts]))
    }
  }
  walk(0, [], new Set())
  return out
}

// statuses the build applies on its own: its damage types (when it has status chance) and anything it procs
export function ownStatusTypes(result: CalcResult): string[] {
  const types = new Set<string>()
  if (result.statusChance > 0) for (const row of result.damageTypes) types.add(row.damageType)
  for (const dot of result.dots) if (dot.procsPerSecond > 0) types.add(dot.damageType)
  return [...types].filter((type) => STATUS_TYPES.includes(type)).sort()
}

// those statuses at max stacks (a full Heat strip if Heat is up), counted as the target's statuses for CO / Galvanized
export const primedDebuffs = (types: string[]): Debuffs => ({
  stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, types.includes(statusType) ? STATUS_EFFECTS[statusType].maxStacks ?? 10 : 0])),
  heatArmorStrip: types.includes('heat') ? 0.5 : 0, corrosiveProjections: 0, otherArmorReduction: 0, damageVulnerability: 0, liftedOrKnockedDown: false,
  statusTypeSource: 'debuffs',
})

interface PrimingPick { companion: Companion | null; types: string[]; own: string[]; score: number }
// the best companion and weapon combo for this build, scored on the build as it is
function searchPriming(snapshot: Snapshot, warframe: WarframeState | undefined, corrosiveProjections: number): PrimingPick {
  const own = ownStatusTypes(rescore(snapshot, warframe, corrosiveProjections))
  const scoreTypes = (types: string[]) => rescore({ ...snapshot, debuffs: primedDebuffs(types) }, warframe, corrosiveProjections).peakHit
  let best: PrimingPick = { companion: null, types: own, own, score: scoreTypes(own) }
  for (const companion of COMPANIONS) {
    for (const combo of [[], ...elementCombos(companion.free, companion.exclude)]) {
      const types = [...new Set([...own, ...companion.fixed, ...combo])].sort()
      const score = scoreTypes(types)
      if (score > best.score * (1 + 1e-9)) best = { companion, types, own, score }
    }
  }
  return best
}

const FRAME_ARCANES = arcanes.filter((arcane) => arcane.type === 'Warframe Arcane')

// arcanes go through the frame build too, so Molt Augmented's Strength counts
function searchArcanes(snapshot: Snapshot, spec: FrameSpec, loadout: FrameLoadout): { ids: string[]; score: number }[] {
  const scoreWith = (ids: string[]) => scoreEval(snapshot, evaluateFrame({ ...spec, arcaneIds: ids }, loadout))
  const none = scoreWith([])
  // only the ones that do anything alone are worth pairing
  const useful = FRAME_ARCANES.map((arcane) => ({ id: arcane.uniqueName, score: scoreWith([arcane.uniqueName]) })).filter((option) => option.score > none * 1.0001)
  const results: { ids: string[]; score: number }[] = [{ ids: [], score: none }, ...useful.map((option) => ({ ids: [option.id], score: option.score }))]
  for (let i = 0; i < useful.length; i++) {
    for (let j = i + 1; j < useful.length; j++) results.push({ ids: [useful[i].id, useful[j].id], score: scoreWith([useful[i].id, useful[j].id]) })
  }
  return results.sort((a, b) => b.score - a.score)
}

// one teammate at a time: the frame whose own ally-reaching abilities add the most on top of what's already there
function searchAllies(snapshot: Snapshot, base: WarframeState, count: number, allowSituational: boolean, corrosiveProjections: number): { state: WarframeState; allies: CapSetup['allies']; situational: string[] } {
  let state = base
  const allies: CapSetup['allies'] = []
  const situational: string[] = []
  for (let round = 0; round < count; round++) {
    const current = rescore(snapshot, state, corrosiveProjections).peakHit
    let best: { state: WarframeState; frame: string; abilities: string[]; score: number; flags: string[] } | null = null
    for (const frame of frameNames) {
      // a path without situational abilities stays that way through its allies
      const groups = ownGroups(frame, true)
        .map((group) => ({ ...group, options: group.options.filter((ability) => allowSituational || !ability.situational) }))
        .filter((group) => group.options.length > 0)
      if (!groups.length) continue
      for (const own of combos(groups, 200)) {
        if (!own.length) continue
        const next: WarframeState = { ...state, casts: [...state.casts, ...own.map((ability) => ({ id: ability.id, by: 'ally' as const, ...(ability.stacks ? { stacks: ability.stacks.default } : {}) }))] }
        const score = rescore(snapshot, next, corrosiveProjections).peakHit
        if (!best || score > best.score) best = { state: next, frame, abilities: own.map((ability) => ability.name), score, flags: own.flatMap((ability) => (ability.situational ? [`${ability.name} (ally): ${ability.situational}`] : [])) }
      }
    }
    if (!best || best.score <= current * 1.0001) break
    state = best.state
    allies.push({ frame: best.frame, abilities: best.abilities })
    situational.push(...best.flags)
  }
  return { state, allies, situational }
}

// the Warframe panel's setup split into the three Warframe steps
function panelStates(panel: WarframeState | undefined) {
  if (!panel) return null
  const own = panel.casts.filter((cast) => cast.by !== 'ally')
  const describe = (casts: AbilityCast[]) => casts.map((cast) => ({ name: abilitiesById.get(cast.id)?.name ?? cast.id, by: cast.by }))
  const arcaneNames = (panel.arcanes ?? []).map((slot) => arcanes.find((arcane) => arcane.uniqueName === slot.arcaneId)?.name ?? slot.arcaneId)
  const noShards: WarframeState = { ...panel, abilityStrength: panel.abilityStrength - (panel.shardStrength ?? 0), shardStrength: 0, shards: undefined }
  const shardText = panel.shards && (panel.shardStrength || Object.values(panel.shards).some(Boolean)) ? ['from the panel'] : []
  return {
    frame: { state: { ...noShards, casts: own, arcanes: [] }, setup: { frame: panel.frameName, casts: describe(own), arcanes: [], allies: [] } },
    shards: { state: { ...panel, casts: own, arcanes: [] }, setup: { frame: panel.frameName, casts: describe(own), arcanes: [], shards: shardText, allies: [] } },
    frameArcanes: { state: { ...panel, casts: own }, setup: { frame: panel.frameName, casts: describe(own), arcanes: arcaneNames, shards: shardText, allies: [] } },
    allies: {
      state: panel,
      setup: {
        frame: panel.frameName, casts: describe(own), arcanes: arcaneNames, shards: shardText,
        allies: panel.casts.filter((cast) => cast.by === 'ally').map((cast) => ({ frame: abilitiesById.get(cast.id)?.warframe ?? '?', abilities: [abilitiesById.get(cast.id)?.name ?? cast.id] })),
      },
    },
  }
}

// the whole ladder, step by step (onStep fires as each one finishes so the table fills in)
// the whole ladder. onStep fires as each step finishes so the table fills in, onPaths once at the end with the
// Warframe paths and which one to show first
export function runCapLadder(request: CapRequest, onStep: (result: CapStepResult) => void, onPaths: (paths: CapPath[], defaultPath: number) => void = () => {}) {
  const weapon = weaponsById.get(request.weaponId)!
  const attack = weapon.attacks[request.attackIndex] ?? weapon.attacks[0]
  const isMelee = weapon.category === 'Melee'
  const { scenario } = request
  const riven = request.riven ? rivenMod(weapon, request.riven) : null
  const lockedMods = riven ? [{ mod: riven, rank: riven.fusionLimit, conditionalStacks: 0 }] : []
  // headshots: never on AoE, and off for melee unless asked (most melee can't land them reliably)
  const canHeadshot = !attack.isAoE && (!isMelee || request.meleeHeadshots)
  const target: TargetSettings = { ...scenario.target, headshot: false }
  const headTarget: TargetSettings = { ...scenario.target, headshot: canHeadshot }
  // melee at max combo: Blood Rush / Weeping Wounds / heavies are part of the weapon's investment
  const noFrameBuffs: Buffs = { roar: 0, combo: maxComboFor(weapon.name), gladiatorWarframePieces: 0 }
  const clean = cleanDebuffs(scenario.debuffs)
  const maxed = maxedDebuffs()

  const optimize = (stepTarget: TargetSettings, debuffs: Debuffs, buffs: Buffs) => {
    const constraints: OptimizeConstraints = {
      lockedMods, beamWidth: request.thorough ? 16 : 8,
      scenario: { target: stepTarget, armor: scenario.armor, debuffs, buffs },
    }
    return optimizeAttack(weapon, attack, PEAK_OBJECTIVE, true, request.heavyMode, constraints)
  }
  const snapshot = (build: OptimizedBuild, debuffs: Debuffs, warframe?: WarframeState): Snapshot =>
    ({ build, target: headTarget, armor: scenario.armor, debuffs, buffs: { ...noFrameBuffs, warframe } })
  const emit = (stepIndex: number, pathIndex: number | null, build: OptimizedBuild, setup: CapSetup | null, debuffs: Debuffs, headshot = canHeadshot) =>
    onStep({ stepIndex, pathIndex, peakHit: build.result.peakHit, peakDotTick: build.result.peakDotTick, entry: toEntry(build), setup, headshot, debuffed: debuffs !== clean, debuffs })
  // Warframe setups get the mods re-optimized for them, best one wins
  // cp: Corrosive Projection auras on the frame build, they go in with the step's debuffs
  const refine = <T extends { state?: WarframeState; setup: CapSetup | null; cp?: number }>(candidates: T[], debuffs: Debuffs) => {
    let best: (T & { build: OptimizedBuild }) | null = null
    for (const candidate of candidates) {
      const stepDebuffs = candidate.cp ? { ...debuffs, corrosiveProjections: debuffs.corrosiveProjections + candidate.cp } : debuffs
      const build = optimize(headTarget, stepDebuffs, { ...noFrameBuffs, warframe: candidate.state })
      if (!best || build.result.peakHit > best.build.result.peakHit) best = { ...candidate, build }
    }
    return best!
  }
  // solo priming: the build's own statuses + the best companion. what the build applies depends on its mods, so I pick
  // the companion, re-optimize the mods for those debuffs, then re-pick on the new build. every reported number uses
  // the statuses the reported build really applies
  const solo = <T extends { state?: WarframeState; setup: CapSetup | null; cp?: number; build: OptimizedBuild }>(base: T) => {
    const cp = base.cp ?? 0
    const consistent = (build: OptimizedBuild, state: WarframeState | undefined) => {
      const pick = searchPriming(snapshot(build, clean), state, cp)
      return { build: { ...build, result: rescore({ ...snapshot(build, clean), debuffs: primedDebuffs(pick.types) }, state, cp) }, pick }
    }
    let best = consistent(base.build, base.state)
    let pick = best.pick
    for (let pass = 0; pass < 2; pass++) {
      const next = refine([base], primedDebuffs(pick.types))
      const scored = consistent(next.build, next.state)
      if (scored.build.result.peakHit > best.build.result.peakHit) best = scored
      if (scored.pick.types.join() === pick.types.join()) break
      pick = scored.pick
    }
    const priming = { companion: best.pick.companion?.name ?? 'none needed', types: best.pick.types, own: best.pick.own }
    return { ...base, build: best.build, debuffs: primedDebuffs(best.pick.types), setup: base.setup ? { ...base.setup, priming } : base.setup, priming }
  }
  const soloBest = <T extends { state?: WarframeState; setup: CapSetup | null; cp?: number; build: OptimizedBuild }>(candidates: T[]) =>
    candidates.map(solo).reduce((best, next) => (next.build.result.peakHit > best.build.result.peakHit ? next : best))
  const describe = (setup: CapSetup) =>
    `${setup.frame}: ${setup.casts.map((cast) => (cast.by === 'helminth' ? `${cast.name} (Helminth)` : cast.name)).join(', ') || 'nothing'}`

  // 1-3: the weapon, headshot, then solo priming (shared by every path)
  const modsBuild = optimize(target, clean, noFrameBuffs)
  emit(0, null, modsBuild, null, clean, false)
  const headBuild = optimize(headTarget, clean, noFrameBuffs)
  emit(1, null, headBuild, null, clean)
  const primedHead = solo({ setup: null, build: headBuild })
  const primingOnly = (priming: CapSetup['priming']): CapSetup => ({ frame: '', casts: [], arcanes: [], allies: [], priming })
  emit(2, null, primedHead.build, primingOnly(primedHead.priming), primedHead.debuffs)

  if (request.frameMode === 'panel') {
    const panel = panelStates(scenario.buffs.warframe)
    if (!panel) {
      emit(3, 0, primedHead.build, null, primedHead.debuffs)
      emit(4, 0, primedHead.build, null, primedHead.debuffs)
      emit(5, 0, primedHead.build, null, primedHead.debuffs)
      const debuffBuild = optimize(headTarget, maxed, noFrameBuffs)
      emit(6, 0, debuffBuild, null, maxed)
      emit(7, 0, debuffBuild, null, maxed)
      onPaths([{ index: 0, label: 'No Warframe set in the panel', situational: [], finalPeak: debuffBuild.result.peakHit }], 0)
      return
    }
    const panelFrame = solo({ ...panel.frame, build: primedHead.build })
    emit(3, 0, panelFrame.build, panelFrame.setup, panelFrame.debuffs)
    const panelShards = solo({ ...panel.shards, build: panelFrame.build })
    emit(4, 0, panelShards.build, panelShards.setup, panelShards.debuffs)
    const panelArcanes = solo({ ...panel.frameArcanes, build: panelShards.build })
    emit(5, 0, panelArcanes.build, panelArcanes.setup, panelArcanes.debuffs)
    emit(6, 0, refine([panel.frameArcanes], maxed).build, panel.frameArcanes.setup, maxed)
    const withAllies = refine([{ state: panel.allies.state, setup: panel.allies.setup }], maxed)
    emit(7, 0, withAllies.build, panel.allies.setup, maxed)
    const flags = panel.frame.state.casts.flatMap((cast) => {
      const ability = abilitiesById.get(cast.id)
      return ability?.situational ? [`${ability.name}: ${ability.situational}`] : []
    })
    onPaths([{ index: 0, label: `Your Warframe panel (${panel.frame.setup.frame})`, situational: flags, finalPeak: withAllies.build.result.peakHit }], 0)
    return
  }

  // 4-8 per Warframe path, screened on the primed step-3 build
  const primedSnapshot = snapshot(primedHead.build, primedHead.debuffs)
  const frames = searchFrames(primedSnapshot, request.allyStrength)
  // the shortlist gets real frame mods, then the weapon mods re-optimized with priming re-picked
  const shortlist = frames.slice(0, request.thorough ? 8 : 5)
  const plainBest = frames.find((candidate) => !candidate.situational.length)
  if (plainBest && !shortlist.includes(plainBest)) shortlist.push(plainBest)
  const refined = shortlist.map((candidate) => {
    const picked = optimizeFrameMods(candidate.spec, (evaluated) => scoreEval(primedSnapshot, evaluated))
    return solo({
      candidate, spec: candidate.spec, loadout: picked.loadout, state: picked.evaluated.state, cp: picked.evaluated.corrosiveProjections,
      setup: withLoadout(candidate.setup, candidate.spec, picked.loadout, picked.evaluated), build: primedHead.build,
    })
  }).sort((a, b) => b.build.result.peakHit - a.build.result.peakHit)
  const chosen: typeof refined = []
  const seenFrames = new Set<string>()
  for (const option of refined) {
    if (chosen.length >= 3) break
    const key = `${option.setup.frame}|${option.candidate.situational.length > 0}`
    if (seenFrames.has(key)) continue
    seenFrames.add(key)
    chosen.push(option)
  }
  // the best plain one always makes the list
  const plainRefined = refined.find((option) => !option.candidate.situational.length)
  if (plainRefined && !chosen.includes(plainRefined)) chosen.push(plainRefined)

  const paths: CapPath[] = []
  chosen.forEach((option, pathIndex) => {
    emit(3, pathIndex, option.build, option.setup, option.debuffs)
    // shards, with the frame mods re-picked for each set (Violet crit damage wants 501+ Energy)
    const shardPicks = searchShards(snapshot(option.build, option.debuffs), option.spec, request.thorough ? 4 : 2)
    const withShardPick = soloBest(shardPicks.map((pick) => ({
      spec: pick.spec, loadout: pick.loadout, state: pick.evaluated.state, cp: pick.evaluated.corrosiveProjections, build: option.build,
      setup: { ...withLoadout(option.setup, pick.spec, pick.loadout, pick.evaluated), shards: shardNames(pick.spec.shards) },
    })))
    emit(4, pathIndex, withShardPick.build, withShardPick.setup, withShardPick.debuffs)
    // arcanes on the same frame build (Molt Augmented's Strength goes through it)
    const arcaneOptions = searchArcanes(snapshot(withShardPick.build, withShardPick.debuffs), withShardPick.spec, withShardPick.loadout).slice(0, request.thorough ? 4 : 2)
    const withArcanes = soloBest(arcaneOptions.map((arcaneOption) => {
      const spec = { ...withShardPick.spec, arcaneIds: arcaneOption.ids }
      const evaluated = evaluateFrame(spec, withShardPick.loadout)
      return {
        spec, loadout: withShardPick.loadout, state: evaluated.state, cp: evaluated.corrosiveProjections, build: withShardPick.build,
        setup: { ...withLoadout(withShardPick.setup, spec, withShardPick.loadout, evaluated), arcanes: arcaneOption.ids.map((id) => arcanes.find((arcane) => arcane.uniqueName === id)!.name) },
      }
    }))
    emit(5, pathIndex, withArcanes.build, withArcanes.setup, withArcanes.debuffs)
    const debuffed = refine([withArcanes], maxed)
    emit(6, pathIndex, debuffed.build, debuffed.setup, maxed)
    const allies = searchAllies(snapshot(debuffed.build, maxed), debuffed.state, request.allyCount, option.candidate.situational.length > 0, debuffed.cp ?? 0)
    const withAllies = refine([{ ...debuffed, state: allies.state, setup: { ...debuffed.setup, allies: allies.allies, load: debuffed.setup.load && { ...debuffed.setup.load, casts: allies.state.casts } } }], maxed)
    emit(7, pathIndex, withAllies.build, withAllies.setup, maxed)
    paths.push({ index: pathIndex, label: describe(option.setup), situational: [...option.candidate.situational, ...allies.situational], finalPeak: withAllies.build.result.peakHit })
  })
  // melee prefers a path without situational abilities, ranged takes the best (flagged if it's situational)
  const ranked = [...paths].sort((a, b) => b.finalPeak - a.finalPeak)
  const preferred = isMelee ? ranked.find((path) => !path.situational.length) ?? ranked[0] : ranked[0]
  onPaths(paths, preferred?.index ?? 0)
}
