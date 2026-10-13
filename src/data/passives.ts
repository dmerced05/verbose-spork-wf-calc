// weapon passives that change damage. the data export only has these as flavor text in the description, so this
// table is hand-kept from the wiki (quotes are from each weapon's wiki page). "rough" on purpose: chance-based
// effects become expected values and timed buffs become an on/off (or stack count) the user picks.
// to add one: find the weapon's wiki page, quote the line, pick the closest effect kind below.
import type { ModEffect } from '../calc/parseMod'

export type PassiveEffect =
  | { kind: 'mod'; effect: ModEffect } // goes in with the mods, per stack
  | { kind: 'flat'; stat: 'critChance' | 'statusChance'; value: number } // added after mods, per stack
  | { kind: 'flatPerStatusType'; stat: 'critChance'; value: number } // after mods, x status types on the target
  | { kind: 'damagePerStatusType'; value: number } // additive with damage mods, x status types on the target
  | { kind: 'finalCritMultiplier'; value: number } // added to the final crit multiplier, per stack
  | { kind: 'statusDuration'; value: number; types?: string[] } // more DoT ticks, per stack
  | { kind: 'nextHitCritOverride'; chance: number; critChance: number } // after a status proc, chance the next hit's crit chance is set
  | { kind: 'nextHitStatusOverride'; chance: number; statusChance: number } // after a crit, chance the next hit's status chance is set
  | { kind: 'fireRateMultiplier'; value: number } // multiplies with attack speed mods instead of adding, per stack
  | { kind: 'reloadTime'; seconds: number } // replaces the reload time
  | { kind: 'heavyDetonatesDots' } // Harmony
  | { kind: 'base'; stat: 'critChance' | 'statusChance'; value: number } // added to the weapon's base stat, before mods
  | { kind: 'separateElement'; damageType: string; value: number } // element that doesn't combine (Tonkkatt), per stack
  | { kind: 'magazineMultiplier'; value: number } // x magazine size

export interface WeaponPassive {
  name: string
  weapons: string[]
  attacks?: RegExp // which of the weapon's attacks it applies to (default: all of them)
  quote: string // from the weapon's wiki page
  effects: PassiveEffect[]
  condition?: string // shown on the toggle. no condition = always on
  maxStacks?: number // default 1
  scenarioStacks?: number // what the leaderboard assumes, default maxStacks
  note?: string // how rough the model is
}

const damagePerStack = (value: number): ModEffect => ({ kind: 'stat', stat: 'damage', value })

