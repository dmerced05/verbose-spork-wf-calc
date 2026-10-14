// popular Warframe abilities / passives that buff weapons. numbers are max rank from each ability's wiki page,
// scaled by Ability Strength when the page says so (I assume linear, value x strength).
// each effect kind maps onto how the wiki says it stacks:
//  - factionDamage: Roar, additive with banes, counts twice on status ticks
//  - damageMultiplier: Eclipse, its own multiplier (not multiplied into additive Condition Overload)
//  - baseDamage: Vex Armor's Fury, Excalibur's passive, added in with Serration
//  - element: Nourish's Viral works like an elemental mod. Freeze Force / Electric Shield add an element that doesn't combine
//  - extraHit: Xata's Whisper, a separate Void hit worth X% of the weapon's damage (mods, crit and faction x2 apply)
//  - attackSpeed / flatCritChance / critDamageMultiplier: Warcry, Wrathful Advance, Electric Shield
//  - critChanceMod / critDamageMod: augment crit buffs (Biting Frost, Smoke Shadow...), added in with crit mods. the wiki pages
//    don't say how they stack, so I treat them like a Point Strike / Vital Sense
// who casts it matters (see AbilityCast): your own and your subsumed ability use your strength, an ally's uses theirs,
// and subsumed versions are weaker on some (Helminth values from each frame's Abilities wiki page)

export type AbilityEffect =
  | { kind: 'factionDamage'; value: number }
  | { kind: 'damageMultiplier'; value: number }
  | { kind: 'baseDamage'; value: number }
  // boostsStatus: also adds to that element's DoT like an elemental mod. forcedProc: the element takes no share of the status
  // procs, it forces one proc of its own on every hit instead (Shock Trooper)
  | { kind: 'element'; damageType: string; value: number; combines: boolean; boostsStatus?: boolean; forcedProc?: boolean }
  | { kind: 'extraHit'; damageType: string; value: number }
  | { kind: 'attackSpeed'; value: number }
  | { kind: 'flatCritChance'; value: number }
  | { kind: 'critDamageMultiplier'; value: number }
  | { kind: 'critChanceMod'; value: number }
  | { kind: 'critDamageMod'; value: number }

// survivability side (src/calc/warframeStats.ts): % of base armor/health/shields (added in with the mods, like Warcry's wiki
// formula "Base Armor x (1 + Armor Mods + Warcry Modifier x (1 + Strength Mods))"), or a damage reduction source
export type DefenseEffect =
  | { kind: 'armorPercent' | 'healthPercent' | 'shieldPercent'; value: number; selfOnly?: boolean }
  | { kind: 'damageReduction'; perStack: number; stacks: number; cap: number; helminthCap?: number; selfOnly?: boolean }

export interface WarframeAbility {
  id: string
  ability?: string // the in-game ability it comes from (matches the frame's ability list), none for passives
  augment?: string // needs this augment mod equipped (Freeze Force), when it's on your own frame
  variant?: string // abilities with several ways to cast (Thermal Transfer heat / cold / both), picked on the ability card
  selfOnly?: boolean // a passive: only when you're playing that Warframe, a teammate can't give it to you
  name: string
  warframe: string
  appliesTo: 'all' | 'melee' | 'guns' | 'primary'
  scalesWithStrength: boolean
  condition?: string // what has to be true in the fight, for the results' requirement list (default: the buff is up)
  stacks?: { label: string; max: number; default: number } // per-stack effects (Thrall Pact: per Thrall)
  effects: AbilityEffect[]
  defense?: DefenseEffect[] // armor / health / shields / damage reduction, for the Survivability numbers
  quote: string // from the ability's wiki page
  note?: string
  helminth?: { effects: AbilityEffect[]; quote: string } // subsumed version, when it differs
}

