import weaponsJson from './weapons.json'
import modsJson from './mods.json'
import enemiesJson from './enemies.json'
import arcanesJson from './arcanes.json'
import warframesJson from './warframes.json'
import helminthJson from './helminth.json'
import { allowedOnExalted, bannedOnExalted } from './exalted'
import type { Arcane, Enemy, Mod, Warframe, WarframeAbilityInfo, Weapon } from '../types'

// these JSON files come from scripts/build-data.mjs (runs on npm install / dev / build)
export const weapons = weaponsJson as Weapon[]
export const mods = modsJson as Mod[]
export const arcanes = arcanesJson as Arcane[]
export const arcanesById = new Map(arcanes.map((arcane) => [arcane.uniqueName, arcane]))
// only the main factions, the export also has wildlife, Stalker, specters etc.
export const enemies = (enemiesJson as Enemy[]).filter((enemy) => ['Grineer', 'Corpus', 'Infestation', 'Orokin', 'Sentient', 'Techrot'].includes(enemy.faction))

export const weaponsById = new Map(weapons.map((weapon) => [weapon.uniqueName, weapon]))
export const warframes = warframesJson as Warframe[]
export const warframesById = new Map(warframes.map((frame) => [frame.uniqueName, frame]))

// "Frost Prime" -> "Frost", what augments use as their compatName and what abilities are listed under
export const warframeBaseName = (name: string) => name.replace(/ (Prime|Umbra)$/, '')

// "Freeze Augment: Hold to cast..." -> Freeze. augments name their ability at the start of the text
export const augmentAbility = (mod: Mod) => (mod.levelStats.at(-1)?.[0] ?? '').match(/^(.+?) Augment ?:/)?.[1] ?? null
export const helminthAbilities = helminthJson as WarframeAbilityInfo[]

// Warframe mods: generic ones, auras, this frame's augments, and the augments of a subsumed ability
// (wiki: subsuming "will offer Freeze and its augments to be used by other Warframes")
export function getWarframeMods(frame: Warframe, subsumed?: { warframe: string; ability: string } | null): Mod[] {
  const baseName = warframeBaseName(frame.name)
  return mods.filter((mod) => mod.type === 'Warframe Mod' && (
    mod.compatName === 'WARFRAME' || mod.compatName === 'AURA' || mod.compatName === baseName ||
    (subsumed && mod.compatName === subsumed.warframe && augmentAbility(mod) === subsumed.ability)
  ))
}
export const isAuraMod = (mod: Mod) => mod.compatName === 'AURA'
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
  // melee class mods. the export has no melee class field, so glaives come from build-data's list and daggers from the path
  'Thrown Melee': (weapon) => Boolean(weapon.isGlaive),
  Daggers: (weapon) => /\/Melee\/Dagger\//i.test(weapon.uniqueName),
  // stance-class mods (Nira's Contempt, Boreal's Contempt, Amar's Contempt). no class field, so by name
  Whips: (weapon) => ['Atterax', 'Galvacord', 'Lecta', 'Secura Lecta', 'Scoliac', 'Mios'].includes(weapon.name),
  Polearms: (weapon) => ['Cassowar', 'Edun', 'Guandao', 'Guandao Prime', 'Kesheg', 'Lesion', 'Orthos', 'Orthos Prime', 'Serro', 'Sydon', 'Vaykor Sydon', 'Tonbo'].includes(weapon.name),
  'Dual Daggers': (weapon) => ['Ether Daggers', 'Fang', 'Fang Prime', 'Nepheri'].includes(weapon.name),
  Thrown: (weapon) => weapon.type === 'Throwing',
}

// weapon-specific mods name their weapon in compatName, not always in the same case ("AX-52" vs the weapon's "Ax-52",
// "EFV-8 Mars" vs "Efv-8 Mars"), so it's a case-insensitive prefix match
// augments go on every variant of their weapon (Nightwatch Napalm on the Kuva Ogris, Scattered Justice on the Vaykor Hek):
// the weapon's name with its variant prefix dropped has to start with the mod's weapon name, as a whole word, so "Bolto"
// doesn't catch "Boltor" and "Sobek" catches "Kuva Sobek". Prime / Wraith / Vandal come after the name already
const VARIANT_PREFIX = /^(kuva|tenet|coda|prisma|mk1-|rakta|sancti|secura|synoid|telos|vaykor|dex|mara|carmine)\s*/
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const namedFor = (weapon: Weapon, compatName: string) => {
  const name = weapon.name.toLowerCase()
  const pattern = new RegExp(`^${escapeRegExp(compatName.toLowerCase())}(\\s|$)`)
  return pattern.test(name) || pattern.test(name.replace(VARIANT_PREFIX, ''))
}

export function getCompatibleMods(weapon: Weapon): Mod[] {
  const modType = modTypeFor(weapon)
  return mods.filter((mod) => {
    // weapon augments are filed under odd types sometimes (Range Advantage for the Akjagara is a "Primary Mod", Clip Delegation for
    // the Sobek shotgun too), so a mod naming this weapon goes on it whatever its type
    if (mod.type !== modType) return mod.type !== 'Warframe Mod' && Boolean(mod.compatName) && !GENERIC_COMPAT.has(mod.compatName!) && !SUBTYPE_COMPAT[mod.compatName!] && namedFor(weapon, mod.compatName!)
    // Semi-___ Cannonade: "Only compatible with Semi-Auto Trigger" (from the mod's description)
    if (mod.semiOnly && weapon.trigger !== 'Semi') return false
    // pseudo-exalted abilities can't block, heavy attack or finish (Parry, Fury, Melee Animosity...), with per-ability exceptions
    if (bannedOnExalted(weapon, mod.name)) return false
    if (allowedOnExalted(weapon, mod.name)) return true
    if (!mod.compatName || GENERIC_COMPAT.has(mod.compatName)) return true
    if (SUBTYPE_COMPAT[mod.compatName]) return SUBTYPE_COMPAT[mod.compatName](weapon)
    // weapon-specific mods/augments, e.g. compatName "Paris Prime" or "Tetra"
    return namedFor(weapon, mod.compatName)
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
