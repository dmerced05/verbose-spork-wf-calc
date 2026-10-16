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

// glaives: a Heavy Attack while the glaive is in flight detonates it ("an explosion that deals Heavy Attack damage",
// wiki Heavy_Attack), and that's the Recall Explosion rows. so they're heavies (combo multiplier, Killing Blow,
// True Steel x2) with no wind-up animation ("the Heavy attack input does not initiate an attack animation").
// the forced procs are from each weapon's wiki attack table (Forced Procs on the Recall Explosions), the export
// doesn't have them. bounce explosions (Volatile Rebound) aren't heavies and have no forced procs
const GLAIVE_DETONATION_PROCS = {
  Glaive: ['impact'],
  'Glaive Prime': ['impact', 'slash'],
  Cerata: ['toxin', 'impact'],
  Xoris: ['impact', 'electricity'],
  Orvius: ['cold'],
  Pathocyst: ['impact', 'viral'],
  'Coda Pathocyst': ['impact', 'viral'],
  Falcor: ['electricity'],
  Halikar: ['impact'],
  'Halikar Wraith': ['impact'],
  Kestrel: ['impact'],
  'Kestrel Prime': ['impact'],
}
const glaiveDetonation = (weapon, attack) =>
  weapon.name in GLAIVE_DETONATION_PROCS && /Recall Explosion$/.test(attack.name)
    ? { heavy: true, windUp: null, forcedProcs: GLAIVE_DETONATION_PROCS[weapon.name] }
    : {}

// beams (wiki Multishot): "additional beams that hit the same target instead merge into a singular damage tick".
// the data has no beam flag, so a beam is a hit-scan attack on a Held-trigger weapon, or one named Held/Beam
// (Basmu's held beam sits on an Auto weapon). Held-trigger weapons' projectiles/explosions aren't beams
// Incarnon forms that turn into beams on a non-Held weapon: Torid ("becomes a continuous beam ... 2.3 m damage radius at
// the impact point") and Boar ("becomes a continuous beam weapon that can fire up to 3 beams")
const BEAM_INCARNON = /^(Torid|Boar|Boar Prime)$/
const isContinuous = (weapon, attack) =>
  attack.shot_type === 'Hit-Scan' && (weapon.trigger === 'Held' || /^Held$|\bBeam\b/i.test(attack.name) ||
    (BEAM_INCARNON.test(weapon.name) && /^Incarnon Form$/.test(attack.name)))

// which attack an AoE belongs to: "Charged Shot AoE" -> "Charged Shot", "Spear Explosion" -> "Spear Throw",
// a bare "Radial Attack"/"Explosion" -> the weapon's first direct attack. AoEs without an explosion-ish suffix
// (Ferrox's Attraction Field, Pox's cloud) don't get a parent
const AOE_SUFFIX = /\s*\b(AoE|Radial Attack|Explosion|Detonation)$/i
function aoeParent(weapon, attack) {
  if (!AOE_SUFFIX.test(attack.name)) return null
  const direct = weapon.attacks.filter((other) => other.shot_type !== 'AoE')
  const stem = attack.name.replace(AOE_SUFFIX, '').trim()
  if (!stem) return direct[0] ?? null
  const words = stem.split(' ')
  const shared = (other) => {
    const otherWords = other.name.split(' ')
    let count = 0
    while (count < words.length && otherWords[count] === words[count]) count++
    return count
  }
  let best = null
  for (const other of direct) if (shared(other) > (best ? shared(best) : 0)) best = other
  // Cedo's "Glaive Radial Attack" belongs to "Alt-Fire Glaive". no match at all = unknown, not a guess
  return best ?? direct.find((other) => other.name.split(' ').includes(words.at(-1))) ?? null
}