export const WARFRAME_ABILITIES: WarframeAbility[] = [
  {
    id: 'roar', ability: 'Roar', name: 'Roar', warframe: 'Rhino', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'factionDamage', value: 0.5 }],
    quote: '+50% damage, additive with other sources of Faction Damage, and multiplicative with other types of bonus damage',
    helminth: { effects: [{ kind: 'factionDamage', value: 0.3 }], quote: "Subsumed Roar's damage bonus is reduced to 2% / 9% / 15% / 30%." },
  },
  {
    id: 'eclipse', condition: 'standing in light', ability: 'Eclipse', name: 'Solar Eclipse', warframe: 'Mirage', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'damageMultiplier', value: 2 }],
    quote: '+200% weapon damage. The damage buff is an unique multiplier.',
    note: 'Assumes full light.',
    helminth: { effects: [{ kind: 'damageMultiplier', value: 0.3 }], quote: 'Subsumed Eclipse: damage bonus 2% / 9% / 15% / 30%' },
  },
  {
    id: 'vexArmor', condition: 'Fury and Scorn charged to max', ability: 'Vex Armor', name: 'Vex Armor (Fury + Scorn, maxed)', warframe: 'Chroma', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'baseDamage', value: 2.75 }],
    defense: [{ kind: 'armorPercent', value: 3.5 }],
    quote: '275% Fury max damage bonus, additive to base damage mods like Serration. Scorn: maximum armor bonus 200 / 250 / 300 / 350%',
    note: 'The wiki doesn\'t say if Scorn is % of base or modded armor, treated like Warcry (base, added in with armor mods).',
  },
  {
    id: 'xatasWhisper', ability: "Xata's Whisper", name: "Xata's Whisper", warframe: 'Xaku', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'extraHit', damageType: 'void', value: 0.26 }],
    quote: '26% of total weapon damage as Void damage. Damage bonus is a separate damage instance.',
    note: 'Its own Void procs aren\'t modeled. The wiki lists no separate subsumed value.',
  },
  {
    id: 'nourish', ability: 'Nourish', name: 'Nourish', warframe: 'Grendel', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'element', damageType: 'viral', value: 0.75, combines: true }],
    quote: 'Think of it like adding a +75% Viral mod to your weapons (which is buffed by Ability Strength)',
    helminth: {
      effects: [{ kind: 'element', damageType: 'viral', value: 0.45, combines: true }],
      quote: 'Viral weapon bonus damage is reduced to +24% / +30% / +36% / +45%.',
    },
  },
  {
    id: 'freezeForce', ability: 'Freeze', augment: 'Freeze Force', name: 'Freeze Force (Freeze augment)', warframe: 'Frost', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'element', damageType: 'cold', value: 1, combines: false, boostsStatus: true }],
    quote: 'an additional 100% Cold Damage to their attacks. This damage bonus does not combine with other elements',
  },
  {
    id: 'electricShield', condition: 'shooting through Electric Shield', ability: 'Electric Shield', name: 'Electric Shield (shooting through)', warframe: 'Volt', appliesTo: 'guns', scalesWithStrength: false,
    effects: [{ kind: 'element', damageType: 'electricity', value: 0.5, combines: false }, { kind: 'critDamageMultiplier', value: 1 }],
    quote: '+50% Electricity Damage and +100% Critical Damage, multiplicative to all other sources of critical damage',
    note: 'One shield. Doesn\'t scale with Strength.',
  },
  {
    id: 'warcry', ability: 'Warcry', name: 'Warcry', warframe: 'Valkyr', appliesTo: 'melee', scalesWithStrength: true,
    effects: [{ kind: 'attackSpeed', value: 0.5 }],
    defense: [{ kind: 'armorPercent', value: 0.5 }],
    quote: '50% Attack Speed. Attack Speed bonus is additive to mods. Armor: Base Armor × (1 + Armor Mods + Warcry Modifier × (1 + Strength Mods)), 50% at max rank, Valkyr and her allies',
    note: 'No subsumed armor value on the wiki, so a subsumed Warcry keeps the full 50%.',
    helminth: { effects: [{ kind: 'attackSpeed', value: 0.3 }], quote: "Subsumed Warcry's attack speed bonus is reduced to 9% / 12% / 15% / 30%." },
  },
  {
    id: 'wrathfulAdvance', condition: 'after a Wrathful Advance teleport', ability: 'Wrathful Advance', name: 'Wrathful Advance', warframe: 'Kullervo', appliesTo: 'melee', scalesWithStrength: true,
    effects: [{ kind: 'flatCritChance', value: 2 }],
    quote: '+200% melee critical chance, a "final" bonus applied after mods (25% becomes 225%)',
    helminth: { effects: [{ kind: 'flatCritChance', value: 1 }], quote: 'The melee critical chance bonus is reduced to 25% / 50% / 75% / 100%.' },
  },
  {
    id: 'nullStar', condition: 'all 12 Null Star particles up', ability: 'Null Star', name: 'Null Star (12 particles)', warframe: 'Nova', appliesTo: 'all', scalesWithStrength: true,
    effects: [],
    defense: [{ kind: 'damageReduction', perStack: 0.05, stacks: 12, cap: 0.9, helminthCap: 0.75, selfOnly: true }],
    quote: 'Strength 5% Damage Reduction per particle. Damage reduction is capped at 90%. Each active particle reduces damage to Nova\'s Health and Shields.',
    note: 'Assumes all 12 particles up. Subsumed cap is 75%.',
  },
  {
    id: 'elementalWardCold', ability: 'Elemental Ward', name: 'Elemental Ward (Cold)', warframe: 'Chroma', appliesTo: 'all', scalesWithStrength: true,
    effects: [],
    defense: [{ kind: 'armorPercent', value: 1.45 }],
    quote: 'Cold: Armor bonus of 25 / 70 / 90 / 145%. Every bonus scales with Ability Strength.',
    note: 'Cold element only. Treated as % of base armor, added in with armor mods.',
  },
  // ---- augments that add damage (their mod has to be equipped when it's your own frame) ----
  // the "Hold to cast" family, worded like Freeze Force, so the same mechanics (doesn't combine)
  {
    id: 'fireballFrenzy', ability: 'Fireball', augment: 'Fireball Frenzy', name: 'Fireball Frenzy (Fireball augment)', warframe: 'Ember', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'element', damageType: 'heat', value: 1, combines: false, boostsStatus: true }],
    quote: 'Hold to cast will grant all allies within 15m an additional 100% Heat Damage to their attacks for 40s.',
  },
  {
    id: 'shockTrooper', ability: 'Shock', augment: 'Shock Trooper', name: 'Shock Trooper (Shock augment)', warframe: 'Volt', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'element', damageType: 'electricity', value: 1, combines: false, boostsStatus: true, forcedProc: true }],
    quote: 'Hold to cast will grant all allies within 15m an additional 100% Electricity Damage to their attacks for 40s. This damage bonus does not combine with other elements, and is additive with elemental mods.',
    note: 'Guaranteed Electricity proc on every hit instead of a share of the status rolls (from you, the wiki page doesn\'t mention it).',
  },
  {
    id: 'smiteInfusion', ability: 'Smite', augment: 'Smite Infusion', name: 'Smite Infusion (Smite augment)', warframe: 'Oberon', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'element', damageType: 'radiation', value: 1, combines: false, boostsStatus: true }],
    quote: 'Hold to cast will grant all allies within 15m an additional 100% Radiation Damage to their attacks for 40s.',
  },
  {
    id: 'venomDose', ability: 'Spores', augment: 'Venom Dose', name: 'Venom Dose (Spores augment)', warframe: 'Saryn', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'element', damageType: 'corrosive', value: 1, combines: false, boostsStatus: true }],
    quote: 'Hold to cast will grant all allies within 15m an additional 100% Corrosive Damage to their attacks for 40s.',
  },
  // Thermal Transfer (wiki Thermal_Transfer): "Tap cast grants Cold damage. Hold cast grants Heat damage", both up at once
  // combine into Blast "equaling the sum of Cold and Heat damage". "Elemental Damage bonus scales with Ability Strength",
  // it "does not combine with modded elements" and is "additive with elemental mods"
  {
    id: 'thermalTransferHeat', ability: 'Thermal Sunder', augment: 'Thermal Transfer', variant: 'Heat (hold cast)', name: 'Thermal Transfer (Heat)', warframe: 'Gauss', appliesTo: 'all', scalesWithStrength: true,
    condition: 'Heat Thermal Sunder buff up (hold cast)',
    effects: [{ kind: 'element', damageType: 'heat', value: 0.75, combines: false, boostsStatus: true }],
    quote: 'Allies in range gain 75% bonus Elemental Damage for 30s. Hold cast grants Heat damage. The Heat bonus is additive with other Heat bonuses for status.',
  },
  {
    id: 'thermalTransferCold', ability: 'Thermal Sunder', augment: 'Thermal Transfer', variant: 'Cold (tap cast)', name: 'Thermal Transfer (Cold)', warframe: 'Gauss', appliesTo: 'all', scalesWithStrength: true,
    condition: 'Cold Thermal Sunder buff up (tap cast)',
    effects: [{ kind: 'element', damageType: 'cold', value: 0.75, combines: false, boostsStatus: true }],
    quote: 'Allies in range gain 75% bonus Elemental Damage for 30s. Tap cast grants Cold damage.',
  },
  {
    id: 'thermalTransferBlast', ability: 'Thermal Sunder', augment: 'Thermal Transfer', variant: 'Blast (both casts)', name: 'Thermal Transfer (Blast)', warframe: 'Gauss', appliesTo: 'all', scalesWithStrength: true,
    condition: 'both Heat and Cold Thermal Sunder buffs up',
    effects: [{ kind: 'element', damageType: 'blast', value: 1.5, combines: false }],
    quote: 'Both can be active at once and combine into a Blast buff "equaling the sum of Cold and Heat damage" (75% + 75%). Blast does not contribute to status damage.',
  },
  {
    id: 'bitingFrost', augment: 'Biting Frost', name: 'Biting Frost (passive augment)', warframe: 'Frost', appliesTo: 'all', scalesWithStrength: false, selfOnly: true,
    condition: 'target frozen',
    effects: [{ kind: 'critChanceMod', value: 2 }, { kind: 'critDamageMod', value: 1 }],
    quote: 'Frost gains +200% Critical Chance and +100% Critical Damage against frozen enemies.',
  },
  {
    id: 'empoweredQuiver', ability: 'Quiver', augment: 'Empowered Quiver', name: 'Empowered Quiver (Quiver augment)', warframe: 'Ivara', appliesTo: 'all', scalesWithStrength: true,
    condition: 'standing in a Dashwire',
    effects: [{ kind: 'critDamageMod', value: 1 }],
    quote: 'Dashwire grants allies 100% Critical Damage.',
  },
  {
    id: 'smokeShadow', ability: 'Smoke Screen', augment: 'Smoke Shadow', name: 'Smoke Shadow (Smoke Screen augment)', warframe: 'Ash', appliesTo: 'all', scalesWithStrength: true,
    condition: 'invisible from Smoke Screen',
    effects: [{ kind: 'critChanceMod', value: 1.5 }],
    quote: 'Conceals allies within 15m and grants 150% Critical Chance while invisible.',
  },
  {
    id: 'teemingVirulence', ability: 'Virulence', augment: 'Teeming Virulence', name: 'Teeming Virulence (Virulence augment)', warframe: 'Nidus', appliesTo: 'primary', scalesWithStrength: true, selfOnly: true,
    condition: 'Virulence hit 4 enemies in the last 15s',
    effects: [{ kind: 'critChanceMod', value: 2 }],
    quote: 'Hitting 4 enemies with Virulence grants 200% Primary Weapon Critical Chance for 15s.',
  },
  {
    id: 'thrallPact', ability: 'Enthrall', augment: 'Thrall Pact', name: 'Thrall Pact (Enthrall augment)', warframe: 'Revenant', appliesTo: 'primary', scalesWithStrength: false, selfOnly: true,
    condition: 'Thralls alive',
    stacks: { label: 'Thralls', max: 7, default: 3 },
    effects: [{ kind: 'baseDamage', value: 0.25 }],
    quote: 'Gain +25% Primary Weapon Damage for each active Thrall.',
    note: 'Treated like Serration (added in with damage mods). Thrall cap assumed 7.',
  },
  {
    id: 'excaliburPassive', condition: 'wielding a sword-type melee', name: 'Excalibur passive (swords)', warframe: 'Excalibur', appliesTo: 'melee', scalesWithStrength: false, selfOnly: true,
    effects: [{ kind: 'baseDamage', value: 0.1 }, { kind: 'attackSpeed', value: 0.1 }],
    quote: 'Excalibur deals 10% increased damage and attacks 10% faster when wielding swords.',
    note: 'Swords, Dual Swords, Nikanas and Rapiers only. The wiki doesn\'t say how it stacks, treated like mods.',
  },
]
export const abilitiesById = new Map(WARFRAME_ABILITIES.map((ability) => [ability.id, ability]))
// the modeled entries behind a frame's ability (Rhino's "Roar" -> roar, Gauss's "Thermal Sunder" -> 3 Thermal Transfer casts)
export const modeledVariants = (warframe: string, abilityName: string) =>
  WARFRAME_ABILITIES.filter((ability) => ability.warframe === warframe && ability.ability === abilityName)
