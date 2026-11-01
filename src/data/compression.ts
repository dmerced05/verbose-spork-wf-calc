// Primary Compression (arcane): "On aim: x0.2 explosion radius, +100% damage ... for every 1m radius lost". the radius
// a fire mode loses isn't in the weapon data, so this is the wiki's table (Primary_Compression, Oct 2026): the max damage
// bonus at base radius and rank 5, and whether it multiplies with damage mods or adds to them. Firestorm / Primed Firestorm
// grow the radius, so the bonus grows with them (wiki: 320% -> 460.8% with Primed Firestorm's +44%)
// fire modes the wiki marks "Doesn't Work" (Kuva Bramma's bomblets, Torid's Incarnon, Ignis...) just aren't listed.
// shotguns can't equip it at all

export interface CompressionMode {
  attacks: string[] // every attack of that fire mode (direct and AoE parts both get the bonus)
  add?: number // rank 5 bonus at base radius, additive with Serration-style damage mods
  multiply?: number // rank 5 bonus at base radius, its own multiplier
  noFirestorm?: boolean // "Primary Fire AoE not affected by Firestorm"
  note?: string
}

const INCARNON = (aoe = 'Incarnon Form AoE') => ['Incarnon Form', aoe]
const ROCKET = ['Rocket Impact', 'Rocket Explosion']
const GRENADE = ['Grenade Impact', 'Grenade Explosion']
const PENTA = [{ attacks: ['Grenade Impact', 'Grenade Detonation'], multiply: 3.2 }]
const BRATON = [{ attacks: INCARNON(), add: 2.4 }]
const LATRON = [{ attacks: INCARNON(), multiply: 3.2 }]
const GORGON = [{ attacks: INCARNON(), multiply: 4 }]
const BURSTON = [{ attacks: INCARNON('Incarnon Form Radial Attack'), add: 1.6 }]
const ARTEMIS = [{ attacks: ['Concentrated Arrow Uncharged Shot', 'Concentrated Arrow Uncharged Headshot Explosion', 'Concentrated Arrow Charged Shot'], multiply: 5.6 }]
const LENZ = [{ attacks: ['Charged Shot', 'Initial Blast', 'Bubble Collapse'], multiply: 5.75 }]
const QUANTA = [{ attacks: ['Cube (direct hit)', 'Cube Explosion', 'Cube (shot by player)'], multiply: 0.4, note: 'always uses the 0.5 m bonk radius' }]
const SIMULOR = [{ attacks: ['Orb Launch', 'Orb Merging Damage', 'Orb Explosion'], multiply: 4, note: 'full bonus with 1 orb per shot, less with multishot (83% at 2, 71% at 3)' }]
const TRUMNA = [
  { attacks: ['Auto', 'Auto AoE'], add: 1.28, noFirestorm: true },
  // "Alt-Fire gains the damage % bonus from primary fire's radius and a unique multiplier from alt-fire's radius"
  { attacks: ['Grenade Impact', 'Grenade Bounce AoE'], add: 1.28, multiply: 4.8 },
]
const VECTIS = [{
  attacks: ['Incarnon Form', 'Incarnon Form Embed AoE', 'Incarnon Form Embed Ticks', 'Incarnon Form Headshot AoE'], multiply: 0.08,
  note: 'uses the 0.1 m embed radius, not the 6.7 m headshot explosion',
}]

