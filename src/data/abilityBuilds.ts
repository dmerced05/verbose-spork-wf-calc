// the builds the Data Analysis tab runs each ability on. abilities scale with different stats (a nuke wants Strength, a zone
// or a ramp wants Strength and Duration, Jade's beams want Duration), so each ability gets the build that fits it, made from
// real mods at max rank and run through the Warframe panel's own stat math (src/calc/warframeStats.ts), set bonus included
import { modsById, mods, warframesById, warframes, warframeBaseName } from '.'
import { warframeTotals, type WarframeTotals } from '../calc/warframeStats'
import type { ShardSlot } from './archonShards'
import type { AbilityDamageDef } from './abilityDamage'

export type AbilityBuildId = 'strength' | 'strength-duration' | 'duration'

export interface AbilityBuildTemplate {
  id: AbilityBuildId
  label: string
  mods: string[] // 8 mod slots (no aura, conditional mods like Growing Power left out)
  shards: { buffId: string; count: number }[]
  note: string
}

export const ABILITY_BUILDS: Record<AbilityBuildId, AbilityBuildTemplate> = {
  strength: {
    id: 'strength', label: 'Max Strength',
    mods: ['Umbral Intensify', 'Umbral Vitality', 'Umbral Fiber', 'Transient Fortitude', 'Blind Rage', 'Power Drift', 'Augur Secrets', 'Primed Flow'],
    shards: [{ buffId: 'crimson-strength', count: 5 }],
    note: 'One big cast: every Strength mod, Primed Flow to pay for Blind Rage, 5 Crimson Strength shards',
  },
  'strength-duration': {
    id: 'strength-duration', label: 'Strength + Duration',
    mods: ['Umbral Intensify', 'Umbral Vitality', 'Umbral Fiber', 'Blind Rage', 'Primed Continuity', 'Augur Message', 'Power Drift', 'Primed Flow'],
    shards: [{ buffId: 'crimson-strength', count: 3 }, { buffId: 'crimson-duration', count: 2 }],
    note: 'Zones, ramps and channels: Strength for the numbers, Duration so it lasts long enough to ramp',
  },
  duration: {
    id: 'duration', label: 'Max Duration',
    mods: ['Primed Continuity', 'Narrow Minded', 'Augur Message', 'Constitution', 'Umbral Intensify', 'Umbral Vitality', 'Umbral Fiber', 'Primed Flow'],
    shards: [{ buffId: 'crimson-duration', count: 5 }],
    note: 'Duration for more ticks (doubling beams, longer volleys), a bit of Strength from the Umbral set',
  },
}

