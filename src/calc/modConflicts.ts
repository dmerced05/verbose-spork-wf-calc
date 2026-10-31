// which mods can't be equipped together. the export has no incompatibility field, so it's three checks:
//  1. same name (the game doesn't allow duplicates)
//  2. same internal mod: Primed / Galvanized / Spectral copies reuse the base mod's path with a suffix
//     (Hell's Chamber = .../Shotgun/WeaponFireIterationsMod, Galvanized Hell = .../Shotgun/WeaponFireIterationsSPMod)
//  3. INCOMPATIBLE_GROUPS: the "Incompatible Mods" infobox on each mod's wiki page, for pairs the paths don't reveal
import type { Mod } from '../types'

// each group is mutually exclusive. from wiki.warframe.com infoboxes ("Flawed" versions left out, they're not in the data)
export const INCOMPATIBLE_GROUPS: string[][] = [
  ['Serration', 'Spectral Serration', 'Amalgam Serration', 'Higasa Serration'],
  ['Split Chamber', 'Galvanized Chamber', 'Split Flights'],
  ["Hell's Chamber", 'Galvanized Hell'],
  ['Barrel Diffusion', 'Galvanized Diffusion', 'Amalgam Barrel Diffusion'],
  ['Sure Shot', 'Galvanized Shot'],
  ['Rifle Aptitude', 'Galvanized Aptitude'],
  ['Shotgun Savvy', 'Galvanized Savvy'],
  ['Melee Elementalist', 'Galvanized Elementalist'],
  ['True Steel', 'Sacrificial Steel', 'Galvanized Steel', 'Amalgam Ripkas True Steel'],
  ['Reflex Coil', 'Galvanized Reflex'],
  ['Argon Scope', 'Galvanized Scope'],
  ['Hydraulic Crosshairs', 'Galvanized Crosshairs'],
  ['Fatal Acceleration', 'Galvanized Acceleration'],
  ['Pressure Point', 'Primed Pressure Point', 'Sacrificial Pressure', 'Amanata Pressure'],
  ['Fury', 'Primed Fury', 'Berserker Fury'],
  // corrupted crit mods vs their normal version
  ['Point Strike', 'Critical Delay'],
  ['Pistol Gambit', 'Primed Pistol Gambit', 'Creeping Bullseye'],
  ['Blunderbuss', 'Primed Blunderbuss', 'Critical Deceleration'],
  // Amalgam mods vs the mod they're built from
  ['Organ Shatter', 'Amalgam Organ Shatter'],
  ['Shotgun Barrage', 'Amalgam Shotgun Barrage'],
  ['Magazine Warp', 'Primed Magazine Warp', 'Amalgam Javlok Magazine Warp'],
  ['Body Count', 'Amalgam Furax Body Count'],
  ['Metal Auger', 'Amalgam Argonak Metal Auger'],
]

const groupsByName = new Map<string, number[]>()
INCOMPATIBLE_GROUPS.forEach((group, index) => {
  for (const name of group) groupsByName.set(name, [...(groupsByName.get(name) ?? []), index])
})

// ".../Rifle/WeaponFireIterationsSPMod" -> "Primary Mod|WeaponFireIterationsMod". the type keeps rifle/pistol
// mods that share a path name apart (they never go on the same weapon anyway)
const internalKey = (mod: Mod) => {
  const last = mod.uniqueName.split('/').at(-1) ?? ''
  const base = last.replace(/Expert$/, '').replace(/Beginner$/, '').replace(/(SP|Invisible)Mod$/, 'Mod')
  return `${mod.type}|${base}`
}

export type ConflictReason = 'same mod' | 'variant' | 'wiki'

export function modConflict(a: Mod, b: Mod): ConflictReason | null {
  if (a.uniqueName === b.uniqueName || a.name === b.name) return 'same mod'
  if (internalKey(a) === internalKey(b)) return 'variant'
  // "Primed X" vs "X" when the paths differ (Primed Shred, Primed Target Cracker, Primed Banes...)
  if (a.name === `Primed ${b.name}` || b.name === `Primed ${a.name}`) return 'variant'
  const groupsA = groupsByName.get(a.name)
  if (groupsA && groupsByName.get(b.name)?.some((index) => groupsA.includes(index))) return 'wiki'
  return null
}

// remembered per pair: the optimizer asks the same pairs millions of times and the check runs regexes on the paths
const conflictMemo = new WeakMap<Mod, WeakMap<Mod, boolean>>()
export const modsConflict = (a: Mod, b: Mod) => {
  let row = conflictMemo.get(a)
  if (!row) conflictMemo.set(a, (row = new WeakMap()))
  let known = row.get(b)
  if (known === undefined) {
    known = modConflict(a, b) !== null
    row.set(b, known)
  }
  return known
}

// the first equipped mod that blocks `candidate`, for the "incompatible with X" label
export const blockingMod = (candidate: Mod, equipped: Mod[]) => equipped.find((mod) => modsConflict(candidate, mod)) ?? null
