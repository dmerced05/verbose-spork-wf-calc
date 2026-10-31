// precomputes the leaderboard: runs the optimizer on every weapon attack for every ranking (objective) and
// writes public/leaderboard.json, which the Leaderboard tab just reads. run with: npm run leaderboard
//
// it's incremental: each weapon's entries are stored with a fingerprint of everything that weapon depends on
// (scripts/leaderboardFingerprint.ts), and only weapons whose fingerprint changed get re-optimized. the rest are
// copied over from the old file and everything gets re-sorted. a change to the generic engine reruns everything.
//   npm run leaderboard                 rerun what changed
//   npm run leaderboard -- --dry        just list what would rerun and why
//   npm run leaderboard -- --all        full rebuild
//   npm run leaderboard -- --only=Kronen Prime,Glaive    also rerun these (by name), changed or not
//   npm run leaderboard -- --adopt      stamp fingerprints on the current file without rerunning anything.
//                                       only for when you know the file already matches the code
// scripts/leaderboard-seeds.json holds builds found in the Compare tab ("Copy seeds"). each is scored the leaderboard's
// way and kept only if it beats the search, and adding one reruns just that weapon
// the stale weapons get split across child processes (one per CPU core).
import { spawn } from 'node:child_process'
import { buildSync } from 'esbuild'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { weapons, weaponsById } from '../src/data'
import { BOARDS } from '../src/optimizer/objectives'
import { optimizeWeapon } from '../src/optimizer/leaderboardWeapon'
import type { SeedBuild } from '../src/optimizer/optimize'
import { encodeEntry, expandLeaderboard, toStored, type CompactEntry, type LeaderboardFile, type LeaderboardFileV1, type StoredEntry } from '../src/optimizer/leaderboardTypes'
import { SCENARIO_DESCRIPTION } from '../src/optimizer/scenario'
import { engineFingerprint, weaponFingerprint } from './leaderboardFingerprint'

// the shards run from a bundle in the cache folder (see main), so they get the project root passed in
const ROOT = process.env.WF_ROOT ? new URL(`file://${process.env.WF_ROOT}/`) : new URL('../', import.meta.url)
const CACHE_DIR = new URL('node_modules/.cache/leaderboard/', ROOT)
const OUTPUT = new URL('public/leaderboard.json', ROOT)
// the incremental-rebuild bookkeeping (engine hash + per-weapon fingerprints), kept out of the file the site downloads
const STATE = new URL('scripts/leaderboard-state.json', ROOT)
interface State { engine?: string; fingerprints?: Record<string, string> }
const SEEDS = new URL('scripts/leaderboard-seeds.json', ROOT)
const loadSeeds = (): SeedBuild[] => (existsSync(SEEDS) ? (JSON.parse(readFileSync(SEEDS, 'utf8')) as SeedBuild[]) : [])
const seedsFor = (seeds: SeedBuild[], weaponId: string) => seeds.filter((seed) => seed.weaponId === weaponId)

type Boards = Record<string, StoredEntry[]>
const flag = (name: string) => process.argv.includes(`--${name}`)
const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)

// one shard: its share of the stale weapons, every attack x every ranking
function runShard(shard: number, count: number) {
  const todo = JSON.parse(readFileSync(new URL('todo.json', CACHE_DIR), 'utf8')) as string[]
  const seeds = loadSeeds()
  const boards: Boards = Object.fromEntries(BOARDS.map((board) => [board.key, []]))
  todo.forEach((weaponId, index) => {
    if (index % count !== shard) return
    for (const [key, entries] of Object.entries(optimizeWeapon(weaponsById.get(weaponId)!, seedsFor(seeds, weaponId)))) boards[key].push(...entries)
    process.stdout.write('.')
  })
  writeFileSync(new URL(`shard-${shard}.json`, CACHE_DIR), JSON.stringify(boards))
}

// the old file's entries back to uniqueNames (either file version), so they can be re-indexed with the new ones
function loadOld(): { file: LeaderboardFile | LeaderboardFileV1 | null; state: State; boards: Boards } {
  const boards: Boards = Object.fromEntries(BOARDS.map((board) => [board.key, []]))
  const savedState: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}
  if (!existsSync(OUTPUT)) return { file: null, state: savedState, boards }
  const file = JSON.parse(readFileSync(OUTPUT, 'utf8')) as LeaderboardFile | LeaderboardFileV1
  const expanded = expandLeaderboard(file)
  for (const { key } of BOARDS) boards[key] = (expanded.boards[key] ?? []).map(toStored)
  // a version 1 file carried its own fingerprints
  const state = savedState.engine ? savedState : file.version !== 2 ? { engine: file.engine, fingerprints: file.fingerprints } : savedState
  return { file, state, boards }
}

