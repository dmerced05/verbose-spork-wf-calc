// heavy attacks hit by hit. the export only has one heavyAttackDamage number per weapon and it isn't consistent
// (Heavy Scythes list every hit added up, Assault Saws only the first part, Daggers/Tonfas neither), so for the
// classes that hit more than once I use the per-hit "Stanceless Combos" Heavy row from each class's wiki page,
// plus per-weapon arsenal readings where they disagree with the wiki (they win).
// - the leaderboard's single damage instance = the biggest hit
// - "full heavy" = every hit added up (all at the current combo, forced procs listed but not scored)
// classes not listed here hit once, their heavy stays the export's number

export interface HeavyHit {
  multiplier: number // x base damage
  procs?: string[] // forced procs on that hit (Slash = Bleed)
  radial?: boolean // AoE part (Sparring's slam), can't headshot
}

export interface HeavyCombo {
  className: string
  source: string
  hits: HeavyHit[]
}

interface HeavyClass extends HeavyCombo {
  weapons: string[]
}

const hits = (count: number, multiplier: number, procs?: string[]): HeavyHit[] =>
  Array.from({ length: count }, () => ({ multiplier, ...(procs ? { procs } : {}) }))

export const MULTI_HIT_HEAVIES: HeavyClass[] = [
  {
    className: 'Heavy Scythe',
    source: 'wiki Heavy_Scythe (Titan Cull)',
    weapons: ['Corufell', 'Corufell Prime', 'Hespar', 'Pride', 'Thalys', 'Wrath'],
    hits: [
      { multiplier: 2, procs: ['Impact'] }, { multiplier: 2, procs: ['Slash'] }, { multiplier: 2, procs: ['Knockdown'] },
      ...hits(2, 6, ['Ragdoll']),
    ],
  },
  {
    className: 'Assault Saw',
    source: 'wiki Assault_Saw (Carving Carcass)',
    weapons: ['Ghoulsaw', 'Kuva Ghoulsaw'],
    hits: [...hits(3, 1), ...hits(2, 1, ['Slash']), { multiplier: 1, procs: ['Slash', 'Knockdown'] }, { multiplier: 6, procs: ['Ragdoll'] }],
  },
  {
    className: 'Blade and Whip',
    source: 'wiki Blade_and_Whip (Rolling Thunder)',
    weapons: ['Ceti Lacera', 'Dorrclave', 'Jat Kusar', 'Lacera', 'Mios'],
    hits: [{ multiplier: 4, procs: ['Ragdoll'] }, { multiplier: 4, procs: ['Lifted'] }, { multiplier: 4, procs: ['Ragdoll'] }, { multiplier: 4 }],
  },
  {
    className: 'Dagger',
    source: 'wiki Dagger (Butterfly Slash)',
    weapons: ['Ceramic Dagger', 'Dark Dagger', 'Heat Dagger', 'Innodem', 'Karyst', 'Karyst Prime', 'Rakta Dark Dagger', 'Rumblejack', 'Sheev'],
    hits: [
      { multiplier: 2.5, procs: ['Impact', 'Slash'] }, { multiplier: 2.5, procs: ['Stagger'] },
      { multiplier: 2.5, procs: ['Impact', 'Slash'] }, { multiplier: 2.5, procs: ['Knockdown'] },
    ],
  },
  {
    className: 'Dual Daggers',
    source: 'wiki Dual_Daggers (Savage Tiger)',
    weapons: ['Ether Daggers', 'Fang', 'Fang Prime', 'Nepheri', 'Okina', 'Okina Prime'],
    hits: hits(4, 2.5, ['Slash', 'Knockdown']),
  },
  {
    className: 'Dual Nikanas',
    source: 'wiki Dual_Nikanas (Dax Retribution)',
    weapons: ['Sun & Moon'],
    hits: [
      { multiplier: 2, procs: ['Slash'] }, { multiplier: 2, procs: ['Impact'] }, { multiplier: 2, procs: ['Knockdown'] }, { multiplier: 6 },
      { multiplier: 1, procs: ['Lifted'] }, { multiplier: 2, procs: ['Slash'] }, { multiplier: 3 },
    ],
  },
  {
    className: 'Dual Swords',
    source: 'wiki Heavy_Attack table (5x = 250% + 250%, twice)',
    weapons: [
      'Dark Split-Sword', 'Dex Dakra', 'Dual Cleavers', 'Dual Ether', 'Dual Heat Swords', 'Dual Ichor', 'Dual Kamas', 'Dual Kamas Prime',
      'Dual Keres', 'Dual Keres Prime', 'Dual Raza', 'Dual Skana', 'Dual Viciss', 'Dual Zoren', 'Dual Zoren Prime', 'Nami Skyla',
      'Nami Skyla Prime', 'Prisma Dual Cleavers', 'Twin Basolk', 'Twin Krohkur',
    ],
    hits: hits(4, 2.5),
  },
  {
    className: 'Machete',
    source: 'wiki Heavy_Attack table (150% Bleed + 3 x 150%, then 500%)',
    weapons: ['Machete', 'Machete Wraith', 'Prisma Machete'],
    hits: [{ multiplier: 1.5, procs: ['Slash'] }, ...hits(3, 1.5), { multiplier: 5 }],
  },
  {
    className: 'Sparring',
    source: 'wiki Sparring (Rising from Ashes)',
    weapons: ['Hirudo', 'Kogake', 'Kogake Prime', 'Korrudo', 'Obex', 'Prisma Obex'],
    hits: [{ multiplier: 5 }, { multiplier: 4, procs: ['Lifted'], radial: true }, ...hits(4, 1)],
  },
  {
    className: 'Tonfa',
    source: 'wiki Tonfa (Discord Sewn)',
    weapons: ['Boltace', 'Kronen', 'Kronen Prime', 'Ohma', 'Praedos', 'Prisma Ohma', 'Telos Boltace', 'Tonkkatt'],
    hits: hits(4, 2.5, ['Slash', 'Knockdown']),
  },
  {
    className: 'Two-Handed Nikana',
    source: 'wiki Two-Handed_Nikana (Lover\'s Farewell)',
    weapons: ['Azothane', 'Pennant', 'Tatsu', 'Tatsu Prime', 'Tenet Livia'],
    hits: [{ multiplier: 6, procs: ['Slash', 'Lifted'] }, { multiplier: 3, procs: ['Impact', 'Slash'] }, { multiplier: 3, procs: ['Slash', 'Knockdown'] }],
  },
  {
    className: 'Warfan',
    source: 'wiki Warfan (Perfect Cut)',
    weapons: ['Arum Spinosa', 'Gunsen', 'Gunsen Prime', 'Quassus', 'Quassus Prime', 'Vericres'],
    hits: [...hits(2, 2.5, ['Knockdown', 'Slash']), { multiplier: 5, procs: ['Knockdown', 'Slash'] }],
  },
]