// Incarnon forms the GunCO sheet (Feb 2025) says "suffer from hitscan AoE characteristics (no MS, but gets CO)"
const NO_MULTISHOT_INCARNON = /^(Braton|Mk1-Braton|Braton Prime|Braton Vandal|Burston|Burston Prime|Zylok|Zylok Prime)$/

// attacks multishot mods don't touch. hitscan explosions are one explosion per trigger pull (GunCO sheet / wiki CO
// page: "AoE ignores multishot"), a beam's blast radius too (wiki Multishot: "no effect on the spherical blast radius
// of continuous weapons"), and "Multishot has no effect on the thrown component of Spearguns"
function multishotRule(weapon, attack) {
  if (attack.shot_type === 'AoE') {
    const parent = aoeParent(weapon, attack)
    if (parent && (parent.shot_type === 'Hit-Scan' || isContinuous(weapon, parent))) {
      return { noMultishotMods: true, hitscanAoE: true }
    }
  }
  if (weapon.category === 'Primary' && /\bSpear\b|\bThrow\b/.test(attack.name) && weapon.attacks.some((other) => /Throw/.test(other.name))) {
    return { noMultishotMods: true }
  }
  if (NO_MULTISHOT_INCARNON.test(weapon.name) && /^Incarnon Form/.test(attack.name)) return { noMultishotMods: true }
  return {}
}

// one weapon in the shape the calc wants. also used for the exalted weapons below
function toWeapon(weapon) {
  return {
    uniqueName: weapon.uniqueName,
    name: weapon.name,
    type: weapon.type,
    category: weapon.category,
    disposition: weapon.disposition ?? null,
    // the actual riven multiplier behind the dots (Soma Prime: 3 dots = x1.1). exalted weapons don't take rivens
    rivenDisposition: weapon.omegaAttenuation ?? null,
    multishot: weapon.multishot ?? 1,
    trigger: weapon.trigger ?? null, // Auto, Semi, Burst, Charge, Held... (Semi-___ Cannonade needs Semi)
    magazineSize: weapon.magazineSize ?? null,
    reloadTime: weapon.reloadTime ?? null,
    imageName: weapon.imageName ?? null,
    polarities: weapon.polarities ?? [], // pre-installed slot polarities, fill the first slots
    // newer data has a Bow type, the path check covers older entries still listed as Rifle
    isBow: weapon.type === 'Bow' || /\/Bows?\//i.test(weapon.uniqueName),
    ...(weapon.name in GLAIVE_DETONATION_PROCS ? { isGlaive: true } : {}),

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
      ...glaiveDetonation(weapon, attack),
      ...(isContinuous(weapon, attack) ? { continuous: true } : {}),
      ...multishotRule(weapon, attack),
    }))),
  }
}

const regularWeapons = [...readJson('Primary'), ...readJson('Secondary'), ...readJson('Melee')]
  .filter(
    (weapon) =>
      WEAPON_CATEGORIES.has(weapon.category) &&
      MODDABLE_PRODUCT_CATEGORIES.has(weapon.productCategory) &&
      weapon.type !== 'Zaw Component' &&
      weapon.attacks?.length,
  )
  .map((weapon) => toWeapon(weapon))


