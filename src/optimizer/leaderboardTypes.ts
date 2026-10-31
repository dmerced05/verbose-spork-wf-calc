// public/leaderboard.json is stored compact and expanded into LeaderboardEntry when the Leaderboard / Compare tabs load it.
// version 2 (current): mods, arcanes and weapons are indexes into shared tables, stats are a short tuple of only what the
// rows show (rounded to 4 significant digits), and short keys. ~3x smaller than version 1, which is still readable.
// the rebuild's fingerprints live in scripts/leaderboard-state.json, the site never needed them

export interface LeaderboardUpgrade {
  id: string // uniqueName
  name: string
  rank: number
  conditionalStacks: number
}

// everything a fresh optimizer run knows (Compare and Damage Cap show these live)
export interface LeaderboardStats {
  critChance: number
  critMultiplier: number
  statusChance: number
  multishot: number
  fireRate: number
  magazineSize: number | null
  reloadTime: number | null
  uptime: number
  sustainedDps: number
  burstDps: number
  singleHit: number
  statusTypes: number
  damageTypes: { type: string; share: number }[]
}

// what the file keeps: the stats a leaderboard row shows (the board's own score covers the DPS numbers)
export type BoardStats = Pick<LeaderboardStats, 'critChance' | 'critMultiplier' | 'statusChance' | 'multishot' | 'magazineSize' | 'reloadTime' | 'uptime' | 'singleHit' | 'damageTypes'>

export interface LeaderboardEntry {
  weaponId: string
  weaponName: string
  category: string
  type: string
  attack: string
  incarnonForm: boolean
  score: number
  stats: BoardStats
  mods: LeaderboardUpgrade[] // slot order
  arcane: LeaderboardUpgrade | null
  perks: { tier: string; name: string }[]
  passives?: string[] // weapon passives that were on (at the scenario's stacks)
  bonusElement?: { damageType: string; value: number } | null // Kuva/Tenet/Coda element the optimizer picked
}

export interface Leaderboard {
  generatedAt: string
  dataVersion: string
  scenario: string
  boards: Record<string, LeaderboardEntry[]>
}

// ---- file format, version 2 ----
type CompactUpgrade = [tableIndex: number, rank: number, conditionalStacks: number]
// critChance, critMultiplier, statusChance, multishot, magazineSize, reloadTime, uptime, singleHit, [[type, share]...]
type CompactStats = [number, number, number, number, number | null, number | null, number, number, [string, number][]]

export interface CompactEntry {
  w: number // weapons table index
  a: string // attack name ("Incarnon Form" in it = the Incarnon form)
  s: number // score
  st: CompactStats
  m: CompactUpgrade[] // mods, slot order
  ar?: CompactUpgrade // arcane, left out when there's none
  p?: [tier: string, name: string][] // Incarnon perks
  pa?: string[] // passives
  be?: { damageType: string; value: number } // bonus element
}

export interface LeaderboardFile {
  version: 2
  generatedAt: string
  dataVersion: string
  scenario: string
  upgrades: { id: string; name: string }[] // mods + arcanes
  weapons: [id: string, name: string, category: string, type: string][]
  boards: Record<string, CompactEntry[]> // keyed by boardKey(): 'sustained', 'sustained-nofr', ...
}

// ---- version 1, still readable (the file before this change, and what an older checkout wrote) ----
type V1Entry = Omit<LeaderboardEntry, 'mods' | 'arcane' | 'stats'> & { stats: BoardStats; mods: CompactUpgrade[]; arcane: CompactUpgrade | null }
export interface LeaderboardFileV1 {
  version?: undefined
  generatedAt: string
  dataVersion: string
  scenario: string
  upgrades: { id: string; name: string }[]
  boards: Record<string, V1Entry[]>
  engine?: string
  fingerprints?: Record<string, string>
}

// 4 significant digits is plenty for a row (1.092 -> 1.092, 84221.4 -> 84220), and a lot shorter in JSON
export const sig = (value: number, digits = 4) => (value === 0 || !Number.isFinite(value) ? value : Number(value.toPrecision(digits)))