export const modeledAbility = (warframe: string, abilityName: string, variantId?: string) => {
  const variants = modeledVariants(warframe, abilityName)
  return variants.find((ability) => ability.id === variantId) ?? variants[0]
}

// who cast it: you (your frame's own ability or passive), you via Helminth (subsumed), or an ally
export type CastBy = 'self' | 'helminth' | 'ally'
export interface AbilityCast {
  id: string
  by: CastBy
  stacks?: number // per-stack abilities (Thrall Pact)
}

// what the damage calc sees (src/calc/warframeStats.ts builds it from the Warframe panel)
export interface WarframeState {
  frameName: string // base name ("Frost" for Frost Prime)
  abilityStrength: number // 1 = 100%, for your abilities and your subsumed one
  teammateStrength: number // for allies' abilities
  armor: number // for Primary Bulwark
  casts: AbilityCast[]
  arcanes?: { arcaneId: string; rank: number; conditionalStacks: number }[] // the frame's arcanes, some buff weapons (Arcane Avenger)
  auraDamage?: { melee: number; rifle: number; sniper: number; pistol: number; shotgun: number }
  weakpointCritChance?: number
}

export const strengthFor = (cast: AbilityCast, state: WarframeState) =>
  cast.by === 'ally' ? state.teammateStrength : state.abilityStrength

