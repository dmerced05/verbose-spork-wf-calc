import type { CalcResult } from '../calc/damage'
import type { HeavyMode } from '../data/heavyAttacks'

// what the leaderboard can rank by. each one is optimized separately, since the best build for sustained DPS
// (magazine/reload mods matter) isn't the best one for a single hit (fire rate doesn't matter at all)
export type ObjectiveId = 'sustained' | 'window3' | 'window10' | 'window30' | 'single' | 'attack' | 'ttk'

export interface Objective {
  id: ObjectiveId
  label: string
  unit: string
  description: string
  usesFireRate: boolean // fire rate, magazine and reload mods only matter when this is true
  score: (result: CalcResult) => number
}

export const TIME_WINDOWS = [3, 10, 30] as const

export const OBJECTIVES: Objective[] = [
  {
    id: 'sustained',
    label: 'Sustained DPS',
    unit: 'DPS',
    description: 'Average DPS over a 10 s fight on one enemy: reloads, status ticks as they land (Heat stacking included), DoT ticks after the fight ends not counted',
    usesFireRate: true,
    score: (result) => result.sustainedDps,
  },
  ...TIME_WINDOWS.map((seconds) => ({
    id: `window${seconds}` as ObjectiveId,
    label: `Damage in ${seconds} s`,
    unit: `in ${seconds} s`,
    description: `Total damage dealt in the first ${seconds} seconds of firing, reloads and DoT ticks inside the window included`,
    usesFireRate: true,
    score: (result: CalcResult) => result.damageInWindow(seconds),
  })),
  {
    id: 'single',
    label: 'Single damage instance',
    unit: 'per hit',
    description: 'One hit from one projectile (or one melee swing, or one merged beam tick), crits averaged in, DoTs not included. Guns hit the head (weak point mods and Acuity in play, AoE can\'t headshot), melee hits the body',
    usesFireRate: false,
    // a beam's extra beams merge into one tick on the target, so its single instance is the whole merged tick
    score: (result) => result.hit.average * result.beamMerge,
  },
  {
    // what a heavy / glaive detonation actually does: Glaive Prime's detonation lives on its forced Slash proc,
    // and Melee Duplicate's second strike is its own damage instance, so neither shows up in the single-hit score
    id: 'attack',
    label: 'Whole attack (hit + procs)',
    unit: 'per attack',
    description: 'Everything one attack does to the target: every pellet (and Melee Duplicate strike), crits averaged in, plus the full DoT of every proc it lands (Slash bleed, Heat burn...). One target, no fire rate',
    usesFireRate: false,
    score: (result) => result.attackTotal,
  },
]

// the Boss board's ranking: how fast one build kills a boss (target.pool). higher score = faster, so it's stored as 1 / seconds
// (past 10 minutes the time is extrapolated, see damage.ts timeToReach). the page shows the seconds back
export const TTK_OBJECTIVE: Objective = {
  id: 'ttk',
  label: 'Time to kill',
  unit: 's to kill',
  description: 'Seconds to strip the boss\'s shields and empty its health, solo: expected damage over time with reloads, Incarnon refills and DoT ticks as they land',
  usesFireRate: true,
  score: (result) => (result.timeToKill && Number.isFinite(result.timeToKill) && result.timeToKill > 0 ? 1 / result.timeToKill : 0),
}
export const ttkSeconds = (score: number) => (score > 0 ? 1 / score : Infinity)

export const objectiveById = (id: ObjectiveId) => (id === 'ttk' ? TTK_OBJECTIVE : OBJECTIVES.find((objective) => objective.id === id)!)

// every precomputed ranking. the DPS-type ones get a second board optimized without fire rate / attack speed mods
export interface BoardSpec {
  key: string
  objective: Objective
  allowFireRateMods: boolean
  heavyMode?: HeavyMode
  heavyOnly?: boolean // only multi-hit Heavy Attacks get an entry, the page falls back to the normal board for the rest
  headshot?: boolean // guns score this board on headshots (scenario.ts SCENARIO_HEADSHOT), melee doesn't
}
export const boardKey = (id: ObjectiveId, allowFireRateMods: boolean) => (allowFireRateMods ? id : `${id}-nofr`)
// "Count the full heavy": multi-hit Heavy Attacks scored with every hit added up
export const FULL_HEAVY_BOARD = 'single-fullheavy'
export const BOARDS: BoardSpec[] = [
  ...OBJECTIVES.flatMap((objective) =>
    [true, ...(objective.usesFireRate ? [false] : [])].map((allowFireRateMods) => ({
      key: boardKey(objective.id, allowFireRateMods),
      objective,
      allowFireRateMods,
      headshot: objective.id === 'single',
    })),
  ),
  { key: FULL_HEAVY_BOARD, objective: objectiveById('single'), allowFireRateMods: true, heavyMode: 'fullCombo', heavyOnly: true },
]
