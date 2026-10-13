import type { CalcResult } from '../calc/damage'

// what the leaderboard can rank by. each one is optimized separately, since the best build for sustained DPS
// (magazine/reload mods matter) isn't the best one for a single hit (fire rate doesn't matter at all)
export type ObjectiveId = 'sustained' | 'window3' | 'window10' | 'window30' | 'single'

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
    description: 'Average DPS over a 60 s fight: reloads, status ticks as they land (Heat stacking included), DoT ticks after the fight ends not counted',
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
    description: 'One hit from one projectile (or one melee swing), crits averaged in, DoTs not included',
    usesFireRate: false,
    score: (result) => result.hit.average,
  },
]

export const objectiveById = (id: ObjectiveId) => OBJECTIVES.find((objective) => objective.id === id)!

// every precomputed ranking. the DPS-type ones get a second board optimized without fire rate / attack speed mods
export interface BoardSpec {
  key: string
  objective: Objective
  allowFireRateMods: boolean
}
export const boardKey = (id: ObjectiveId, allowFireRateMods: boolean) => (allowFireRateMods ? id : `${id}-nofr`)
export const BOARDS: BoardSpec[] = OBJECTIVES.flatMap((objective) =>
  [true, ...(objective.usesFireRate ? [false] : [])].map((allowFireRateMods) => ({
    key: boardKey(objective.id, allowFireRateMods),
    objective,
    allowFireRateMods,
  })),
)