export const abilityApplies = (ability: WarframeAbility, weaponCategory: string) =>
  ability.appliesTo === 'all' ||
  (ability.appliesTo === 'melee' && weaponCategory === 'Melee') ||
  (ability.appliesTo === 'guns' && weaponCategory !== 'Melee') ||
  (ability.appliesTo === 'primary' && weaponCategory === 'Primary')
// stacks a cast counts (Thrall Pact), 1 for everything else
export const castStacks = (ability: WarframeAbility, cast: AbilityCast) =>
  ability.stacks ? Math.max(0, Math.min(ability.stacks.max, cast.stacks ?? ability.stacks.default)) : 1

// does an ally casting it do anything for you? (Null Star only protects Nova)
export const helpsAllies = (ability: WarframeAbility) =>
  !ability.selfOnly && (ability.effects.length > 0 || (ability.defense ?? []).some((effect) => !effect.selfOnly))

// subsumed abilities use their Helminth numbers when the wiki gives different ones
export const effectsFor = (ability: WarframeAbility, by: CastBy) => (by === 'helminth' && ability.helminth ? ability.helminth.effects : ability.effects)

// the effect's value after Ability Strength
export const scaledValue = (ability: WarframeAbility, value: number, abilityStrength: number) =>
  ability.scalesWithStrength ? value * abilityStrength : value