// which build each ability runs on, and why (what its wiki page says scales it)
export const ABILITY_ANALYSIS: Record<string, { build: AbilityBuildId; why: string; params?: Record<string, number> }> = {
  'sound-quake': { build: 'strength-duration', why: 'Damage is Strength, the zone length is Duration' },
  'gaseous-quake': { build: 'strength-duration', why: 'Strength for the pulse, Duration for the energy drain and the zone after channeling. Needs ~614 energy, Primed Flow covers it' },
  'thermal-sunder': { build: 'strength-duration', why: 'Strength for each cast, Duration keeps the Heat procs (4-8 s by battery) up between recasts. 10 Heat casts: each one about doubles the last', params: { casts: 10 } },
  miasma: { build: 'strength-duration', why: 'Damage per second is Strength, the 6 s is Duration' },
  spores: { build: 'strength', why: 'Damage and the Corrosive chance are Strength, it never expires' },
  reave: { build: 'strength', why: 'The % drained is Strength (capped at 100%)' },
  smite: { build: 'strength', why: 'The % of current health is Strength (capped 75% at 215%)' },
  reckoning: { build: 'strength', why: 'Damage and the armor strip are Strength' },
  'hallowed-reckoning': { build: 'strength-duration', why: 'Strength for both, the patches last 10 s of Duration' },
  'seeking-talons': { build: 'strength', why: 'Damage per talon is Strength' },
  discharge: { build: 'strength-duration', why: 'Arc damage is Strength, the stun (how long it arcs) is Duration' },
  avalanche: { build: 'strength', why: 'Damage and the 60% armor strip are Strength' },
  inferno: { build: 'strength-duration', why: 'Meteor and ring damage are Strength, the ring is Duration' },
  'fire-blast': { build: 'strength', why: 'Damage and the armor strip are Strength' },
  crush: { build: 'strength', why: 'Strength twice inside Magnetize' },
  'soul-punch': { build: 'strength', why: 'Damage is Strength' },
  'final-stand': { build: 'strength-duration', why: 'Javelin damage is Strength, the javelin count is Duration' },
  'vial-rush': { build: 'strength-duration', why: 'Pool damage is Strength, the pools last for Duration' },
  'radial-javelin': { build: 'strength', why: 'Damage is Strength' },
  'antimatter-drop': { build: 'strength', why: 'Base and the absorbed multiplier are Strength' },
  'sol-gate': { build: 'strength-duration', why: 'Beam damage is Strength, Duration pays for the drain while it ramps' },
  'cataclysmic-gate': { build: 'strength-duration', why: 'Explosion and portal are Strength, the portal is Duration' },
  'blaze-artillery': { build: 'strength-duration', why: 'Damage is Strength, more Duration = more shots ramping the +100%' },
  virulence: { build: 'strength', why: 'Damage is Strength x (1 + Mutation stacks). Abundant Mutation in the build: 500 stacks', params: { stacks: 500 } },
  'coil-horizon': { build: 'strength', why: 'Damage is Strength' },
  'coil-recharge': { build: 'strength-duration', why: 'Discharge damage is Strength, the sphere stays out for Duration' },
  brimstone: { build: 'strength-duration', why: 'Damage is Strength, the field (and its 10x ramp) is Duration' },
  demonium: { build: 'strength', why: 'Damage and the Damage Vulnerability are Strength' },
  infernalis: { build: 'strength-duration', why: 'Damage is Strength, the aura is Duration' },
  infernum: { build: 'strength-duration', why: 'Fireballs are Strength, the 12/s rune boost is Duration' },
  'lights-judgment': { build: 'strength-duration', why: 'Well damage is Strength, the well is Duration' },
  'jades-judgment': { build: 'duration', why: 'The beam isn\'t Strength-scaled and doubles every tick: Duration adds ticks (16.67% each)' },
  'ophanim-eyes': { build: 'strength-duration', why: 'Damage and the strip are Strength, the gaze is Duration' },
  sow: { build: 'strength-duration', why: 'True damage per second is Strength, it lasts for Duration' },
  reap: { build: 'strength', why: 'Damage and the vulnerability are Strength' },
  'sow-reap': { build: 'strength', why: 'The 25% isn\'t Strength-scaled, but Reap\'s vulnerability multiplying it is' },
  'sleight-of-hand': { build: 'strength', why: 'Damage is Strength' },
  'jade-stars': { build: 'strength', why: 'Mote damage and status chance (1 Heat proc per 100%) are Strength' },
  sandstorm: { build: 'strength-duration', why: 'Damage is Strength, the storm is Duration' },
  'elemental-sandstorm': { build: 'strength', why: 'Procs per tick are Strength (1 per 100%), recast for uptime' },
  'sandstorm-jade-stars': { build: 'strength', why: 'Both the storm\'s procs and each mote\'s Heat procs are 1 per 100% Strength' },
  'explosive-legerdemain': { build: 'strength', why: 'Mine damage is Strength (status chance isn\'t)' },
}

// augment-only extras a build should carry for this ability (Virulence's stack cap)
const EXTRA_MODS: Record<string, string[]> = { virulence: ['Abundant Mutation'] }

const modByName = (name: string, frame: string) => mods.find((mod) => mod.name === name && (mod.compatName === 'WARFRAME' || mod.compatName === frame))

export interface ResolvedAbilityBuild {
  template: AbilityBuildTemplate
  why: string
  params: Record<string, number> // settings the analysis runs it with, over the card's defaults
  modNames: string[]
  totals: WarframeTotals
}

// the template on the ability's frame, its augment (and extras) swapped in for the last Strength/Duration filler
export function abilityBuildFor(def: AbilityDamageDef): ResolvedAbilityBuild {
  const analysis = ABILITY_ANALYSIS[def.id] ?? { build: 'strength' as const, why: 'Damage is Strength' }
  const template = ABILITY_BUILDS[analysis.build]
  const frame = warframes.find((candidate) => candidate.name === def.warframe) ?? [...warframesById.values()].find((candidate) => warframeBaseName(candidate.name) === def.warframe)!
  const extras = [...(def.augment ? [def.augment] : []), ...(EXTRA_MODS[def.id] ?? [])]
  // augments take the slots of the least important mods: Augur Secrets / Augur Message / Power Drift / Constitution
  const fillers = ['Augur Secrets', 'Augur Message', 'Constitution', 'Power Drift']
  let names = [...template.mods]
  for (const extra of extras) {
    const slot = fillers.map((filler) => names.indexOf(filler)).find((index) => index >= 0)
    if (slot !== undefined) names[slot] = extra
    else names = [...names.slice(0, 7), extra]
  }
  const equipped = names.flatMap((name) => {
    const mod = modByName(name, def.warframe)
    return mod ? [{ mod: modsById.get(mod.uniqueName)!, rank: mod.fusionLimit }] : []
  })
  const shards: ShardSlot[] = template.shards.flatMap(({ buffId, count }) => Array.from({ length: count }, () => ({ buffId, tauforged: false })))
  const totals = warframeTotals({ frame, mods: equipped, arcanes: [], extraStrength: 0, extraArmor: 0, shards, teammateStrength: 1, casts: [] })
  return { template, why: analysis.why, params: analysis.params ?? {}, modNames: names, totals }
}
