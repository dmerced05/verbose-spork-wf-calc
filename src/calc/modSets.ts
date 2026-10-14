// mod set bonuses. sets count every equipped piece across the Warframe and the weapon being calculated (companion and other
// weapons aren't modeled), the set text per piece count comes from the export (src/data/modSets.json).
// what does something here:
//  - Umbra / Sacrificial: "Enhance mods in this set". Umbral Fiber/Vitality +30% / +80% of their values with 2 / 3 pieces,
//    Umbral Intensify only +25% / +75% (Umbral Fiber wiki), Sacrificial +25% of all stats with both (Sacrificial Steel wiki)
//  - Gladiator: +10% melee crit chance per combo multiplier per piece (already in the combo math)
//  - Vigilante: 5% per piece "chance to enhance Critical Hits from Primary Weapons", read as +1 crit tier
//  - Nira's: +150% slam damage per piece, "additive to" Seismic Wave (Nira's Set wiki), melee slams only
// the rest (Augur shields, Boreal airborne DR, companion sets...) are listed but not in the numbers
import modSetsJson from '../data/modSets.json'
import type { Mod } from '../types'

export interface ModSetInfo {
  name: string
  pieces: number
  stats: string[] // text with 1, 2, ... pieces
  members: string[]
}
export const MOD_SETS = modSetsJson as Record<string, ModSetInfo>

export type SetPieces = Record<string, number>

export const countSets = (mods: Pick<Mod, 'modSet'>[]): SetPieces => {
  const pieces: SetPieces = {}
  for (const mod of mods) if (mod.modSet) pieces[mod.modSet] = (pieces[mod.modSet] ?? 0) + 1
  return pieces
}
export const addPieces = (a: SetPieces, b: SetPieces | undefined): SetPieces => {
  const total = { ...a }
  for (const [set, count] of Object.entries(b ?? {})) total[set] = (total[set] ?? 0) + count
  return total
}

// how much a set-member mod's own stats are multiplied by ("Enhance mods in this set")
export function setEnhancement(mod: Pick<Mod, 'name' | 'modSet'>, pieces: SetPieces) {
  const count = mod.modSet ? Math.min(pieces[mod.modSet] ?? 0, MOD_SETS[mod.modSet]?.pieces ?? 0) : 0
  if (mod.modSet === 'Umbra') {
    const steps = mod.name === 'Umbral Intensify' ? [1, 1, 1.25, 1.75] : [1, 1, 1.3, 1.8]
    return steps[count] ?? 1
  }
  if (mod.modSet === 'Sacrifice') return count >= 2 ? 1.25 : 1
  return 1
}

export const VIGILANTE_ENHANCE_PER_PIECE = 0.05
export const NIRA_SLAM_PER_PIECE = 1.5

// one line per set with at least one piece: "Umbral 3/3: Enhance mods in this set."
export const setSummary = (pieces: SetPieces) =>
  Object.entries(pieces)
    .filter(([set, count]) => count > 0 && MOD_SETS[set])
    .map(([set, count]) => {
      const info = MOD_SETS[set]
      const capped = Math.min(count, info.pieces)
      return { set, name: info.name, count: capped, pieces: info.pieces, text: info.stats[capped - 1] ?? '' }
    })