// ---- Helminth ----
// which ability each Warframe gives the Helminth (from each frame's Abilities wiki page, "Subsumable to Helminth").
// frames I couldn't confirm are left out
export const SUBSUMABLE: Record<string, string> = {
  Ash: 'Shuriken', Atlas: 'Petrify', Banshee: 'Silence', Baruuk: 'Elude', Caliban: 'Sentient Wrath', Chroma: 'Elemental Ward',
  Dagath: 'Wyrd Scythes', Ember: 'Fire Blast', Equinox: 'Rest & Rage', Excalibur: 'Radial Blind', Frost: 'Freeze',
  Gara: 'Spectrorage', Garuda: 'Blood Altar', Gauss: 'Thermal Sunder', Grendel: 'Nourish', Gyre: 'Coil Horizon',
  Harrow: 'Condemn', Hildryn: 'Pillage', Hydroid: 'Tempest Barrage', Inaros: 'Sandstorm', Ivara: 'Quiver', Khora: 'Ensnare',
  Kullervo: 'Wrathful Advance', Lavos: 'Transmutation Probe', Limbo: 'Banish', Loki: 'Decoy', Mag: 'Pull',
  Mesa: 'Shooting Gallery', Mirage: 'Eclipse', Nekros: 'Terrify', Nezha: 'Fire Walker', Nidus: 'Larva', Nova: 'Null Star',
  Nyx: 'Mind Control', Oberon: 'Smite', Octavia: 'Resonator', Protea: 'Dispensary', Revenant: 'Reave', Rhino: 'Roar',
  Saryn: 'Molt', Sevagoth: 'Gloom', Styanax: 'Tharros Strike', Titania: 'Spellbind', Trinity: 'Energy Vampire',
  Valkyr: 'Warcry', Vauban: 'Tesla Nervos', Volt: 'Shock', Voruna: "Lycath's Hunt", Wisp: 'Breach Surge', Wukong: 'Defy',
  Xaku: "Xata's Whisper", Yareli: 'Aquablades', Zephyr: 'Airburst',
}

// damage buffs (Roar, Eclipse, Xata's Whisper) can only go on frames that already have one, replacing that one
// (Roar wiki: "When placed on Chroma, Cyte-09, Mirage, ... Subsumed Roar can only replace Vex Armor, Resupply, Eclipse ...")
export const RESTRICTED_SUBSUMES = new Set(['Roar', 'Eclipse', "Xata's Whisper"])
export const DAMAGE_BUFF_SLOT: Record<string, string> = {
  Chroma: 'Vex Armor', 'Cyte-09': 'Resupply', Mirage: 'Eclipse', Octavia: 'Amp', Oraxia: 'Silken Stride', Rhino: 'Roar',
  Temple: "Ripper's Wail", Xaku: "Xata's Whisper", Uriel: 'Demonium',
}

// can this subsumed ability go into that slot of that frame?
export function canSubsumeInto(frameName: string, slotAbility: string, subsumed: string) {
  if (!RESTRICTED_SUBSUMES.has(subsumed)) return true
  return DAMAGE_BUFF_SLOT[frameName] === slotAbility
}
