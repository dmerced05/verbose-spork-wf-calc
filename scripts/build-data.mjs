// I slim warframe-items down to just what the calc needs, otherwise the browser
// would download ~12MB of patchlogs and drop tables it never uses.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const sourceDir = new URL('../node_modules/warframe-items/data/json/', import.meta.url)
const outDir = new URL('../src/data/', import.meta.url)
const readJson = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, sourceDir), 'utf8'))

const WEAPON_TYPES = new Set(['Rifle', 'Shotgun', 'Pistol', 'Dual Pistols', 'Throwing', 'Melee'])
const MOD_TYPES = new Set(['Primary Mod', 'Shotgun Mod', 'Secondary Mod', 'Melee Mod'])

// the export wraps damage types in color tags. usually the word follows the tag
// ("<DT_FIRE_COLOR>Heat") but sometimes it's just the tag ("apply <DT_SLASH_COLOR> on Critical")
const TAG_NAMES = {
  IMPACT: 'Impact', PUNCTURE: 'Puncture', SLASH: 'Slash', FIRE: 'Heat', FREEZE: 'Cold',
  ELECTRICITY: 'Electricity', POISON: 'Toxin', EXPLOSION: 'Blast', CORROSIVE: 'Corrosive',
  GAS: 'Gas', MAGNETIC: 'Magnetic', RADIATION: 'Radiation', VIRAL: 'Viral', RADIANT: 'Void', SENTIENT: 'Tau',
}
const cleanStatLine = (line) =>
  line
    .replace(/<DT_(\w+?)(?:_COLOR)?>(?![A-Za-z])/g, (_, tag) => TAG_NAMES[tag] ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()

const weapons = [...readJson('Primary'), ...readJson('Secondary'), ...readJson('Melee')]
  .filter((weapon) => WEAPON_TYPES.has(weapon.type) && weapon.attacks?.length)
  .map((weapon) => ({
    uniqueName: weapon.uniqueName,
    name: weapon.name,
    type: weapon.type,
    category: weapon.category,
    disposition: weapon.disposition ?? null,
    multishot: weapon.multishot ?? 1,
    imageName: weapon.imageName ?? null,
    polarities: weapon.polarities ?? [], // pre-installed slot polarities, fill the first slots
    // bows are listed as "Rifle", the internal path is the only reliable tell
    isBow: /\/Bows?\//i.test(weapon.uniqueName) || weapon.trigger === 'Charge' && /Cernos|Paris|Lenz|Dread|Daikyu|Bramma|Nagantaka/.test(weapon.name),

    // I use attacks[].damage on purpose: the top-level `damage` object has
    // slash/puncture swapped on some weapons (Braton Prime for one)
    attacks: weapon.attacks.map((attack) => ({
      name: attack.name,
      isAoE: attack.shot_type === 'AoE',
      fireRate: attack.speed ?? weapon.fireRate ?? 1,
      critChance: (attack.crit_chance ?? 0) / 100,
      critMultiplier: attack.crit_mult ?? 1,
      statusChance: (attack.status_chance ?? 0) / 100,
      damage: Object.fromEntries(
        Object.entries(attack.damage ?? {})
          .map(([damageType, amount]) => [damageType, Number(amount)])
          .filter(([, amount]) => amount > 0),
      ),
    })),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

const weaponMods = readJson('Mods')
  .filter((mod) => MOD_TYPES.has(mod.type) && mod.levelStats?.length)
  // skip the low-rank starter copies (there are three different "Serration"s)
  .filter((mod) => !/\/(Beginner|Intermediate)\//.test(mod.uniqueName))

// the export also has unreleased /Expert/ placeholder copies that reuse a normal mod's name
// (a 10-rank "Point Strike" at +275%). real mods have a wiki page and those don't, so when
// a name shows up more than once I keep only the copies that have one.
const modKey = (mod) => `${mod.type}|${mod.name}`
const namesWithWikiPage = new Set(weaponMods.filter((mod) => mod.wikiaUrl).map(modKey))

const mods = weaponMods
  .filter((mod) => mod.wikiaUrl || !namesWithWikiPage.has(modKey(mod)))
  .map((mod) => ({
    uniqueName: mod.uniqueName,
    name: mod.name,
    type: mod.type,
    compatName: mod.compatName ?? null,
    polarity: mod.polarity ?? null,
    rarity: mod.rarity ?? null,
    baseDrain: mod.baseDrain ?? 0,
    fusionLimit: mod.fusionLimit ?? 0,
    imageName: mod.imageName ?? null,
    // weapon exilus mods are flagged isUtility in the export
    isExilus: Boolean(mod.isUtility || mod.isExilus),
    levelStats: mod.levelStats.map((level) => level.stats.map(cleanStatLine)),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

// enemy presets for the target panel. the export's old health/armor types (Ferrite etc.)
// are pre-Update 36, so I only keep the base numbers and the faction.
const enemies = readJson('Enemy')
  .filter((enemy) => enemy.health > 0)
  .map((enemy) => ({
    uniqueName: enemy.uniqueName,
    name: enemy.name,
    faction: enemy.type ?? 'Unknown',
    health: enemy.health ?? 0,
    shield: enemy.shield ?? 0,
    armor: enemy.armor ?? 0,
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

// weapon arcanes only (the arcane slot on primaries/secondaries/melee)
const WEAPON_ARCANE_TYPES = new Set(['Primary Arcane', 'Secondary Arcane', 'Melee Arcane', 'Bow Arcane', 'Shotgun Arcane'])
const arcanes = readJson('Arcanes')
  .filter((arcane) => WEAPON_ARCANE_TYPES.has(arcane.type) && arcane.levelStats?.length)
  .map((arcane) => ({
    uniqueName: arcane.uniqueName,
    name: arcane.name,
    type: arcane.type,
    rarity: arcane.rarity ?? null,
    imageName: arcane.imageName ?? null,
    levelStats: arcane.levelStats.map((level) => level.stats.map(cleanStatLine)),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

mkdirSync(outDir, { recursive: true })
writeFileSync(new URL('arcanes.json', outDir), JSON.stringify(arcanes))
writeFileSync(new URL('weapons.json', outDir), JSON.stringify(weapons))
writeFileSync(new URL('mods.json', outDir), JSON.stringify(mods))
writeFileSync(new URL('enemies.json', outDir), JSON.stringify(enemies))
console.log(`wrote ${weapons.length} weapons, ${mods.length} mods, ${arcanes.length} arcanes, ${enemies.length} enemies to src/data/`)
