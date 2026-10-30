// exalted weapons (summoned by an ability) and pseudo-exalted ones (Landslide, Shattered Lash, Whipclaw, Blade Storm: the ability
// itself takes melee mods). they're in the export's Misc list with their max-rank base damage, build-data turns them into
// normal weapons with an `exalted` tag, and the calc applies these rules (from each weapon's / frame's wiki page):
//  - strength: 'base' = base damage x your Ability Strength ("Ability Strength is additive and multiplicative to base damage",
//    Shattered Lash / Landslide; Exalted Blade, Talons, Iron Staff, Desert Wind, Diwata, Dex Pixia... list damage under Strength)
//    'bonus' = an Ability Strength damage bonus added in with the damage mods (Regulators' innate +150%, Neutralizer's x1.25)
//    'none' = fixed (Garuda's Talons are her innate claws, not an ability)
//  - abilityCombo: the pseudo-exalted "Ability version of the Melee Combo", +1x damage per combo multiplier on every hit
//  - noAttackSpeed: speed comes from Casting Speed, attack speed mods do nothing ("Attack Speed doesn't apply", Shattered Lash)
//  - banned: mods the wiki says can't be equipped (no blocking, heavies or finishers on pseudo-exalted)

export interface ExaltedRule {
  warframe: string
  ability: string
  pseudo?: boolean
  strength: 'base' | 'bonus' | 'none'
  strengthBonus?: number // 'bonus' only: the bonus at 100% strength
  abilityCombo?: boolean
  noAttackSpeed?: boolean
  finalMultiplier?: { value: number; requirement: string } // Peacemaker's ramp-up
  multishot?: Record<string, number> // per attack name (Artemis Bow fires 7 arrows)
  allowed?: string[] // mods the pseudo-exalted ban list (or the weapon class) would block but the wiki says work
  note?: string
}

const PSEUDO_BANNED = ['Parry', 'Reflex Coil', "Mentor's Legacy", 'Melee Animosity', 'Fury', 'Primed Fury', 'Finishing Touch', 'Melee Crescendo']

export const EXALTED: Record<string, ExaltedRule> = {
  'Exalted Blade': { warframe: 'Excalibur', ability: 'Exalted Blade', strength: 'base', note: 'Energy waves deal the same base damage as the swing and hit separately (not counted). Excalibur\'s sword passive always applies.' },
  'Valkyr Talons': { warframe: 'Valkyr', ability: 'Hysteria', strength: 'base', note: 'While Hysteria is up, Warcry\'s armor bonus is x3.' },
  'Iron Staff': { warframe: 'Wukong', ability: 'Primal Fury', strength: 'base' },
  'Desert Wind': { warframe: 'Baruuk', ability: 'Serene Storm', strength: 'base', note: 'Wind waves deal the same base damage as the swing (not counted).' },
  'Shadow Claws': { warframe: 'Sevagoth', ability: 'Exalted Shadow', strength: 'base', note: 'Uses Sevagoth\'s strength at cast, not the Shadow\'s.' },
  Diwata: { warframe: 'Titania', ability: 'Razorwing', strength: 'base' },
  'Dex Pixia': { warframe: 'Titania', ability: 'Razorwing', strength: 'base' },
  Regulators: {
    warframe: 'Mesa', ability: 'Peacemaker', strength: 'bonus', strengthBonus: 1.5,
    finalMultiplier: { value: 2.5, requirement: 'Peacemaker fully ramped up (20 bursts, +150% final damage)' },
    note: 'Innate +150% x Ability Strength, added in with Hornet Strike. The ramp-up (+7.5% up to +150% after 20 bursts) multiplies final damage, the export\'s 14.8 fire rate is the ramped one.',
  },
  'Artemis Bow': { warframe: 'Ivara', ability: 'Artemis Bow', strength: 'base', multishot: { 'Base Uncharged Shot': 7, 'Base Charged Shot': 7 }, note: 'Fires 7 arrows at max rank, damage isn\'t split between them.' },
  'Balefire Charger': { warframe: 'Hildryn', ability: 'Balefire', strength: 'base' },
  Noctua: { warframe: 'Dante', ability: 'Noctua', strength: 'base', note: 'Each primary shot splits into 4 homing fragments with the same damage (not counted).' },
  Glory: { warframe: 'Jade', ability: 'Glory on High', strength: 'base', note: 'The wiki says Hornet Strike, Secondary Merciless and Deathbringer don\'t affect the alt-fire base damage (not modeled).' },
  Neutralizer: { warframe: 'Cyte-09', ability: 'Neutralize', strength: 'bonus', strengthBonus: 0.25, note: '1x / 1.08x / 1.16x / 1.25x multiplier "additive with base damage mods such as Serration", so +25% x strength here.' },
  'Shattered Lash': { warframe: 'Gara', ability: 'Shattered Lash', pseudo: true, strength: 'base', abilityCombo: true, noAttackSpeed: true },
  'Landslide Fists': { warframe: 'Atlas', ability: 'Landslide', pseudo: true, strength: 'base', abilityCombo: true, noAttackSpeed: true },
  Whipclaw: { warframe: 'Khora', ability: 'Whipclaw', pseudo: true, strength: 'base', abilityCombo: true, noAttackSpeed: true, note: '200% damage on Ensnared enemies (Ensnare on the ability list).' },
  // Shadow Clones wiki: "does benefit from attack speed mods like Fury and can use the dagger-exclusive Covert Lethality", Melee
  // Crescendo raises its initial combo, and Blade Storm is a finisher, so Finishing Touch works on it
  'Shadow Clones': { warframe: 'Ash', ability: 'Blade Storm', pseudo: true, strength: 'base', abilityCombo: true, allowed: ['Fury', 'Primed Fury', 'Finishing Touch', 'Melee Crescendo', 'Covert Lethality'], note: 'Pure Finisher damage (ignores armor) with a guaranteed Bleed on every hit. The export has no damage numbers, 1,500 is from the wiki.' },
  'Garuda Talons': { warframe: 'Garuda', ability: 'innate claws', strength: 'none', note: 'Garuda\'s default claws, a normal weapon that doesn\'t scale with Ability Strength.' },
}

// "Exalted Prime Blade", "Valkyr Prime Talons", "Iron Staff Prime"... -> the rule's name
export const exaltedBaseName = (name: string) => name.replace(/ Prime( |$)/, '$1').replace(/^Exalted Umbra Blade$/, 'Exalted Blade').trim()
export const exaltedRuleFor = (weapon: { name: string; exalted?: boolean }) => (weapon.exalted ? EXALTED[exaltedBaseName(weapon.name)] ?? null : null)
export const bannedOnExalted = (weapon: { name: string; exalted?: boolean }, modName: string) => {
  const rule = exaltedRuleFor(weapon)
  return Boolean(rule?.pseudo && PSEUDO_BANNED.includes(modName) && !rule.allowed?.includes(modName))
}
// mods a pseudo-exalted can take that its class normally wouldn't (Covert Lethality is daggers only)
export const allowedOnExalted = (weapon: { name: string; exalted?: boolean }, modName: string) =>
  Boolean(exaltedRuleFor(weapon)?.allowed?.includes(modName))
