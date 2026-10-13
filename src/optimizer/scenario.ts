// the fixed setup every leaderboard build is scored against. the leaderboard is precomputed, so this has to be
// one neutral scenario: no faction, no armor, body shots, conditionals at max, and Condition Overload/Galvanized
// counting only the status types the build itself deals (base physical + modded elements)
import { STATUS_TYPES } from '../calc/constants'
import type { Buffs, Debuffs, TargetSettings } from '../types'

export const SCENARIO_DESCRIPTION =
  'Neutral target (no faction, no armor, body shots), mod/arcane conditionals at max stacks (headshot-triggered ones off), Condition Overload/Galvanized count only the build\'s own damage types, rank 30 with enough Forma (capacity ignored), no rivens.'

export const SCENARIO_TARGET: TargetSettings = {
  faction: 'None',
  layer: 'health',
  enemyId: null,
  baseLevel: 1,
  level: 1,
  steelPath: false,
  manualArmor: 0,
  headshot: false,
  headshotMultiplier: null,
  headcrit: null,
}

export const SCENARIO_DEBUFFS: Debuffs = {
  stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, 0])),
  heatArmorStrip: 0,
  corrosiveProjections: 0,
  otherArmorReduction: 0,
  damageVulnerability: 0,
  liftedOrKnockedDown: false,
  statusTypeSource: 'build',
}

export const SCENARIO_BUFFS: Buffs = { roar: 0 }
