import weaponsJson from './weapons.json'
import modsJson from './mods.json'
import enemiesJson from './enemies.json'
import arcanesJson from './arcanes.json'
import type { Arcane, Enemy, Mod, Weapon } from '../types'

// these JSON files come from scripts/build-data.mjs (runs on npm install / dev / build)
export const weapons = weaponsJson as Weapon[]
export const mods = modsJson as Mod[]
export const arcanes = arcanesJson as Arcane[]
export const arcanesById = new Map(arcanes.map((arcane) => [arcane.uniqueName, arcane]))
// only the main factions, the export also has wildlife, Stalker, specters etc.
export const enemies = (enemiesJson as Enemy[]).filter((enemy) => ['Grineer', 'Corpus', 'Infestation', 'Orokin', 'Sentient'].includes(enemy.faction))

export const weaponsById = new Map(weapons.map((weapon) => [weapon.uniqueName, weapon]))
export const modsById = new Map(mods.map((mod) => [mod.uniqueName, mod]))
export const enemiesById = new Map(enemies.map((enemy) => [enemy.uniqueName, enemy]))

const MOD_TYPE_FOR_WEAPON: Record<string, string> = {
  Rifle: 'Primary Mod',
  Shotgun: 'Shotgun Mod',
  Pistol: 'Secondary Mod',
  'Dual Pistols': 'Secondary Mod',
  Throwing: 'Secondary Mod',
  Melee: 'Melee Mod',
}

// compatNames that apply to every weapon of that mod type
// TODO: Sniper/Bow/Assault Rifle mods should only show up for those subtypes
const GENERIC_COMPAT = new Set(['Rifle', 'Assault Rifle', 'Sniper', 'Bow', 'PRIMARY', 'Shotgun', 'Pistol', 'Melee'])

export function getCompatibleMods(weapon: Weapon): Mod[] {
  const modType = MOD_TYPE_FOR_WEAPON[weapon.type]
  return mods.filter((mod) => {
    if (mod.type !== modType) return false
    if (!mod.compatName || GENERIC_COMPAT.has(mod.compatName)) return true
    // weapon-specific mods/augments, e.g. compatName "Paris Prime" or "Tetra"
    return weapon.name.startsWith(mod.compatName)
  })
}

// which arcane types fit a weapon's arcane slot. shotguns take primary + shotgun arcanes, bows take primary + bow
export function getCompatibleArcanes(weapon: Weapon): Arcane[] {
  const allowedTypes: Record<string, string[]> = {
    Rifle: weapon.isBow ? ['Primary Arcane', 'Bow Arcane'] : ['Primary Arcane'],
    Shotgun: ['Primary Arcane', 'Shotgun Arcane'],
    Pistol: ['Secondary Arcane'],
    'Dual Pistols': ['Secondary Arcane'],
    Throwing: ['Secondary Arcane'],
    Melee: ['Melee Arcane'],
  }
  const allowed = allowedTypes[weapon.type] ?? []
  return arcanes.filter((arcane) => allowed.includes(arcane.type))
}
