// popular Warframe abilities / passives that buff weapons. numbers are max rank from each ability's wiki page,
// scaled by Ability Strength when the page says so (I assume linear, value x strength).
// each effect kind maps onto how the wiki says it stacks:
//  - factionDamage: Roar, additive with banes, counts twice on status ticks
//  - damageMultiplier: Eclipse, its own multiplier (not multiplied into additive Condition Overload)
//  - baseDamage: Vex Armor's Fury, Excalibur's passive, added in with Serration
//  - element: Nourish's Viral works like an elemental mod. Freeze Force / Electric Shield add an element that doesn't combine
//  - extraHit: Xata's Whisper, a separate Void hit worth X% of the weapon's damage (mods, crit and faction x2 apply)
//  - attackSpeed / flatCritChance / critDamageMultiplier: Warcry, Wrathful Advance, Electric Shield

export type AbilityEffect =
  | { kind: 'factionDamage'; value: number }
  | { kind: 'damageMultiplier'; value: number }
  | { kind: 'baseDamage'; value: number }
  | { kind: 'element'; damageType: string; value: number; combines: boolean }
  | { kind: 'extraHit'; damageType: string; value: number }
  | { kind: 'attackSpeed'; value: number }
  | { kind: 'flatCritChance'; value: number }
  | { kind: 'critDamageMultiplier'; value: number }

export interface WarframeAbility {
  id: string
  selfOnly?: boolean // a passive: only when you're playing that Warframe, a teammate can't give it to you
  name: string
  warframe: string
  appliesTo: 'all' | 'melee' | 'guns'
  scalesWithStrength: boolean
  effects: AbilityEffect[]
  quote: string // from the ability's wiki page
  note?: string
}

export const WARFRAME_ABILITIES: WarframeAbility[] = [
  {
    id: 'roar', name: 'Roar', warframe: 'Rhino', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'factionDamage', value: 0.5 }],
    quote: '+50% damage, additive with other sources of Faction Damage, and multiplicative with other types of bonus damage',
  },
  {
    id: 'eclipse', name: 'Solar Eclipse', warframe: 'Mirage', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'damageMultiplier', value: 2 }],
    quote: '+200% weapon damage. The damage buff is an unique multiplier.',
    note: 'Assumes full light.',
  },
  {
    id: 'vexArmor', name: 'Vex Armor (Fury, maxed)', warframe: 'Chroma', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'baseDamage', value: 2.75 }],
    quote: '275% Fury max damage bonus, additive to base damage mods like Serration',
  },
  {
    id: 'xatasWhisper', name: "Xata's Whisper", warframe: 'Xaku', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'extraHit', damageType: 'void', value: 0.26 }],
    quote: '26% of total weapon damage as Void damage. Damage bonus is a separate damage instance.',
    note: 'Its own Void procs aren\'t modeled.',
  },
  {
    id: 'nourish', name: 'Nourish', warframe: 'Grendel', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'element', damageType: 'viral', value: 0.75, combines: true }],
    quote: 'Think of it like adding a +75% Viral mod to your weapons (which is buffed by Ability Strength)',
  },
  {
    id: 'freezeForce', name: 'Freeze Force (Freeze augment)', warframe: 'Frost', appliesTo: 'all', scalesWithStrength: true,
    effects: [{ kind: 'element', damageType: 'cold', value: 1, combines: false }],
    quote: 'an additional 100% Cold Damage to their attacks. This damage bonus does not combine with other elements',
  },
  {
    id: 'electricShield', name: 'Electric Shield (shooting through)', warframe: 'Volt', appliesTo: 'guns', scalesWithStrength: false,
    effects: [{ kind: 'element', damageType: 'electricity', value: 0.5, combines: false }, { kind: 'critDamageMultiplier', value: 1 }],
    quote: '+50% Electricity Damage and +100% Critical Damage, multiplicative to all other sources of critical damage',
    note: 'One shield. Doesn\'t scale with Strength.',
  },
  {
    id: 'warcry', name: 'Warcry', warframe: 'Valkyr', appliesTo: 'melee', scalesWithStrength: true,
    effects: [{ kind: 'attackSpeed', value: 0.5 }],
    quote: '50% Attack Speed. Attack Speed bonus is additive to mods.',
  },
  {
    id: 'wrathfulAdvance', name: 'Wrathful Advance', warframe: 'Kullervo', appliesTo: 'melee', scalesWithStrength: true,
    effects: [{ kind: 'flatCritChance', value: 2 }],
    quote: '+200% melee critical chance, a "final" bonus applied after mods (25% becomes 225%)',
  },
  {
    id: 'excaliburPassive', name: 'Excalibur passive (swords)', warframe: 'Excalibur', appliesTo: 'melee', scalesWithStrength: false, selfOnly: true,
    effects: [{ kind: 'baseDamage', value: 0.1 }, { kind: 'attackSpeed', value: 0.1 }],
    quote: 'Excalibur deals 10% increased damage and attacks 10% faster when wielding swords.',
    note: 'Swords, Dual Swords, Nikanas and Rapiers only. The wiki doesn\'t say how it stacks, treated like mods.',
  },
]

// what the damage calc sees (src/calc/warframeStats.ts builds it from the Warframe panel)
export interface WarframeState {
  frameName: string // base name ("Frost" for Frost Prime): its abilities use abilityStrength, everyone else's teammateStrength
  abilityStrength: number // 1 = 100%
  teammateStrength: number
  armor: number // for Primary Bulwark
  abilities: Record<string, boolean>
  auraDamage?: { melee: number; rifle: number; sniper: number; pistol: number; shotgun: number }
  weakpointCritChance?: number
}

// which strength an ability uses: yours if it's your Warframe's, otherwise the teammate's
export const strengthFor = (ability: WarframeAbility, state: WarframeState) =>
  ability.warframe === state.frameName ? state.abilityStrength : state.teammateStrength

export const abilityApplies = (ability: WarframeAbility, isMelee: boolean) =>
  ability.appliesTo === 'all' || (ability.appliesTo === 'melee') === isMelee

// the effect's value after Ability Strength
export const scaledValue = (ability: WarframeAbility, value: number, abilityStrength: number) =>
  ability.scalesWithStrength ? value * abilityStrength : value