// exalted weapons (Exalted Blade, Valkyr Talons, Regulators...) and the pseudo-exalted abilities that take mods (Landslide,
// Shattered Lash, Whipclaw, Blade Storm) live in Misc. their numbers are the max-rank base, the calc scales them with
// Ability Strength (src/data/exalted.ts). archgun/archmelee ones are left out (no mods for those here)
const EXALTED_SLOTS = { Primary: 'Primary', Secondary: 'Secondary', Melee: 'Melee' }
const EXALTED_TYPES = { 'Artemis Bow': 'Bow', 'Artemis Bow Prime': 'Bow', Neutralizer: 'Sniper' }
// pseudo-exalted can't heavy attack ("Cannot perform blocking or heavy attacks"), Diwata neither
const NO_HEAVY = /^(Shattered Lash|Landslide Fists|Whipclaw|Shadow Clones|Diwata)/
const exaltedWeapons = readJson('Misc')
  .filter((item) => item.type === 'Exalted Weapon' && EXALTED_SLOTS[item.exaltedSlot] && item.attacks?.length)
  .map((item) => {
    const category = EXALTED_SLOTS[item.exaltedSlot]
    const source = {
      ...item,
      category,
      type: EXALTED_TYPES[item.name] ?? (category === 'Melee' ? 'Melee' : category === 'Secondary' ? 'Pistol' : 'Rifle'),
      heavyAttackDamage: NO_HEAVY.test(item.name) ? undefined : item.heavyAttackDamage,
      // Blade Storm's clones: the export has no numbers. wiki: 1,500 Finisher damage per hit at max rank, guaranteed Bleed.
      // Finisher damage ignores armor, so it goes in as True
      attacks: /^Shadow Clones/.test(item.name)
        ? [{ name: 'Clone Strike', speed: 2, crit_chance: 5, crit_mult: 1.2, status_chance: 5, damage: { true: 1500 } }]
        // Shattered Lash: tap = Thrust (Puncture), hold = Sweep (Slash)
        : item.attacks.map((attack) => ({ ...attack, name: /^Shattered Lash/.test(item.name) ? (attack.name === 'Damage' ? 'Thrust (tap)' : 'Sweep (hold)') : attack.name })),
    }
    const weapon = toWeapon(source)
    // Garuda's Talons are her innate claws, a normal weapon
    if (!/^Garuda/.test(item.name)) {
      weapon.exalted = true
      weapon.rivenDisposition = null // the export gives them 1, but exalted weapons have no riven slot
    }
    if (/^Shadow Clones/.test(item.name)) weapon.attacks = weapon.attacks.map((attack) => ({ ...attack, forcedProcs: ['slash'] }))
    // Noctua's Active Attack "needs a full meter, which takes 60 seconds to recharge. Primary hits reduce recharge by 1 second each".
    // firing the primary (1.5/s) the whole time, 60 - 1.5t = t gives one every 24 s
    if (item.name === 'Noctua') weapon.attacks = weapon.attacks.map((attack) => (attack.name === 'Active Attack' ? { ...attack, fireRate: 1 / 24 } : attack))
    // Artemis Bow "fires seven arrows at once" at max rank (not Concentrated Arrow), damage isn't split between them
    if (/^Artemis Bow/.test(item.name)) weapon.attacks = weapon.attacks.map((attack) => (/^Base /.test(attack.name) ? { ...attack, multishot: 7 } : attack))
    return weapon
  })
const weapons = [...regularWeapons, ...exaltedWeapons]
weapons.sort((a, b) => a.name.localeCompare(b.name))

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
    // mod sets (Umbra, Gladiator, Vigilante...): "/Lotus/Upgrades/Mods/Sets/Umbra/UmbraSetMod" -> "Umbra"
    modSet: mod.modSet ? mod.modSet.split('/').pop().replace(/SetMod$/, '') : null,
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