export const COMPRESSION: Record<string, CompressionMode[]> = {
  Acceltra: [{ attacks: ROCKET, multiply: 3.2 }],
  'Acceltra Prime': [{ attacks: ROCKET, multiply: 4 }],
  Aeolak: [{ attacks: ['Alt-Fire', 'Alt-Fire Explosion'], multiply: 5.6 }],
  Afentis: [{ attacks: ['Semi', 'Radial Attack'], multiply: 2.4 }],
  'Afentis Prime': [{ attacks: ['Semi', 'Radial Attack'], multiply: 4.4 }],
  // "Pulse radius is not reduced, damage bonus is granted based off alt-fire radius"
  Alternox: [{ attacks: ['Alt-Fire Contact', 'Alt-Fire Explosion', 'Alt-Fire Damage over Time'], multiply: 4.8 }],
  'Alternox Prime': [{ attacks: ['Alt-Fire Contact', 'Alt-Fire Explosion', 'Alt-Fire Damage over Time'], multiply: 4.8 }],
  Ambassador: [{ attacks: ['Charge', 'Charged AoE'], add: 4.8 }],
  'Artemis Bow': ARTEMIS, 'Artemis Bow Prime': ARTEMIS,
  'Proboscis Cernos': [{ attacks: ['Charged Shot', 'Charged Shot Explosion'], multiply: 5.6, note: 'not the tendril ticks' }],
  Evensong: [{ attacks: ['Charged Shot', 'Charged Radial Attack'], multiply: 3.2 }],
  Lenz: LENZ, 'Prisma Lenz': LENZ,
  'Kuva Bramma': [{ attacks: ['Charged Shot', 'Radial Attack'], multiply: 6.64 }],
  Basmu: [{ attacks: ['Auto', 'Radial Attack'], multiply: 1.36 }],
  Battacor: [{ attacks: ['Secondary Fire', 'Secondary Fire AoE'], add: 2.08 }],
  Braton: BRATON, 'Braton Prime': BRATON, 'Braton Vandal': BRATON, 'Mk1-Braton': BRATON,
  Burston: BURSTON, 'Burston Prime': BURSTON,
  Gorgon: GORGON, 'Prisma Gorgon': GORGON, 'Gorgon Wraith': GORGON,
  Latron: LATRON, 'Latron Prime': LATRON, 'Latron Wraith': LATRON,
  Miter: [{ attacks: ['Charged Shot'], multiply: 0.16 }, { attacks: INCARNON('Incarnon Form Radial Attack'), multiply: 2.4 }],
  Vectis: VECTIS, 'Vectis Prime': VECTIS,
  'Kuva Chakkhurr': [{ attacks: ['Normal Attack', 'Explosion'], multiply: 2.32 }],
  'Tenet Envoy': [{ attacks: ['Grenade Impact', 'Rocket Explosion'], multiply: 6.4 }],
  Ferrox: [{ attacks: ['Charged Shot', 'Radial Attack'], add: 2.88 }],
  'Tenet Ferrox': [{ attacks: ['Charged Shot', 'Radial Attack'], add: 3.2 }],
  Javlok: [
    { attacks: ['Projectile Impact', 'Projectile Explosion'], multiply: 1.92 },
    { attacks: ['Spear Throw Impact', 'Spear Throw Explosion'], multiply: 4.8 },
  ],
  Ogris: [{ attacks: ROCKET, multiply: 5.68, note: 'Nightwatch Napalm gets no bonus' }],
  'Kuva Ogris': [{ attacks: ROCKET, multiply: 6.32, note: 'Nightwatch Napalm gets no bonus' }],
  Opticor: [{ attacks: ['Charged Shot', 'Charged Shot AoE', 'Quick Shot', 'Quick Shot AoE'], add: 4.8 }],
  'Opticor Vandal': [{ attacks: ['Charged Shot', 'Charged Shot AoE', 'Quick Shot', 'Quick Shot AoE'], add: 3.68 }],
  'Panthera Prime': [{ attacks: ['Normal Attack', 'Radial Attack'], multiply: 1.28 }],
  Penta: PENTA, 'Secura Penta': PENTA, 'Carmine Penta': PENTA,
  Quanta: QUANTA, 'Quanta Vandal': QUANTA, 'Tenet Quanta': QUANTA,
  'Mutalist Quanta': [{ attacks: ['Infested Orb', 'Orb Explosion'], multiply: 3.52 }],
  Scourge: [
    { attacks: ['Projectile Impact', 'Explosion'], multiply: 1.36 },
    { attacks: ['Spear Throw Impact', 'Spear Throw Explosion'], multiply: 5.6 },
  ],
  'Scourge Prime': [
    { attacks: ['Projectile Impact', 'Explosion'], multiply: 1.36 },
    { attacks: ['Spear Throw', 'Spear Explosion'], multiply: 5.6 },
  ],
  Shedu: [{ attacks: ['Normal Attack', 'Radial Attack'], multiply: 5.28, noFirestorm: true }],
  Simulor: SIMULOR, 'Synoid Simulor': SIMULOR,
  Sporothrix: [{ attacks: ['Normal Attack', 'AoE'], multiply: 1.36, note: 'ignores Volatile Variant\'s +4 m' }],
  'Coda Sporothrix': [{ attacks: ['Normal Attack', 'AoE'], multiply: 1.6, note: 'ignores Volatile Variant\'s +4 m' }],
  'Tenet Tetra': [{ attacks: ['Grenade Impact', 'Grenade AoE'], multiply: 6.4 }],
  Tonkor: [{ attacks: GRENADE, multiply: 5.6 }],
  'Kuva Tonkor': [{ attacks: GRENADE, multiply: 5.6 }],
  // "Cloud radius is not reduced" but the cloud gets the bonus off its 3 m
  Torid: [{ attacks: ['Grenade Impact', 'Poison Cloud'], multiply: 2.4 }],
  Trumna: TRUMNA, 'Trumna Prime': TRUMNA,
  Zarr: [{ attacks: ['Cannon Mode Projectile', 'Cannon Mode Explosion'], multiply: 3.92 }],
  'Kuva Zarr': [{ attacks: ['Cannon Mode Projectile', 'Cannon Mode Explosion'], multiply: 5.6 }],
  'Zhuge Prime': [{ attacks: ['Arrow Impact', 'Arrow Explosion'], multiply: 2.08 }],
}

export const compressionFor = (weaponName: string, attackName: string) =>
  COMPRESSION[weaponName]?.find((mode) => mode.attacks.includes(attackName)) ?? null
