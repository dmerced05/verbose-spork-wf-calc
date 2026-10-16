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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { weapons, weaponsById } from '../src/data'
import { BOARDS } from '../src/optimizer/objectives'
import { optimizeWeapon, type WeaponEntry } from '../src/optimizer/leaderboardWeapon'
import type { SeedBuild } from '../src/optimizer/optimize'
import type { CompactEntry, LeaderboardFile } from '../src/optimizer/leaderboardTypes'
import { SCENARIO_DESCRIPTION } from '../src/optimizer/scenario'
import { engineFingerprint, weaponFingerprint } from './leaderboardFingerprint'

const ROOT = new URL('../', import.meta.url)
const CACHE_DIR = new URL('node_modules/.cache/leaderboard/', ROOT)
const OUTPUT = new URL('public/leaderboard.json', ROOT)
const SEEDS = new URL('scripts/leaderboard-seeds.json', ROOT)
const loadSeeds = (): SeedBuild[] => (existsSync(SEEDS) ? (JSON.parse(readFileSync(SEEDS, 'utf8')) as SeedBuild[]) : [])
const seedsFor = (seeds: SeedBuild[], weaponId: string) => seeds.filter((seed) => seed.weaponId === weaponId)

type Boards = Record<string, WeaponEntry[]>
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

// the old file's entries back to uniqueNames, so they can be re-indexed with the new ones
function loadOld(): { file: LeaderboardFile | null; boards: Boards } {
  const boards: Boards = Object.fromEntries(BOARDS.map((board) => [board.key, []]))
  if (!existsSync(OUTPUT)) return { file: null, boards }
  const file = JSON.parse(readFileSync(OUTPUT, 'utf8')) as LeaderboardFile
  const unindex = ([index, rank, stacks]: [number, number, number]): [string, string, number, number] => {
    const { id, name } = file.upgrades[index]
    return [id, name, rank, stacks]
  }
  for (const { key } of BOARDS) {
    boards[key] = (file.boards[key] ?? []).map((entry) => ({ ...entry, mods: entry.mods.map(unindex), arcane: entry.arcane ? unindex(entry.arcane) : null }))
  }
  return { file, boards }
}

function writeFile(boards: Boards, engine: string, fingerprints: Record<string, string>) {
  // fresh table every time, in board order, so nothing points at a mod that's no longer listed
  const upgrades: { id: string; name: string }[] = []
  const indexOf = new Map<string, number>()
  const tableIndexFor = (id: string, name: string) => {
    if (!indexOf.has(id)) {
      indexOf.set(id, upgrades.length)
      upgrades.push({ id, name })
    }
    return indexOf.get(id)!
  }
  const compact: Record<string, CompactEntry[]> = {}
  for (const { key } of BOARDS) {
    compact[key] = boards[key]
      .sort((a, b) => b.score - a.score)
      .map((entry) => ({
        ...entry,
        mods: entry.mods.map(([id, name, rank, stacks]) => [tableIndexFor(id, name), rank, stacks]),
        arcane: entry.arcane ? [tableIndexFor(entry.arcane[0], entry.arcane[1]), entry.arcane[2], entry.arcane[3]] : null,
      }))
  }
  const itemsPackage = JSON.parse(readFileSync(new URL('node_modules/@wfcd/items/package.json', ROOT), 'utf8'))
  const file: LeaderboardFile = {
    generatedAt: new Date().toISOString(),
    dataVersion: `@wfcd/items ${itemsPackage.version}`,
    scenario: SCENARIO_DESCRIPTION,
    upgrades,
    boards: compact,
    engine,
    fingerprints,
  }
  mkdirSync(new URL('public/', ROOT), { recursive: true })
  writeFileSync(OUTPUT, JSON.stringify(file))
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
  const engineChanged = !old.file?.engine || old.file.engine !== engine
  const reasons = new Map<string, string>()
  for (const weapon of weapons) {
    if (flag('all')) reasons.set(weapon.uniqueName, '--all')
    else if (engineChanged) reasons.set(weapon.uniqueName, old.file?.engine ? 'engine changed' : 'no fingerprints yet')
    else if (forced.has(weapon.name.toLowerCase())) reasons.set(weapon.uniqueName, '--only')
    else if (!old.file?.fingerprints?.[weapon.uniqueName]) reasons.set(weapon.uniqueName, 'new weapon')
    else if (old.file.fingerprints[weapon.uniqueName] !== fingerprints[weapon.uniqueName]) reasons.set(weapon.uniqueName, 'inputs changed')
  }
  const todo = [...reasons.keys()]
  // weapons that left the data just disappear from the boards
  const removed = Object.keys(old.file?.fingerprints ?? {}).filter((id) => !weaponsById.has(id))

  if (todo.length <= 40) for (const id of todo) console.log(`  ${weaponsById.get(id)!.name} (${reasons.get(id)})`)
  else console.log(`  ${todo.length} weapons (${reasons.get(todo[0])})`)
  if (removed.length) console.log(`  dropping ${removed.length} removed weapon(s)`)
  if (flag('dry')) return console.log(`dry run: ${todo.length} of ${weapons.length} weapons would rerun`)
  if (!todo.length && !removed.length) return console.log('leaderboard is up to date')

  // keep everything that isn't being rerun or removed
  const stale = new Set([...todo, ...removed])
  const boards: Boards = Object.fromEntries(BOARDS.map(({ key }) => [key, old.boards[key].filter((entry) => !stale.has(entry.weaponId))]))

  if (todo.length) {
    const count = Math.max(1, Math.min(cpus().length - 1, 12, todo.length))
    rmSync(CACHE_DIR, { recursive: true, force: true })
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(new URL('todo.json', CACHE_DIR), JSON.stringify(todo))
    console.log(`optimizing ${todo.length} of ${weapons.length} weapons x ${BOARDS.length} rankings on ${count} process(es)...`)
    const self = fileURLToPath(import.meta.url)
    await Promise.all(
      Array.from({ length: count }, (_, shard) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, [...process.execArgv, self, `--shard=${shard}`, `--of=${count}`], { stdio: ['ignore', 'inherit', 'inherit'] })
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