// weapon arcanes (the arcane slot on primaries/secondaries/melee) and Warframe arcanes (the frame's two slots; the plain
// "Arcane" type is the old revive/bleedout ones, they go on Warframes too). the export lists some Warframe arcanes several
// times with only one copy having levelStats, so it's one per name
const ARCANE_TYPES = new Set(['Primary Arcane', 'Secondary Arcane', 'Melee Arcane', 'Bow Arcane', 'Shotgun Arcane', 'Warframe Arcane', 'Arcane'])
const seenArcanes = new Set()
const arcanes = readJson('Arcanes')
  .filter((arcane) => ARCANE_TYPES.has(arcane.type) && arcane.levelStats?.length)
  .filter((arcane) => !seenArcanes.has(arcane.name) && seenArcanes.add(arcane.name))
  .map((arcane) => ({
    uniqueName: arcane.uniqueName,
    name: arcane.name,
    type: arcane.type === 'Arcane' ? 'Warframe Arcane' : arcane.type,
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
    passive: frame.passiveDescription ? frame.passiveDescription.replace(/<[^>]+>/g, '').replace(/ {2,}/g, ' ').trim() : null,
    imageName: frame.imageName ?? null,
    // the four abilities, for the ability list under the mods and the Helminth picker
    abilities: (frame.abilities ?? []).map((ability) => ({ name: ability.name, description: (ability.description ?? '').replace(/<[^>]+>/g, '').replace(/ {2,}/g, ' ').trim(), imageName: ability.imageName ?? null })),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

// the Helminth's own abilities (Marked For Death, Empower...), offered next to the subsumed ones
const helminthAbilities = (readJson('Warframes').find((frame) => frame.name === 'Helminth')?.abilities ?? [])
  .map((ability) => ({ name: ability.name, description: (ability.description ?? '').replace(/<[^>]+>/g, '').replace(/ {2,}/g, ' ').trim(), imageName: ability.imageName ?? null }))

mkdirSync(outDir, { recursive: true })
writeFileSync(new URL('warframes.json', outDir), JSON.stringify(warframes))

// mod set bonuses: the set's text per number of pieces equipped, named after its mods ("Umbral", "Vigilante", "Amar's")
const allMods = readJson('Mods')
const modSets = Object.fromEntries(allMods.filter((mod) => mod.type === 'Mod Set Mod').map((set) => {
  const key = set.uniqueName.split('/').pop().replace(/SetMod$/, '')
  const members = [...new Set(allMods.filter((mod) => mod.modSet === set.uniqueName).map((mod) => mod.name))].sort()
  return [key, { name: members[0]?.split(' ')[0] ?? key, pieces: set.numUpgradesInSet, stats: set.stats.map(cleanStatLine), members }]
}))
writeFileSync(new URL('modSets.json', outDir), JSON.stringify(modSets))
writeFileSync(new URL('helminth.json', outDir), JSON.stringify(helminthAbilities))
writeFileSync(new URL('arcanes.json', outDir), JSON.stringify(arcanes))
writeFileSync(new URL('weapons.json', outDir), JSON.stringify(weapons))
writeFileSync(new URL('mods.json', outDir), JSON.stringify(mods))
writeFileSync(new URL('enemies.json', outDir), JSON.stringify(enemies))

// riven stat pools per riven type, straight from the export's upgradeEntries (already has Update 44.1's spliced stats).
// the export value is per rank-unit, x90 gives the wiki's max rank base (Rifle Cold 0.01 -> 90%)
const RIVEN_TYPES = { Rifle: 'LotusRifleRandomModRare', Shotgun: 'LotusShotgunRandomModRare', Pistol: 'LotusPistolRandomModRare', Melee: 'PlayerMeleeWeaponRandomModRare' }
const rivens = Object.fromEntries(Object.entries(RIVEN_TYPES).map(([rivenType, id]) => {
  const riven = allMods.find((mod) => mod.uniqueName.endsWith(`/${id}`))
  return [rivenType, riven.upgradeEntries.map((entry) => {
    const [main] = entry.upgradeValues
    return {
      tag: entry.tag,
      // "|val|% <DT_FIRE_COLOR>Heat" -> "% Heat"
      text: main.locTag.replace(/<[^>]+>/g, '').replace(/\|(val|STAT1)\|/, '').trim(),
      base: Math.round(main.value * 90 * 1e6) / 1e6,
      ...(main.reverseValueSymbol ? { reversed: true } : {}),
    }
  })]
}))
writeFileSync(new URL('rivens.json', outDir), JSON.stringify(rivens))
console.log(`wrote ${weapons.length} weapons, ${warframes.length} warframes, ${mods.length} mods, ${arcanes.length} arcanes, ${enemies.length} enemies to src/data/`)
