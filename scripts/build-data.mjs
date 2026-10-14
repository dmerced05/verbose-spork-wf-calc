// I slim @wfcd/items (formerly warframe-items, renamed in 2025) down to just what the calc needs, otherwise the browser
// would download ~12MB of patchlogs and drop tables it never uses.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const sourceDir = new URL('../node_modules/@wfcd/items/data/json/', import.meta.url)
const outDir = new URL('../src/data/', import.meta.url)
const readJson = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, sourceDir), 'utf8'))

// keep by category: newer data splits primaries into Rifle/Sniper/Launcher/Bow/Shotgun, and the type list keeps growing
const WEAPON_CATEGORIES = new Set(['Primary', 'Secondary', 'Melee'])
// productCategory tells moddable Warframe weapons apart from things like the Drifter's Sirocco (OperatorAmps)
const MODDABLE_PRODUCT_CATEGORIES = new Set(['LongGuns', 'Pistols', 'Melee'])
const MOD_TYPES = new Set(['Primary Mod', 'Shotgun Mod', 'Secondary Mod', 'Melee Mod', 'Warframe Mod'])

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

// the export has no Heavy Attack in attacks[], just weapon.heavyAttackDamage (total damage x the class's heavy
// multiplier, e.g. Paracesis 222 x 6 = 1332) and windUp. so I add one: the normal attack's damage split scaled up
// to heavyAttackDamage, same crit/status. some entries (glaives) list it at 1x, those I leave out
// heavyAttackDamage isn't consistent between classes (some list every hit added up, some one hit). the calc rescales the
// Heavy Attack for multi-hit classes from src/data/heavyAttacks.ts, this just stores the export's number
function withHeavyAttack(weapon, attacks) {
  if (weapon.category !== 'Melee' || !weapon.heavyAttackDamage) return attacks
  const normal = attacks.find((attack) => /^normal attack$/i.test(attack.name)) ?? attacks[0]
  const normalTotal = Object.values(normal?.damage ?? {}).reduce((total, amount) => total + amount, 0)
  const heavyMultiplier = weapon.heavyAttackDamage / (weapon.totalDamage || normalTotal || 1)
  if (!normal || normalTotal <= 0 || heavyMultiplier <= 1.01) return attacks
  const heavy = {
    ...normal,
    name: 'Heavy Attack',
    damage: Object.fromEntries(Object.entries(normal.damage).map(([damageType, amount]) => [damageType, amount * heavyMultiplier])),
    heavy: true,
    windUp: weapon.windUp ?? null,
    heavyMultiplier,
  }
  return [...attacks, heavy]
}

