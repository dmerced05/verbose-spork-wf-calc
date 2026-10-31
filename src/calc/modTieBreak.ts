// which of two mods that do the same wins: the one without a catch. Serration over Heavy Caliber (same +165%, but
// -55% accuracy), Vital Sense over Bladed Rounds (same +120% crit damage, but only after kills while aiming). the calc
// counts conditionals at full stacks, so on paper they tie and list order would decide
import { nicheNote } from './nicheMods'
import { parseUpgrade } from './parseMod'
import type { Mod } from '../types'

const cache = new WeakMap<Mod, number>()
// 0 = always on, 1 = needs a condition (on kill, on headshot...), 2 = Niche tag (accuracy, reload-only...)
export function modCatch(mod: Mod): number {
  const cached = cache.get(mod)
  if (cached !== undefined) return cached
  const value = nicheNote(mod.levelStats, mod.fusionLimit) ? 2 : parseUpgrade(mod.levelStats, mod.fusionLimit).conditionals.length ? 1 : 0
  cache.set(mod, value)
  return value
}