// in-game arsenal readings, these beat the wiki's class row
const ARSENAL_OVERRIDES: Record<string, HeavyCombo> = {
  'Coda Hirudo': {
    className: 'Sparring',
    source: 'in-game arsenal (1375 = 5x of 274.9 incl. Heat)',
    hits: [
      { multiplier: 5, procs: ['Puncture'] }, { multiplier: 3, procs: ['Slash'] }, { multiplier: 3 },
      { multiplier: 3, procs: ['Slash'] }, { multiplier: 3 }, { multiplier: 3, procs: ['Stun'] },
    ],
  },
}

const byWeapon = new Map(MULTI_HIT_HEAVIES.flatMap((heavyClass) => heavyClass.weapons.map((name) => [name, heavyClass] as const)))

export const heavyComboFor = (weaponName: string): HeavyCombo | null => ARSENAL_OVERRIDES[weaponName] ?? byWeapon.get(weaponName) ?? null
// kept for the flag: every combo in the table hits more than once
export const multiHitHeavyFor = (weaponName: string) => heavyComboFor(weaponName)

export const biggestHit = (combo: HeavyCombo) => Math.max(...combo.hits.filter((hit) => !hit.radial).map((hit) => hit.multiplier))
export const comboTotal = (combo: HeavyCombo) => combo.hits.reduce((total, hit) => total + hit.multiplier, 0)

export type HeavyMode = 'biggestHit' | 'fullCombo'

const percent = (value: number) => `${Math.round(value * 100)}%`

// hover text: every hit, its multiplier and forced procs. baseDamage = the weapon's normal attack total
export function heavyBreakdownText(combo: HeavyCombo, baseDamage?: number): string {
  const lines = combo.hits.map((hit, index) => {
    const damage = baseDamage ? ` ≈ ${Math.round(hit.multiplier * baseDamage).toLocaleString()}` : ''
    const extras = [...(hit.procs ?? []).map((proc) => (proc === 'Slash' ? 'Slash (Bleed)' : proc)), ...(hit.radial ? ['radial'] : [])]
    return `hit ${index + 1}: ${percent(hit.multiplier)}${damage}${extras.length ? `  [${extras.join(', ')}]` : ''}`
  })
  const total = comboTotal(combo)
  return [
    `${combo.className} heavy, ${combo.hits.length} hits (${combo.source}):`,
    ...lines,
    `biggest hit ${percent(biggestHit(combo))}, all hits ${percent(total)}${baseDamage ? ` ≈ ${Math.round(total * baseDamage).toLocaleString()}` : ''} (base, before mods)`,
  ].join('\n')
}