// one entry for the file. `upgradeIndex` / `weaponIndex` add to the shared tables as they go
export interface StoredEntry extends Omit<LeaderboardEntry, 'mods' | 'arcane'> {
  mods: [id: string, name: string, rank: number, conditionalStacks: number][]
  arcane: [id: string, name: string, rank: number, conditionalStacks: number] | null
}
export function encodeEntry(entry: StoredEntry, upgradeIndex: (id: string, name: string) => number, weaponIndex: (entry: StoredEntry) => number): CompactEntry {
  const { stats } = entry
  const compact: CompactEntry = {
    w: weaponIndex(entry),
    a: entry.attack,
    s: sig(entry.score, 7),
    st: [
      sig(stats.critChance), sig(stats.critMultiplier), sig(stats.statusChance), sig(stats.multishot), stats.magazineSize,
      stats.reloadTime === null ? null : sig(stats.reloadTime, 3), sig(stats.uptime, 3), sig(stats.singleHit),
      stats.damageTypes.map((row) => [row.type, sig(row.share, 3)]),
    ],
    m: entry.mods.map(([id, name, rank, stacks]) => [upgradeIndex(id, name), rank, stacks]),
  }
  if (entry.arcane) compact.ar = [upgradeIndex(entry.arcane[0], entry.arcane[1]), entry.arcane[2], entry.arcane[3]]
  if (entry.perks.length) compact.p = entry.perks.map((perk) => [perk.tier, perk.name])
  if (entry.passives?.length) compact.pa = entry.passives
  if (entry.bonusElement) compact.be = entry.bonusElement
  return compact
}

export function expandLeaderboard(file: LeaderboardFile | LeaderboardFileV1): Leaderboard {
  const upgrade = ([index, rank, conditionalStacks]: CompactUpgrade): LeaderboardUpgrade => ({ ...file.upgrades[index], rank, conditionalStacks })
  if (file.version !== 2) {
    const boards = Object.fromEntries(Object.entries(file.boards).map(([id, entries]) => [
      id, entries.map((entry) => ({ ...entry, mods: entry.mods.map(upgrade), arcane: entry.arcane ? upgrade(entry.arcane) : null })),
    ]))
    return { generatedAt: file.generatedAt, dataVersion: file.dataVersion, scenario: file.scenario, boards }
  }
  const boards = Object.fromEntries(Object.entries(file.boards).map(([id, entries]) => [
    id,
    entries.map((entry): LeaderboardEntry => {
      const [weaponId, weaponName, category, type] = file.weapons[entry.w]
      const [critChance, critMultiplier, statusChance, multishot, magazineSize, reloadTime, uptime, singleHit, damageTypes] = entry.st
      return {
        weaponId, weaponName, category, type, attack: entry.a, incarnonForm: /incarnon/i.test(entry.a), score: entry.s,
        stats: { critChance, critMultiplier, statusChance, multishot, magazineSize, reloadTime, uptime, singleHit, damageTypes: damageTypes.map(([damageType, share]) => ({ type: damageType, share })) },
        mods: entry.m.map(upgrade),
        arcane: entry.ar ? upgrade(entry.ar) : null,
        perks: (entry.p ?? []).map(([tier, name]) => ({ tier, name })),
        passives: entry.pa ?? [],
        bonusElement: entry.be ?? null,
      }
    }),
  ]))
  return { generatedAt: file.generatedAt, dataVersion: file.dataVersion, scenario: file.scenario, boards }
}

// the other way, for the rebuild: an expanded entry back to uniqueName tuples so it can be re-encoded
export const toStored = (entry: LeaderboardEntry): StoredEntry => ({
  ...entry,
  mods: entry.mods.map((mod) => [mod.id, mod.name, mod.rank, mod.conditionalStacks]),
  arcane: entry.arcane ? [entry.arcane.id, entry.arcane.name, entry.arcane.rank, entry.arcane.conditionalStacks] : null,
})