export const PASSIVES: WeaponPassive[] = [
  {
    name: 'Harmony: Heavy Attack detonation',
    weapons: ['Harmony'],
    attacks: /^heavy attack$/i,
    quote: 'Enemies hit by Heavy Attacks while debuffed with active Slash, Heat, Toxin, Electricity, and Gas Status Effects will instantly receive the full damage from all damage ticks of the procs',
    effects: [{ kind: 'heavyDetonatesDots' }],
    note: 'Each detonated proc deals all its ticks at once (status duration adds ticks). Stacks already on the target come from the Debuffs panel and are counted at Normal Attack strength.',
  },
  {
    name: 'Harmonic Resonance',
    weapons: ['Harmony'],
    quote: 'Heavy Attack kills grant Harmonic Resonance, increasing Status Duration by 30% for 30 seconds',
    effects: [{ kind: 'statusDuration', value: 0.3 }],
    condition: 'After a Heavy Attack kill (2 = Jade\'s Ensemble, 60%)',
    maxStacks: 2,
    scenarioStacks: 1,
  },
  {
    name: 'Cedo: damage per status type',
    weapons: ['Cedo'],
    attacks: /^(normal attack|alt-fire glaive)$/i, // wiki: not on the glaive's explosions
    quote: 'Deals +60% bonus damage per unique status effect on target.',
    effects: [{ kind: 'damagePerStatusType', value: 0.6 }],
    note: 'Added in with damage mods (the wiki says the alt-fire glaive multiplies instead, treated the same here).',
  },
  {
    name: 'Galariak Prime: crit per status type',
    weapons: ['Galariak Prime'],
    quote: 'Gains a flat +10% Critical Chance bonus per unique Status Effect type on the target hit.',
    effects: [{ kind: 'flatPerStatusType', stat: 'critChance', value: 0.1 }],
  },
  {
    name: 'Gotva Prime: Super Critical',
    weapons: ['Gotva Prime'],
    quote: 'Status Effects have a 15% chance to set the next hit\'s Critical Chance to 300%.',
    effects: [{ kind: 'nextHitCritOverride', chance: 0.15, critChance: 3 }],
    note: 'Expected value: (chance the last hit procced) x 15% of hits are red crits.',
  },
  {
    name: 'Sagek Prime: status on crit',
    weapons: ['Sagek Prime'],
    quote: 'Critical Hits have a 6% chance to set the next shot\'s Status Chance to 500%.',
    effects: [{ kind: 'nextHitStatusOverride', chance: 0.06, statusChance: 5 }],
    note: 'Expected value: (chance the last hit crit) x 6% of shots get 5 procs.',
  },
  {
    name: 'Buzlok: marked target',
    weapons: ['Buzlok'],
    quote: 'Absolute 50% critical chance occurs after mods.',
    effects: [{ kind: 'flat', stat: 'critChance', value: 0.5 }],
    condition: 'Target marked by the Beacon',
  },
  {
    name: 'AX-52: aimed headshots',
    weapons: ['Ax-52'],
    quote: 'When aiming, headshots have a high Critical Chance. (+400%, Stacked Multiply since Hotfix 36.0.8)',
    effects: [{ kind: 'mod', effect: { kind: 'stat', stat: 'weakpointCritChance', value: 4 } }],
    condition: 'Aiming (only counts on headshots)',
  },
  {
    name: 'Arca Scisco: Target Analysis',
    weapons: ['Arca Scisco'],
    quote: 'increasing critical chance and status chance by 4% flat, stacking up to five times for 20%',
    effects: [{ kind: 'flat', stat: 'critChance', value: 0.04 }, { kind: 'flat', stat: 'statusChance', value: 0.04 }],
    condition: 'Consecutive hits (2s per stack)',
    maxStacks: 5,
  },
  {
    name: 'Vesper 77: aim',
    weapons: ['Vesper 77'],
    quote: 'Aiming grants +40% Critical Damage.',
    effects: [{ kind: 'mod', effect: { kind: 'stat', stat: 'critDamage', value: 0.4 } }],
    condition: 'Aiming',
    note: 'The wiki doesn\'t say how it stacks, treated like a crit damage mod.',
  },
  {
    name: 'Knell: Death Knell',
    weapons: ['Knell'],
    quote: 'increases final critical multiplier by +0.5x (per stack, up to 3). Status chance also rises by +20%.',
    effects: [{ kind: 'finalCritMultiplier', value: 0.5 }, { kind: 'flat', stat: 'statusChance', value: 0.2 }],
    condition: 'After weak point hits (2s per stack)',
    maxStacks: 3,
    scenarioStacks: 0, // leaderboard is body shots
    note: 'Also infinite ammo while active, not modeled.',
  },
  {
    name: 'Sporothrix: scoped headshots',
    weapons: ['Sporothrix', 'Coda Sporothrix'],
    quote: 'Scoped headshots increase lethality. (+50% headshot damage while zoomed)',
    effects: [{ kind: 'mod', effect: { kind: 'stat', stat: 'headshotMultiplier', value: 0.5 } }],
    condition: 'Scoped in (only counts on headshots)',
  },
  {
    name: 'Reconifex: perfect reload',
    weapons: ['Reconifex'],
    quote: 'grant the current magazine Heat rounds that inflict 25% more damage with guaranteed status. (reload drops to 1 second)',
    effects: [{ kind: 'mod', effect: { kind: 'damageMultiplier', value: 0.25 } }, { kind: 'reloadTime', seconds: 1 }],
    condition: 'Timed reloads',
    note: 'The extra Heat hit is treated as +25% damage, its guaranteed Heat proc isn\'t added.',
  },
  {
    name: 'Ekhein: Heavy Insight',
    weapons: ['Ekhein'],
    quote: 'Landing a Heavy Attack grants the Heavy Insight buff for 8 seconds, increasing Damage by 80% and Attack Speed by 20%.',
    effects: [{ kind: 'mod', effect: damagePerStack(0.8) }, { kind: 'mod', effect: { kind: 'stat', stat: 'fireRate', value: 0.2 } }],
    condition: 'Within 8s of a Heavy Attack',
  },
  {
    name: 'Lesion: Frenzy',
    weapons: ['Lesion'],
    quote: 'Applying a status effect grants the Frenzy buff. (+15% Attack Speed, multiplicative, and +100% Toxin for 6s)',
    effects: [{ kind: 'fireRateMultiplier', value: 0.15 }, { kind: 'mod', effect: { kind: 'damageType', damageType: 'toxin', value: 1 } }],
    condition: 'After a status proc',
  },
  {
    name: 'Pennant: heavy kill speed',
    weapons: ['Pennant'],
    quote: 'Heavy Attack kills increases the weapon\'s attack speed by 50% for 2 to 46 seconds',
    effects: [{ kind: 'mod', effect: { kind: 'stat', stat: 'fireRate', value: 0.5 } }],
    condition: 'Heavy Attack kills (stacks, each lasts 2s + 4s per combo step)',
    maxStacks: 5,
    scenarioStacks: 1,
    note: 'No stack cap on the wiki, I stop the stepper at 5.',
  },
  {
    name: 'Slaytra: long Bleed',
    weapons: ['Slaytra'],
    quote: 'Slaytra\'s Slash procs last twice as long as normal. (Innate +100% Slash proc duration)',
    effects: [{ kind: 'statusDuration', value: 1, types: ['slash'] }],
    note: 'Assumes one tick per second, so 12 Bleed ticks.',
  },
  {
    name: 'Dorrclave: Rising Vendetta',
    weapons: ['Dorrclave'],
    quote: 'a flat +100% Status Chance after mods for the next 10 attacks.',
    effects: [{ kind: 'flat', stat: 'statusChance', value: 1 }],
    condition: 'After 10 kills or assists (next 10 hits)',
    note: 'On-kill buff, so the leaderboard has it on like other on-kill conditionals.',
  },
  {
    name: 'Tonkkatt: overheat',
    weapons: ['Tonkkatt'],
    quote: 'Building the Combo Multiplier overheats the Tonkkatts, setting enemies ablaze. (+4% Heat per stack, 30 stacks for +120%, doesn\'t combine)',
    effects: [{ kind: 'separateElement', damageType: 'heat', value: 0.04 }],
    condition: 'Overheat stacks (one per combo multiplier increase, 15s)',
    maxStacks: 30,
    scenarioStacks: 11,
    note: 'The leaderboard assumes 11 stacks, one per step up to 12x. The wiki doesn\'t say how you reach 30.',
  },
  {
    name: 'Pyrana Prime: ethereal Pyrana',
    weapons: ['Pyrana Prime'],
    quote: '3 kills each within 2 seconds of the previous kill summons a second Pyrana Prime for 6 seconds. (x2 magazine, x1.4 fire rate)',
    effects: [{ kind: 'fireRateMultiplier', value: 0.4 }, { kind: 'magazineMultiplier', value: 2 }],
    condition: 'Second Pyrana up',
  },
  {
    name: 'Tekko: Atlas',
    weapons: ['Tekko'],
    quote: 'gaining an additional 6% base Status Chance, for a total of 16%',
    effects: [{ kind: 'base', stat: 'statusChance', value: 0.06 }],
    condition: 'Wielded by Atlas',
    scenarioStacks: 0, // the leaderboard isn't Warframe-specific
  },
  {
    name: 'Alternox: Gyre',
    weapons: ['Alternox'],
    quote: 'When wielded by Gyre, this weapon gains a 20% multishot increase, additive with other multishot mods.',
    effects: [{ kind: 'mod', effect: { kind: 'stat', stat: 'multishot', value: 0.2 } }],
    condition: 'Wielded by Gyre',
    scenarioStacks: 0,
  },
  {
    name: 'Epitaph: Sevagoth',
    weapons: ['Epitaph'],
    quote: 'Deals +20% headshot damage when wielded by Sevagoth/Sevagoth Prime.',
    effects: [{ kind: 'mod', effect: { kind: 'stat', stat: 'headshotMultiplier', value: 0.2 } }],
    condition: 'Wielded by Sevagoth (headshots only)',
    scenarioStacks: 0,
  },
  {
    name: 'Dual Coda Torxica: spores',
    weapons: ['Dual Coda Torxica'],
    quote: '50% Damage Vulnerability lasting for 20 seconds. (only to the Dual Coda Torxica\'s damage)',
    effects: [{ kind: 'mod', effect: { kind: 'damageMultiplier', value: 0.5 } }],
    condition: 'Target has a spore',
    note: 'The guaranteed Cold procs from the spore aren\'t added.',
  },
]

export const passivesFor = (weaponName: string) => PASSIVES.filter((passive) => passive.weapons.includes(weaponName))

// ---- Kuva / Tenet / Coda bonus element ----
// adversary weapons roll a bonus element worth 25-60% of base damage (Valence Fusion caps it at 60%)
export const BONUS_ELEMENTS = ['heat', 'cold', 'electricity', 'toxin', 'impact', 'magnetic', 'radiation']
export const BONUS_ELEMENT_RANGE = { min: 0.25, max: 0.6 }
export const hasBonusElement = (weaponName: string) => /^(Kuva|Tenet|Coda|Dual Coda) /.test(weaponName)

export interface BonusElement {
  damageType: string
  value: number // fraction of base damage
}
