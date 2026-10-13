import { CORROSIVE_PROJECTION_PER_AURA, corrosiveArmorReduction } from './constants'
import type { Debuffs } from '../types'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// Enemy_Level_Scaling: blend of a low and high curve with a smoothstep between 70-80 levels over base
export function scaleArmor(baseArmor: number, levelsAboveBase: number): number {
  if (baseArmor <= 0) return 0
  const q = Math.max(0, levelsAboveBase)
  const lowCurve = 1 + 0.005 * q ** 1.75
  const highCurve = 1 + 0.4 * q ** 0.75
  const t = clamp((q - 70) / (80 - 70), 0, 1)
  const blend = t * t * (3 - 2 * t)
  const scaled = baseArmor * (lowCurve + (highCurve - lowCurve) * blend)
  return clamp(scaled, 200, 2700) // initial armor is clamped to 200-2700
}

// every armor reduction source multiplies: (1 - heat) x (1 - corrosive) x (1 - 18% x CP) x (1 - other)
export function effectiveArmor(armor: number, debuffs: Debuffs): number {
  return (
    armor *
    (1 - debuffs.heatArmorStrip) *
    (1 - corrosiveArmorReduction(debuffs.stacks.corrosive ?? 0)) *
    Math.max(0, 1 - CORROSIVE_PROJECTION_PER_AURA * debuffs.corrosiveProjections) *
    (1 - debuffs.otherArmorReduction)
  )
}

// DM = 1 - 0.9 * sqrt(AR / 2700). above 2700 the wiki says the AR / (AR + 300) form takes over
export function armorDamageMultiplier(armor: number): number {
  if (armor <= 0) return 1
  if (armor <= 2700) return 1 - 0.9 * Math.sqrt(armor / 2700)
  return 1 - armor / (armor + 300)
}

// ---- enemy level scaling (wiki Enemy_Level_Scaling) ----
// each stat blends a low-level curve f1 and high-level curve f2 with a smoothstep between levels 70-80 above base:
//   f(q) = 1 + C * q^E, q = level - base level, multiplier = f1 + (f2 - f1) * smoothstep
interface Curve { c: number; e: number }
interface ScalingCurves { low: Curve; high: Curve }

const HEALTH_CURVES: Record<string, ScalingCurves> = {
  grineer: { low: { c: 0.015, e: 2.12 }, high: { c: 10.7332, e: 0.72 } }, // also Scaldra
  corpus: { low: { c: 0.015, e: 2.12 }, high: { c: 13.4165, e: 0.55 } },
  infested: { low: { c: 0.0225, e: 2.12 }, high: { c: 16.0998, e: 0.72 } },
  corrupted: { low: { c: 0.015, e: 2.1 }, high: { c: 10.7332, e: 0.685 } },
  techrot: { low: { c: 0.02, e: 2.12 }, high: { c: 15.0998, e: 0.7 } },
  standard: { low: { c: 0.015, e: 2 }, high: { c: 10.7332, e: 0.5 } }, // Murmur, Sentient, Anarchs, unaffiliated
}
const SHIELD_CURVES: Record<string, ScalingCurves> = {
  corpus: { low: { c: 0.02, e: 1.76 }, high: { c: 2, e: 0.76 } },
  corrupted: { low: { c: 0.02, e: 1.75 }, high: { c: 2, e: 0.75 } },
  techrot: { low: { c: 0.02, e: 1.76 }, high: { c: 3.5, e: 0.76 } },
  standard: { low: { c: 0.02, e: 1.75 }, high: { c: 1.6, e: 0.75 } }, // Grineer and Sentient
}

// which curve set the (U36) faction dropdown uses
const SCALING_GROUP: Record<string, string> = {
  Grineer: 'grineer', 'Kuva Grineer': 'grineer', Scaldra: 'grineer',
  Corpus: 'corpus', 'Corpus Amalgam': 'corpus',
  Infested: 'infested', 'Infested Deimos': 'infested',
  Orokin: 'corrupted', Techrot: 'techrot',
}

function scalingMultiplier(curves: ScalingCurves, levelsAboveBase: number): number {
  const q = Math.max(0, levelsAboveBase)
  const low = 1 + curves.low.c * q ** curves.low.e
  const high = 1 + curves.high.c * q ** curves.high.e
  const t = clamp((q - 70) / (80 - 70), 0, 1)
  return low + (high - low) * t * t * (3 - 2 * t)
}

export const STEEL_PATH_LEVEL_BONUS = 100
export const STEEL_PATH_HEALTH_SHIELD_MULTIPLIER = 2.5 // armor isn't multiplied since Update 36

export function scaleHealth(baseHealth: number, levelsAboveBase: number, faction: string, steelPath: boolean): number {
  const curves = HEALTH_CURVES[SCALING_GROUP[faction] ?? 'standard']
  return baseHealth * scalingMultiplier(curves, levelsAboveBase) * (steelPath ? STEEL_PATH_HEALTH_SHIELD_MULTIPLIER : 1)
}

export function scaleShield(baseShield: number, levelsAboveBase: number, faction: string, steelPath: boolean): number {
  if (baseShield <= 0) return 0
  const curves = SHIELD_CURVES[SCALING_GROUP[faction] ?? 'standard'] ?? SHIELD_CURVES.standard
  return baseShield * scalingMultiplier(curves, levelsAboveBase) * (steelPath ? STEEL_PATH_HEALTH_SHIELD_MULTIPLIER : 1)
}