const weapons = [...readJson('Primary'), ...readJson('Secondary'), ...readJson('Melee')]
  .filter(
    (weapon) =>
      WEAPON_CATEGORIES.has(weapon.category) &&
      MODDABLE_PRODUCT_CATEGORIES.has(weapon.productCategory) &&
      weapon.type !== 'Zaw Component' &&
      weapon.attacks?.length,
  )
  .map((weapon) => ({
    uniqueName: weapon.uniqueName,
    name: weapon.name,
    type: weapon.type,
    category: weapon.category,
    disposition: weapon.disposition ?? null,
    multishot: weapon.multishot ?? 1,
    trigger: weapon.trigger ?? null, // Auto, Semi, Burst, Charge, Held... (Semi-___ Cannonade needs Semi)
    magazineSize: weapon.magazineSize ?? null,
    reloadTime: weapon.reloadTime ?? null,
    imageName: weapon.imageName ?? null,
    polarities: weapon.polarities ?? [], // pre-installed slot polarities, fill the first slots
    // newer data has a Bow type, the path check covers older entries still listed as Rifle
    isBow: weapon.type === 'Bow' || /\/Bows?\//i.test(weapon.uniqueName),

    // I use attacks[].damage on purpose: the top-level `damage` object has
    // slash/puncture swapped on some weapons (Braton Prime for one)
    attacks: withHeavyAttack(weapon, weapon.attacks.map((attack) => ({
      name: attack.name,
      isAoE: attack.shot_type === 'AoE',
      fireRate: attack.speed ?? weapon.fireRate ?? 1,
      chargeTime: attack.charge_time ?? null,
      // the data only has weapon-level multishot. Incarnon forms fire a single projectile even on shotguns
      // (Strun's 12 pellets don't apply to its Incarnon form), so they get 1
      multishot: /incarnon/i.test(attack.name) ? 1 : weapon.multishot ?? 1,
      critChance: (attack.crit_chance ?? 0) / 100,
      critMultiplier: attack.crit_mult ?? 1,
      statusChance: (attack.status_chance ?? 0) / 100,
      damage: Object.fromEntries(
        Object.entries(attack.damage ?? {})
          .map(([damageType, amount]) => [damageType, Number(amount)])
          .filter(([, amount]) => amount > 0),
      ),
      // heavy slams use up the combo and get its multiplier too (wiki Heavy_Attack)
      ...(weapon.category === 'Melee' && /heavy slam/i.test(attack.name) ? { heavy: true } : {}),
    }))),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

const weaponMods = readJson('Mods')
  .filter((mod) => MOD_TYPES.has(mod.type) && mod.levelStats?.length)
  // skip the low-rank starter copies (there are three different "Serration"s)
  .filter((mod) => !/\/(Beginner|Intermediate)\//.test(mod.uniqueName))

// the export also has unreleased /Expert/ placeholder copies that reuse a normal mod's name
// (a 10-rank "Point Strike" at +275%). they even have wiki links now, so I go by the path: when a name
// has a regular (non-/Expert/) version, the /Expert/ copies are dropped unless they're actually "Primed ...".
// Galvanized mods live under /Expert/ too, their extra "SubMod" copies are dropped.
const modKey = (mod) => `${mod.type}|${mod.name}`
const isExpert = (mod) => mod.uniqueName.includes('/Expert/')
const namesWithRegularVersion = new Set(weaponMods.filter((mod) => !isExpert(mod)).map(modKey))
const isPlaceholder = (mod) =>
  (isExpert(mod) && !mod.name.startsWith('Primed') && namesWithRegularVersion.has(modKey(mod))) || /SubMod$/.test(mod.uniqueName)

// a few same-named copies survive (two "Pressure Point"s: the real 5-rank +120% one and an internal 10-rank
// +200% "HeavyKill" entry). the fake copies are always the higher-rank ones, so the lowest rank wins
const lowestRankByName = new Map()
for (const mod of weaponMods) {
  if (isPlaceholder(mod)) continue
  const key = modKey(mod)
  if (!lowestRankByName.has(key) || mod.fusionLimit < lowestRankByName.get(key)) lowestRankByName.set(key, mod.fusionLimit)
}
const isFakeDuplicate = (mod) => mod.fusionLimit > lowestRankByName.get(modKey(mod))

const mods = weaponMods
  .filter((mod) => !isPlaceholder(mod) && !isFakeDuplicate(mod))
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
    // restrictions only live in the description, e.g. "Only compatible with Semi-Auto Trigger. Fire Rate cannot be modified."
    semiOnly: /only compatible with semi-auto/i.test(mod.description ?? ''),
    locksFireRate: /fire rate cannot be modified/i.test(mod.description ?? ''),
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

// Warframes for the Warframe panel: base armor/energy for Ability Strength and Primary Bulwark, slot polarities,
// and aura polarity (Jade's is a list, she has two aura slots)
const warframes = readJson('Warframes')
  .filter((frame) => frame.category === 'Warframes' && frame.productCategory === 'Suits')
  .map((frame) => ({
    uniqueName: frame.uniqueName,
    name: frame.name,
    health: frame.health ?? 0,
    shield: frame.shield ?? 0,
    armor: frame.armor ?? 0,
    energy: frame.power ?? 0,
    auraPolarities: [frame.aura ?? null].flat().map((polarity) => (polarity === 'aura' ? 'universal' : polarity)),
    polarities: frame.polarities ?? [],
    exilusPolarity: frame.exilusPolarity ?? null,
    passive: frame.passiveDescription ?? null,
    imageName: frame.imageName ?? null,
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

mkdirSync(outDir, { recursive: true })
writeFileSync(new URL('warframes.json', outDir), JSON.stringify(warframes))
writeFileSync(new URL('arcanes.json', outDir), JSON.stringify(arcanes))
writeFileSync(new URL('weapons.json', outDir), JSON.stringify(weapons))
writeFileSync(new URL('mods.json', outDir), JSON.stringify(mods))
writeFileSync(new URL('enemies.json', outDir), JSON.stringify(enemies))
console.log(`wrote ${weapons.length} weapons, ${warframes.length} warframes, ${mods.length} mods, ${arcanes.length} arcanes, ${enemies.length} enemies to src/data/`)
