// public/leaderboard.json is stored compact (mods/arcanes as indexes into one shared table) and expanded
// into LeaderboardEntry when the Leaderboard tab loads it

export interface LeaderboardUpgrade {
  id: string // uniqueName
  name: string
  rank: number
  conditionalStacks: number
}

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

export interface LeaderboardEntry {
  weaponId: string
  weaponName: string
  category: string
  type: string
  attack: string
  incarnonForm: boolean
  score: number
  stats: LeaderboardStats
  mods: LeaderboardUpgrade[] // slot order
  arcane: LeaderboardUpgrade | null
  perks: { tier: string; name: string }[]
  passives?: string[] // weapon passives that were on (at the scenario's stacks)
  bonusElement?: { damageType: string; value: number } | null // Kuva/Tenet/Coda element the optimizer picked
}

// ---- compact file format ----
type CompactUpgrade = [tableIndex: number, rank: number, conditionalStacks: number]

export interface CompactEntry extends Omit<LeaderboardEntry, 'mods' | 'arcane'> {
  mods: CompactUpgrade[]
  arcane: CompactUpgrade | null
}

export interface LeaderboardFile {
  generatedAt: string
  dataVersion: string
  scenario: string
  upgrades: { id: string; name: string }[] // shared table for mods + arcanes
  boards: Record<string, CompactEntry[]> // keyed by boardKey(): 'sustained', 'sustained-nofr', ...
  // for the incremental rebuild (scripts/leaderboardFingerprint.ts), the site ignores these
  engine?: string
  fingerprints?: Record<string, string> // weapon uniqueName -> its fingerprint when its entries were built
}

export interface Leaderboard {
  generatedAt: string
  dataVersion: string
  scenario: string
  boards: Record<string, LeaderboardEntry[]>
}

export function expandLeaderboard(file: LeaderboardFile): Leaderboard {
  const expand = ([index, rank, conditionalStacks]: CompactUpgrade): LeaderboardUpgrade => ({ ...file.upgrades[index], rank, conditionalStacks })
  const boards = Object.fromEntries(
    Object.entries(file.boards).map(([id, entries]) => [
      id,
      entries.map((entry) => ({ ...entry, mods: entry.mods.map(expand), arcane: entry.arcane ? expand(entry.arcane) : null })),
    ]),
  ) as Leaderboard['boards']
  return { generatedAt: file.generatedAt, dataVersion: file.dataVersion, scenario: file.scenario, boards }
}
