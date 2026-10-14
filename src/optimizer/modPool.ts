// which mods are worth trying for an attack, and which ones can't be equipped together
import { modsConflict } from '../calc/modConflicts'
import { parseUpgrade, raisesFireRate, type ModEffect } from '../calc/parseMod'
import type { Mod } from '../types'

// effects that can raise damage in the neutral scenario. faction banes, headshot/weak point bonuses and
// utility stats can't, so mods with only those never make the pool
const HEAVY_ONLY_STATS = ['heavyCritChance', 'heavyDamage', 'heavyWindUpSpeed']
// which attack the pool is for: heavy-only stats need a heavy, Seismic Wave a slam, Power Throw a throw
export interface PoolAttack {
  isHeavy: boolean
  name: string
}
const usefulEffect = (effect: ModEffect, includeFireRate: boolean, { isHeavy, name }: PoolAttack) => {
  // magazine/reload mods only matter for sustained/time-window objectives
  switch (effect.kind) {
    case 'damageType':
    case 'slashOnCrit':
    case 'slashOnImpact':
    case 'damageMultiplier':
    case 'heavyScaledCritChance':
    case 'flatStat':
    case 'forcedProcChance':
    case 'duplicateOnCrit':
      return true
    case 'stat':
      if (effect.value <= 0) return false
      if (['fireRate', 'magazineCapacity', 'reloadSpeed'].includes(effect.stat)) return includeFireRate
      if (effect.stat === 'heavyWindUpSpeed') return isHeavy && includeFireRate
      if (HEAVY_ONLY_STATS.includes(effect.stat)) return isHeavy
      if (effect.stat === 'slamDamage') return /slam/i.test(name)
      if (effect.stat === 'throwDamage') return /throw$/i.test(name)
      // heavy efficiency only changes what's left after the hit, not the hit itself
      return !['headshotMultiplier', 'weakpointDamage', 'weakpointCritChance', 'heavyEfficiency'].includes(effect.stat)
    default:
      return false
  }
}

export function damageModPool(
  compatibleMods: Mod[], includeFireRate: boolean, attack: PoolAttack = { isHeavy: false, name: '' }, allowFireRateMods = true,
): Mod[] {
  // one per name (the highest-rank copy), like the in-game rule that same-named mods don't stack
  const byName = new Map<string, Mod>()
  for (const mod of compatibleMods) {
    const existing = byName.get(mod.name)
    if (!existing || mod.fusionLimit > existing.fusionLimit) byName.set(mod.name, mod)
  }
  return [...byName.values()].filter((mod) => {
    const parsed = parseUpgrade(mod.levelStats, mod.fusionLimit)
    // Acuity locks multishot and only pays off on headshots, which the neutral scenario doesn't do
    if (parsed.effects.some((effect) => effect.kind === 'lockMultishot')) return false
    if (!allowFireRateMods && raisesFireRate(mod.levelStats, mod.fusionLimit)) return false
    return [...parsed.effects, ...parsed.conditionals.map((conditional) => conditional.effect)].some((effect) =>
      usefulEffect(effect, includeFireRate, attack),
    )
  })
}

// same rules as the calculator's mod browser (src/calc/modConflicts.ts)
export const conflicts = (a: Mod, b: Mod) => modsConflict(a, b)
