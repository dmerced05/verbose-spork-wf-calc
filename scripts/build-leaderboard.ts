// precomputes the leaderboard: runs the optimizer on every weapon attack for every ranking (objective) and
// writes public/leaderboard.json, which the Leaderboard tab just reads. run with: npm run leaderboard
// it splits the weapons across child processes (one per CPU core) and merges their results.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { weapons } from '../src/data'
import { optimizeAttack, type OptimizedBuild } from '../src/optimizer/optimize'
import { BOARDS, boardKey } from '../src/optimizer/objectives'
import { heavyComboFor } from '../src/data/heavyAttacks'
import type { CompactEntry, LeaderboardFile } from '../src/optimizer/leaderboardTypes'
import { SCENARIO_DESCRIPTION } from '../src/optimizer/scenario'

const ROOT = new URL('../', import.meta.url)
const CACHE_DIR = new URL('node_modules/.cache/leaderboard/', ROOT)
const OUTPUT = new URL('public/leaderboard.json', ROOT)

type Boards = Record<string, CompactEntry[]>
const emptyBoards = (): Boards => Object.fromEntries(BOARDS.map((board) => [board.key, []]))
const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits

// mods/arcanes become indexes into one shared table, which keeps the JSON a fraction of the size
const upgradeTable: { id: string; name: string }[] = []
const upgradeIndex = new Map<string, number>()
const tableIndexFor = (id: string, name: string) => {
  if (!upgradeIndex.has(id)) {
    upgradeIndex.set(id, upgradeTable.length)
    upgradeTable.push({ id, name })
  }
  return upgradeIndex.get(id)!
}

// the shards write mods by uniqueName, the parent re-indexes them into the final table
interface ShardEntry extends Omit<CompactEntry, 'mods' | 'arcane'> {
  mods: [string, string, number, number][]
  arcane: [string, string, number, number] | null
}

function toShardEntry(build: OptimizedBuild, score: number): ShardEntry {
  const { result } = build
  const totalModded = result.damageTypes.reduce((total, row) => total + row.modded, 0)
  return {
    weaponId: build.weapon.uniqueName,
    weaponName: build.weapon.name,
    category: build.weapon.category,
    type: build.weapon.type,
    attack: build.attack.name,
    incarnonForm: /incarnon/i.test(build.attack.name),
    score: round(score, 2),
    stats: {
      critChance: round(result.critChance),
      critMultiplier: round(result.critMultiplier),
      statusChance: round(result.statusChance),
      multishot: round(result.multishot),
      fireRate: round(result.fireRate),
      magazineSize: result.magazineSize,
      reloadTime: result.reloadTime === null ? null : round(result.reloadTime, 2),
      uptime: round(result.uptime, 3),
      sustainedDps: round(result.sustainedDps, 1),
      burstDps: round(result.totalDps, 1),
      singleHit: round(result.hit.average, 1),
      statusTypes: result.activeStatusTypes,
      damageTypes: result.damageTypes.slice(0, 3).map((row) => ({ type: row.damageType, share: round(row.modded / (totalModded || 1), 3) })),
    },
    mods: build.mods.map(({ mod, rank, conditionalStacks }) => [mod.uniqueName, mod.name, rank, conditionalStacks]),
    arcane: build.arcane ? [build.arcane.arcane.uniqueName, build.arcane.arcane.name, build.arcane.rank, build.arcane.conditionalStacks] : null,
    perks: build.perks.map(({ perk }) => ({ tier: perk.tier, name: perk.name })),
    passives: build.result.passives,
    bonusElement: build.bonusElement,
  }
}

