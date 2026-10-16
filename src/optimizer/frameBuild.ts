// a real Warframe mod build for the Damage Cap ladder: 8 slots, aura(s) and exilus, the ability augments locked in, and the
// rest picked from the frame mods that change weapon damage somewhere (Strength, Max Energy for Violet shards, squad auras,
// Gladiator / Nira / Vigilante pieces that count toward weapon set bonuses, Umbral pieces that enhance Umbral Intensify).
// conditionals are off (Final Act's low health, Archon Intensify's heal), Growing Power is assumed up like in the panel
import { arcanes, getWarframeMods, isAuraMod } from '../data'
import { modConflict } from '../calc/modConflicts'
import { maxConditionalStacks } from '../calc/parseMod'
import { warframeStateFor, warframeTotals, type EquippedWarframeMod } from '../calc/warframeStats'
import { abilitiesById, type AbilityCast, type WarframeState } from '../data/warframeAbilities'
import type { ShardSlot } from '../data/archonShards'
import type { Mod, Warframe } from '../types'

export const REGULAR_SLOTS = 8

export interface FrameSpec {
  frame: Warframe
  subsume: { warframe: string; ability: string } | null
  casts: AbilityCast[] // own, subsumed and allies'
  allyStrength: number
  arcaneIds: string[]
  shards: ShardSlot[]
}

export interface FrameLoadout {
  regular: Mod[] // augments first
  aura: Mod[]
  exilus: Mod | null
}

export interface FrameEval {
  state: WarframeState
  corrosiveProjections: number
  strength: number
  energy: number
}

// the frame-side incompatibilities (wiki infoboxes), kept here so the weapon conflict table doesn't change
const FRAME_GROUPS = [
  ['Intensify', 'Umbral Intensify', 'Archon Intensify', 'Precision Intensify'],
  ['Flow', 'Primed Flow', 'Archon Flow'],
]
const frameConflict = (a: Mod, b: Mod) =>
  Boolean(modConflict(a, b)) || FRAME_GROUPS.some((group) => group.includes(a.name) && group.includes(b.name))

// sets whose frame pieces do something for weapons (or for Umbral Intensify)
const DAMAGE_SETS = ['Umbra', 'Gladiator', 'Nira', 'Vigilante']

const equip = (mod: Mod): EquippedWarframeMod => ({ mod, rank: mod.fusionLimit, conditionalStacks: 0 })
const arcaneSlot = (arcaneId: string) => {
  const arcane = arcanes.find((candidate) => candidate.uniqueName === arcaneId)!
  const rank = arcane.levelStats.length - 1
  return { arcane, rank, conditionalStacks: maxConditionalStacks(arcane.levelStats, rank) }
}

export const loadoutMods = (loadout: FrameLoadout) => [...loadout.regular, ...loadout.aura, ...(loadout.exilus ? [loadout.exilus] : [])]

export function evaluateFrame(spec: FrameSpec, loadout: FrameLoadout): FrameEval {
  const build = {
    frame: spec.frame,
    mods: loadoutMods(loadout).map(equip),
    arcanes: spec.arcaneIds.map(arcaneSlot),
    extraStrength: 0,
    extraArmor: 0,
    teammateStrength: spec.allyStrength,
    casts: spec.casts,
    shards: spec.shards,
  }
  const totals = warframeTotals(build)
  return { state: warframeStateFor(build, totals), corrosiveProjections: totals.corrosiveProjections, strength: totals.abilityStrength, energy: totals.energy }
}

// the augments the casts need, as mods this frame (or its subsume) can equip
export function augmentMods(spec: FrameSpec): Mod[] {
  const frameMods = getWarframeMods(spec.frame, spec.subsume)
  const names = new Set(spec.casts.flatMap((cast) => {
    const augment = cast.by !== 'ally' ? abilitiesById.get(cast.id)?.augment : undefined
    return augment ? [augment] : []
  }))
  return frameMods.filter((mod) => names.has(mod.name))
}

