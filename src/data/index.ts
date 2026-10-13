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

// shotguns take shotgun mods, every other primary (Rifle/Sniper/Launcher/Bow) takes rifle ("Primary") mods
const modTypeFor = (weapon: Weapon) =>
  weapon.category === 'Primary' ? (weapon.type === 'Shotgun' ? 'Shotgun Mod' : 'Primary Mod') : weapon.category === 'Secondary' ? 'Secondary Mod' : 'Melee Mod'

// compatNames that apply to every weapon of that mod type
const GENERIC_COMPAT = new Set(['Rifle', 'PRIMARY', 'Shotgun', 'Pistol', 'Melee'])
// subtype mods only go on that subtype now that the data has Sniper/Bow types
const SUBTYPE_COMPAT: Record<string, (weapon: Weapon) => boolean> = {
  Sniper: (weapon) => weapon.type === 'Sniper',
  Bow: (weapon) => weapon.type === 'Bow' || weapon.isBow,
  'Assault Rifle': (weapon) => weapon.type === 'Rifle',
}

export function getCompatibleMods(weapon: Weapon): Mod[] {
  const modType = modTypeFor(weapon)
  return mods.filter((mod) => {
    if (mod.type !== modType) return false
    // Semi-___ Cannonade: "Only compatible with Semi-Auto Trigger" (from the mod's description)
    if (mod.semiOnly && weapon.trigger !== 'Semi') return false
    if (!mod.compatName || GENERIC_COMPAT.has(mod.compatName)) return true
    if (SUBTYPE_COMPAT[mod.compatName]) return SUBTYPE_COMPAT[mod.compatName](weapon)
    // weapon-specific mods/augments, e.g. compatName "Paris Prime" or "Tetra"
    return weapon.name.startsWith(mod.compatName)
  })
}

// which arcane types fit a weapon's arcane slot. shotguns take primary + shotgun arcanes, bows take primary + bow
export function getCompatibleArcanes(weapon: Weapon): Arcane[] {
  const allowed =
    weapon.category === 'Primary'
      ? ['Primary Arcane', ...(weapon.type === 'Shotgun' ? ['Shotgun Arcane'] : []), ...(weapon.isBow ? ['Bow Arcane'] : [])]
      : weapon.category === 'Secondary'
        ? ['Secondary Arcane']
        : ['Melee Arcane']
  return arcanes.filter((arcane) => allowed.includes(arcane.type))
}