function writeFile(boards: Boards, engine: string, fingerprints: Record<string, string>) {
  // fresh tables every time, in board order, so nothing points at a mod or weapon that's no longer listed
  const upgrades: { id: string; name: string }[] = []
  const upgradeIndexes = new Map<string, number>()
  const upgradeIndex = (id: string, name: string) => {
    if (!upgradeIndexes.has(id)) {
      upgradeIndexes.set(id, upgrades.length)
      upgrades.push({ id, name })
    }
    return upgradeIndexes.get(id)!
  }
  const weaponTable: LeaderboardFile['weapons'] = []
  const weaponIndexes = new Map<string, number>()
  const weaponIndex = (entry: StoredEntry) => {
    if (!weaponIndexes.has(entry.weaponId)) {
      weaponIndexes.set(entry.weaponId, weaponTable.length)
      weaponTable.push([entry.weaponId, entry.weaponName, entry.category, entry.type])
    }
    return weaponIndexes.get(entry.weaponId)!
  }
  const compact: Record<string, CompactEntry[]> = {}
  for (const { key } of BOARDS) compact[key] = boards[key].sort((a, b) => b.score - a.score).map((entry) => encodeEntry(entry, upgradeIndex, weaponIndex))
  const itemsPackage = JSON.parse(readFileSync(new URL('node_modules/@wfcd/items/package.json', ROOT), 'utf8'))
  const file: LeaderboardFile = {
    version: 2,
    generatedAt: new Date().toISOString(),
    dataVersion: `@wfcd/items ${itemsPackage.version}`,
    scenario: SCENARIO_DESCRIPTION,
    upgrades,
    weapons: weaponTable,
    boards: compact,
  }
  mkdirSync(new URL('public/', ROOT), { recursive: true })
  writeFileSync(OUTPUT, JSON.stringify(file))
  writeFileSync(STATE, `${JSON.stringify({ engine, fingerprints } satisfies State, null, 1)}\n`)
}

async function main() {
  const shardArg = option('shard')
  if (shardArg) return runShard(Number(shardArg), Number(option('of')))

  const started = Date.now()
  const engine = engineFingerprint()
  const seeds = loadSeeds()
  const fingerprints = Object.fromEntries(weapons.map((weapon) => [weapon.uniqueName, weaponFingerprint(weapon, seedsFor(seeds, weapon.uniqueName))]))
  const old = loadOld()

  if (flag('adopt')) {
    if (!old.file) throw new Error('no public/leaderboard.json to adopt')
    writeFile(old.boards, engine, fingerprints)
    console.log(`stamped fingerprints for ${weapons.length} weapons on the current leaderboard (nothing re-optimized)`)
    return
  }

  // what's stale and why
  const forced = new Set((option('only') ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean))
  const engineChanged = !old.state.engine || old.state.engine !== engine
  const reasons = new Map<string, string>()
  for (const weapon of weapons) {
    if (flag('all')) reasons.set(weapon.uniqueName, '--all')
    else if (engineChanged) reasons.set(weapon.uniqueName, old.state.engine ? 'engine changed' : 'no fingerprints yet')
    else if (forced.has(weapon.name.toLowerCase())) reasons.set(weapon.uniqueName, '--only')
    else if (!old.state.fingerprints?.[weapon.uniqueName]) reasons.set(weapon.uniqueName, 'new weapon')
    else if (old.state.fingerprints[weapon.uniqueName] !== fingerprints[weapon.uniqueName]) reasons.set(weapon.uniqueName, 'inputs changed')
  }
  const todo = [...reasons.keys()]
  // weapons that left the data just disappear from the boards
  const removed = Object.keys(old.state.fingerprints ?? {}).filter((id) => !weaponsById.has(id))

  if (todo.length <= 40) for (const id of todo) console.log(`  ${weaponsById.get(id)!.name} (${reasons.get(id)})`)
  else console.log(`  ${todo.length} weapons (${reasons.get(todo[0])})`)
  if (removed.length) console.log(`  dropping ${removed.length} removed weapon(s)`)
  if (flag('dry')) return console.log(`dry run: ${todo.length} of ${weapons.length} weapons would rerun`)
  if (!todo.length && !removed.length) return console.log('leaderboard is up to date')

  // keep everything that isn't being rerun or removed
  const stale = new Set([...todo, ...removed])
  const boards: Boards = Object.fromEntries(BOARDS.map(({ key }) => [key, old.boards[key].filter((entry) => !stale.has(entry.weaponId))]))

  if (todo.length) {
    // every core: this process just waits while the shards run
    const count = Math.max(1, Math.min(cpus().length, 12, todo.length))
    rmSync(CACHE_DIR, { recursive: true, force: true })
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(new URL('todo.json', CACHE_DIR), JSON.stringify(todo))
    console.log(`optimizing ${todo.length} of ${weapons.length} weapons x ${BOARDS.length} rankings on ${count} process(es)...`)
    // the shards run a plain-JS bundle of this script instead of going through tsx: ~1.6x faster, same results
    // (tsx's on-the-fly compile wraps every inner function of the calc in a naming helper, and it runs millions of times)
    const runner = fileURLToPath(new URL('runner.mjs', CACHE_DIR))
    buildSync({ entryPoints: [fileURLToPath(import.meta.url)], bundle: true, platform: 'node', format: 'esm', outfile: runner, logLevel: 'warning', packages: 'external' })
    const root = fileURLToPath(ROOT).replace(/\/$/, '')
    await Promise.all(
      Array.from({ length: count }, (_, shard) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, [runner, `--shard=${shard}`, `--of=${count}`], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, WF_ROOT: root } })
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`shard ${shard} exited with ${code}`))))
        }),
      ),
    )
    for (let shard = 0; shard < count; shard++) {
      const part = JSON.parse(readFileSync(new URL(`shard-${shard}.json`, CACHE_DIR), 'utf8')) as Boards
      for (const { key } of BOARDS) boards[key].push(...part[key])
    }
  }

  writeFile(boards, engine, fingerprints)
  console.log(`\nwrote public/leaderboard.json in ${((Date.now() - started) / 1000).toFixed(0)}s`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
