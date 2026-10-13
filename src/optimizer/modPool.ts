// which mods are worth trying for an attack, and which ones can't be equipped together
import { parseUpgrade, type ModEffect } from '../calc/parseMod'
import type { Mod } from '../types'

// effects that can raise damage in the neutral scenario. faction banes, headshot/weak point bonuses and
// utility stats can't, so mods with only those never make the pool
const usefulEffect = (effect: ModEffect, includeFireRate: boolean) => {
  // magazine/reload mods only matter for sustained/time-window objectives
  switch (effect.kind) {
    case 'damageType':
    case 'slashOnCrit':
    case 'slashOnImpact':
    case 'damageMultiplier':
      return true
    case 'stat':
      if (effect.value <= 0) return false
      if (['fireRate', 'magazineCapacity', 'reloadSpeed'].includes(effect.stat)) return includeFireRate
      return !['headshotMultiplier', 'weakpointDamage', 'weakpointCritChance'].includes(effect.stat)
    default:
      return false
  }
}

export function damageModPool(compatibleMods: Mod[], includeFireRate: boolean): Mod[] {
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
    return [...parsed.effects, ...parsed.conditionals.map((conditional) => conditional.effect)].some((effect) =>
      usefulEffect(effect, includeFireRate),
    )
  })
}

// Primed/Amalgam/Archon/Umbral versions can't go next to the base mod ("Primed Cryo Rounds" + "Cryo Rounds").
// extra pairs the names don't reveal go in EXCLUSIVE_GROUPS
const VARIANT_PREFIX = /^(Primed|Amalgam|Archon|Umbral|Sacrificial|Spectral) /
const EXCLUSIVE_GROUPS: string[][] = [
  // add groups here when the game says two differently named mods conflict
  ['Pressure Point', 'Primed Pressure Point', 'Sacrificial Pressure', 'Amanata Pressure'], // wiki: Pressure Point incompatibles
  ['True Steel', 'Primed True Steel', 'Sacrificial Steel'], // same Umbral/Primed upgrade pattern as Pressure Point
]

const familyOf = (name: string) => name.replace(VARIANT_PREFIX, '')

export function conflicts(a: Mod, b: Mod): boolean {
  if (a.name === b.name || familyOf(a.name) === familyOf(b.name)) return true
  return EXCLUSIVE_GROUPS.some((group) => group.includes(a.name) && group.includes(b.name))
}