// one shard: every weapon attack x every ranking
function runShard(shard: number, count: number) {
  const boards = Object.fromEntries(BOARDS.map((board) => [board.key, [] as ShardEntry[]]))
  weapons.forEach((weapon, index) => {
    if (index % count !== shard) return
    // event-only attacks (reload explosions, turret expiry) don't fire at the fire rate, so they're skipped
    const attacks = weapon.attacks.filter(
      (attack) => Object.values(attack.damage).some((amount) => amount > 0) && !/reload|expiry|turret/i.test(attack.name),
    )
    // every attack (component) gets its own listing: slam, heavy slam, heavy attack, alt-fire, Incarnon form...
    for (const attack of attacks) {
      const builds = new Map<string, OptimizedBuild>()
      for (const { key, objective, allowFireRateMods, heavyMode, heavyOnly } of BOARDS) {
        // heavies use up the combo, so spamming them at max combo isn't real DPS. they only compete for single hits
        if (attack.heavy && objective.usesFireRate) continue
        // the full-heavy board only holds multi-hit Heavy Attacks
        if (heavyOnly && !(attack.heavyMultiplier && heavyComboFor(weapon.name))) continue
        builds.set(key, optimizeAttack(weapon, attack, objective, allowFireRateMods, heavyMode))
      }
      // the search is a heuristic, so the no-fire-rate build can come out ahead. it's a legal build either way
      for (const { key, objective, allowFireRateMods } of BOARDS) {
        const without = builds.get(boardKey(objective.id, false))
        if (allowFireRateMods && objective.usesFireRate && without && without.score > (builds.get(key)?.score ?? 0)) builds.set(key, without)
      }
      for (const [key, build] of builds) if (build.score > 0) boards[key].push(toShardEntry(build, build.score))
    }
    process.stdout.write('.')
  })
  writeFileSync(new URL(`shard-${shard}.json`, CACHE_DIR), JSON.stringify(boards))
}

async function main() {
  const shardArg = process.argv.find((arg) => arg.startsWith('--shard='))
  if (shardArg) {
    runShard(Number(shardArg.split('=')[1]), Number(process.argv.find((arg) => arg.startsWith('--of='))!.split('=')[1]))
    return
  }

  const count = Math.max(1, Math.min(cpus().length - 1, 12))
  rmSync(CACHE_DIR, { recursive: true, force: true })
  mkdirSync(CACHE_DIR, { recursive: true })
  console.log(`optimizing ${weapons.length} weapons x ${BOARDS.length} rankings on ${count} processes...`)
  const started = Date.now()
  const self = fileURLToPath(import.meta.url)
  await Promise.all(
    Array.from({ length: count }, (_, shard) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [...process.execArgv, self, `--shard=${shard}`, `--of=${count}`], { stdio: ['ignore', 'inherit', 'inherit'] })
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`shard ${shard} exited with ${code}`))))
      }),
    ),
  )

  const boards = emptyBoards()
  for (let shard = 0; shard < count; shard++) {
    const part = JSON.parse(readFileSync(new URL(`shard-${shard}.json`, CACHE_DIR), 'utf8')) as Record<string, ShardEntry[]>
    for (const { key } of BOARDS) {
      for (const entry of part[key]) {
        boards[key].push({
          ...entry,
          mods: entry.mods.map(([id, name, rank, stacks]) => [tableIndexFor(id, name), rank, stacks]),
          arcane: entry.arcane ? [tableIndexFor(entry.arcane[0], entry.arcane[1]), entry.arcane[2], entry.arcane[3]] : null,
        })
      }
    }
  }
  for (const { key } of BOARDS) boards[key].sort((a, b) => b.score - a.score)

  const itemsPackage = JSON.parse(readFileSync(new URL('node_modules/@wfcd/items/package.json', ROOT), 'utf8'))
  const file: LeaderboardFile = {
    generatedAt: new Date().toISOString(),
    dataVersion: `@wfcd/items ${itemsPackage.version}`,
    scenario: SCENARIO_DESCRIPTION,
    upgrades: upgradeTable,
    boards,
  }
  mkdirSync(new URL('public/', ROOT), { recursive: true })
  writeFileSync(OUTPUT, JSON.stringify(file))
  console.log(`\nwrote public/leaderboard.json in ${((Date.now() - started) / 1000).toFixed(0)}s`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