// the mods worth trying on this frame: anything that changes a damage-side number on its own, or a damage set's piece
const poolCache = new Map<string, Mod[]>()
function candidatePool(spec: FrameSpec): Mod[] {
  const key = `${spec.frame.uniqueName}|${spec.subsume?.warframe ?? ''}:${spec.subsume?.ability ?? ''}`
  const cached = poolCache.get(key)
  if (cached) return cached
  const empty: FrameLoadout = { regular: [], aura: [], exilus: null }
  const signature = (loadout: FrameLoadout) => {
    const build = { frame: spec.frame, mods: loadoutMods(loadout).map(equip), arcanes: [], extraStrength: 0, extraArmor: 0, teammateStrength: 1, casts: [] }
    const totals = warframeTotals(build)
    return JSON.stringify([totals.abilityStrength, totals.energy, totals.auraDamage, totals.weakpointCritChance, totals.corrosiveProjections])
  }
  const base = signature(empty)
  const pool = getWarframeMods(spec.frame, spec.subsume).filter((mod) => {
    if (mod.modSet && DAMAGE_SETS.includes(mod.modSet)) return true
    const solo: FrameLoadout = isAuraMod(mod) ? { ...empty, aura: [mod] } : { ...empty, regular: [mod] }
    return signature(solo) !== base
  })
  poolCache.set(key, pool)
  return pool
}

const loadoutKey = (loadout: FrameLoadout) => loadoutMods(loadout).map((mod) => mod.name).sort().join('|')

// put one mod in: auras in the aura slot(s), exilus-capable ones in the exilus slot first, else a regular slot
function place(loadout: FrameLoadout, mod: Mod, auraSlots: number, regularSlots: number): FrameLoadout | null {
  if (loadoutMods(loadout).some((other) => frameConflict(other, mod))) return null
  if (isAuraMod(mod)) return loadout.aura.length < auraSlots ? { ...loadout, aura: [...loadout.aura, mod] } : null
  if (mod.isExilus && !loadout.exilus) return { ...loadout, exilus: mod }
  return loadout.regular.length < regularSlots ? { ...loadout, regular: [...loadout.regular, mod] } : null
}

// beam search over the frame's slots. one move = one mod, or every missing piece of a set at once (Umbral Intensify
// only gets its x1.75 with all 3 Umbral pieces, the other two do nothing alone)
export function optimizeFrameMods(
  spec: FrameSpec,
  score: (evaluated: FrameEval) => number,
  beamWidth = 6,
  regularSlots = REGULAR_SLOTS, // fewer for the reference-Strength pass (slots the augments would take)
): { loadout: FrameLoadout; evaluated: FrameEval; score: number } {
  const auraSlots = Math.max(1, spec.frame.auraPolarities.length)
  const pool = candidatePool(spec)
  const locked = augmentMods(spec)
  const start: FrameLoadout = { regular: locked.slice(0, REGULAR_SLOTS), aura: [], exilus: null }
  const rate = (loadout: FrameLoadout) => {
    const evaluated = evaluateFrame(spec, loadout)
    return { loadout, evaluated, score: score(evaluated) }
  }
  let best = rate(start)
  let beam = [best]
  const seen = new Set([loadoutKey(start)])
  const sets = [...new Set(pool.flatMap((mod) => (mod.modSet && DAMAGE_SETS.includes(mod.modSet) ? [mod.modSet] : [])))]
  for (let round = 0; round < regularSlots + auraSlots + 1 && beam.length; round++) {
    const next: typeof beam = []
    for (const current of beam) {
      const moves: FrameLoadout[] = []
      for (const mod of pool) {
        const placed = place(current.loadout, mod, auraSlots, regularSlots)
        if (placed) moves.push(placed)
      }
      for (const set of sets) {
        const missing = pool.filter((mod) => mod.modSet === set && !loadoutMods(current.loadout).some((other) => other.name === mod.name))
        if (missing.length < 2) continue
        let placed: FrameLoadout | null = current.loadout
        for (const mod of missing) placed = placed && place(placed, mod, auraSlots, regularSlots)
        if (placed) moves.push(placed)
      }
      for (const loadout of moves) {
        const key = loadoutKey(loadout)
        if (seen.has(key)) continue
        seen.add(key)
        next.push(rate(loadout))
      }
    }
    // ties: fewer mods first, so filler that does nothing doesn't sneak in
    next.sort((a, b) => b.score - a.score || loadoutMods(a.loadout).length - loadoutMods(b.loadout).length)
    beam = next.slice(0, beamWidth)
    if (beam[0] && beam[0].score > best.score * (1 + 1e-9)) best = beam[0]
  }
  return best
}

export const describeLoadout = (loadout: FrameLoadout) => [
  ...loadout.regular.map((mod) => mod.name),
  ...loadout.aura.map((mod) => `${mod.name} (aura)`),
  ...(loadout.exilus ? [`${loadout.exilus.name} (exilus)`] : []),
]
