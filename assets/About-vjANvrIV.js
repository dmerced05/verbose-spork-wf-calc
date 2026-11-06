import{n as e,r as t,t as n}from"./index-CkyFOu6f.js";var r=`// precomputes the leaderboard: runs the optimizer on every weapon attack for every ranking (objective) and
// writes public/leaderboard.json, which the Leaderboard tab just reads. run with: npm run leaderboard
//
// it's incremental: each weapon's entries are stored with a fingerprint of everything that weapon depends on
// (scripts/leaderboardFingerprint.ts), and only weapons whose fingerprint changed get re-optimized. the rest are
// copied over from the old file and everything gets re-sorted. a change to the generic engine reruns everything.
//   npm run leaderboard                 rerun what changed
//   npm run leaderboard -- --dry        just list what would rerun and why
//   npm run leaderboard -- --all        full rebuild
//   npm run leaderboard -- --only=Kronen Prime,Glaive    also rerun these (by name), changed or not
//   npm run leaderboard -- --boards=single   only re-optimize these boards (keys), keep the others from the old file.
//                                       for a change that only touches those boards (the engine hash still marks everyone)
//   npm run leaderboard -- --adopt      stamp fingerprints on the current file without rerunning anything.
//                                       only for when you know the file already matches the code
//   npm run leaderboard -- --boss       the Boss Damage board instead (src/optimizer/bossLeaderboard.ts), into its own
//                                       public/boss-leaderboard.json + state file. every flag above works with it
// scripts/leaderboard-seeds.json holds builds found in the Compare tab ("Copy seeds"). each is scored the leaderboard's
// way and kept only if it beats the search, and adding one reruns just that weapon
// the stale weapons get split across child processes (one per CPU core).
import { spawn } from 'node:child_process'
import { buildSync } from 'esbuild'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { weapons, weaponsById } from '../src/data'
import { BOARDS as MAIN_BOARDS } from '../src/optimizer/objectives'
import { optimizeWeapon } from '../src/optimizer/leaderboardWeapon'
import { BOSS_BOARDS, BOSS_DESCRIPTION, optimizeWeaponBoss } from '../src/optimizer/bossLeaderboard'
import type { SeedBuild } from '../src/optimizer/optimize'
import type { Weapon } from '../src/types'
import { encodeEntry, expandLeaderboard, toStored, type CompactEntry, type LeaderboardFile, type LeaderboardFileV1, type StoredEntry } from '../src/optimizer/leaderboardTypes'
import { SCENARIO_DESCRIPTION } from '../src/optimizer/scenario'
import { createHash } from 'node:crypto'
import { engineFingerprint, weaponFingerprint } from './leaderboardFingerprint'

// the shards run from a bundle in the cache folder (see main), so they get the project root passed in
const ROOT = process.env.WF_ROOT ? new URL(\`file://\${process.env.WF_ROOT}/\`) : new URL('../', import.meta.url)
const flag = (name: string) => process.argv.includes(\`--\${name}\`)
const option = (name: string) => process.argv.find((arg) => arg.startsWith(\`--\${name}=\`))?.slice(name.length + 3)
// --boss swaps the boards, the per-weapon run, the output and the bookkeeping, everything else is shared
const BOSS = flag('boss')
const BOARDS = BOSS ? BOSS_BOARDS : MAIN_BOARDS
const CACHE_DIR = new URL(BOSS ? 'node_modules/.cache/boss-leaderboard/' : 'node_modules/.cache/leaderboard/', ROOT)
const OUTPUT = new URL(BOSS ? 'public/boss-leaderboard.json' : 'public/leaderboard.json', ROOT)
// the incremental-rebuild bookkeeping (engine hash + per-weapon fingerprints), kept out of the file the site downloads
const STATE = new URL(BOSS ? 'scripts/boss-leaderboard-state.json' : 'scripts/leaderboard-state.json', ROOT)
interface State { engine?: string; fingerprints?: Record<string, string> }
const SEEDS = new URL('scripts/leaderboard-seeds.json', ROOT)
const loadSeeds = (): SeedBuild[] => (existsSync(SEEDS) ? (JSON.parse(readFileSync(SEEDS, 'utf8')) as SeedBuild[]) : [])
// seeds are main-board builds, the boss board doesn't take them
const seedsFor = (seeds: SeedBuild[], weaponId: string) => (BOSS ? [] : seeds.filter((seed) => seed.weaponId === weaponId))
const ONLY_BOARDS = option('boards')?.split(',').map((key) => key.trim()).filter(Boolean)
const runWeapon = (weapon: Weapon, seeds: SeedBuild[]) => (BOSS ? optimizeWeaponBoss(weapon) : optimizeWeapon(weapon, seeds, ONLY_BOARDS))
// the boss board also depends on its own module
const bossEngine = (engine: string) => createHash('sha256').update(engine).update(readFileSync(new URL('src/optimizer/bossLeaderboard.ts', ROOT), 'utf8')).digest('hex').slice(0, 16)

type Boards = Record<string, StoredEntry[]>

// one shard: its share of the stale weapons, every attack x every ranking
function runShard(shard: number, count: number) {
  const todo = JSON.parse(readFileSync(new URL('todo.json', CACHE_DIR), 'utf8')) as string[]
  const seeds = loadSeeds()
  const boards: Boards = Object.fromEntries(BOARDS.map((board) => [board.key, []]))
  todo.forEach((weaponId, index) => {
    if (index % count !== shard) return
    for (const [key, entries] of Object.entries(runWeapon(weaponsById.get(weaponId)!, seedsFor(seeds, weaponId)))) boards[key]?.push(...entries)
    process.stdout.write('.')
  })
  writeFileSync(new URL(\`shard-\${shard}.json\`, CACHE_DIR), JSON.stringify(boards))
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
    dataVersion: \`@wfcd/items \${itemsPackage.version}\`,
    scenario: BOSS ? BOSS_DESCRIPTION : SCENARIO_DESCRIPTION,
    upgrades,
    weapons: weaponTable,
    boards: compact,
  }
  mkdirSync(new URL('public/', ROOT), { recursive: true })
  writeFileSync(OUTPUT, JSON.stringify(file))
  writeFileSync(STATE, \`\${JSON.stringify({ engine, fingerprints } satisfies State, null, 1)}\\n\`)
}

async function main() {
  const shardArg = option('shard')
  if (shardArg) return runShard(Number(shardArg), Number(option('of')))

  const started = Date.now()
  const engine = BOSS ? bossEngine(engineFingerprint()) : engineFingerprint()
  const seeds = loadSeeds()
  const fingerprints = Object.fromEntries(weapons.map((weapon) => [weapon.uniqueName, weaponFingerprint(weapon, seedsFor(seeds, weapon.uniqueName))]))
  const old = loadOld()

  if (flag('adopt')) {
    if (!old.file) throw new Error('no public/leaderboard.json to adopt')
    writeFile(old.boards, engine, fingerprints)
    console.log(\`stamped fingerprints for \${weapons.length} weapons on the current leaderboard (nothing re-optimized)\`)
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

  if (todo.length <= 40) for (const id of todo) console.log(\`  \${weaponsById.get(id)!.name} (\${reasons.get(id)})\`)
  else console.log(\`  \${todo.length} weapons (\${reasons.get(todo[0])})\`)
  if (removed.length) console.log(\`  dropping \${removed.length} removed weapon(s)\`)
  if (flag('dry')) return console.log(\`dry run: \${todo.length} of \${weapons.length} weapons would rerun\`)
  if (!todo.length && !removed.length) return console.log('leaderboard is up to date')

  // keep everything that isn't being rerun or removed
  const stale = new Set([...todo, ...removed])
  // with --boards only those boards drop the stale weapons' entries, the others keep theirs (removed weapons go everywhere)
  const rerun = (key: string) => !ONLY_BOARDS || ONLY_BOARDS.includes(key)
  const boards: Boards = Object.fromEntries(BOARDS.map(({ key }) => [key, old.boards[key].filter((entry) => !(rerun(key) ? stale : new Set(removed)).has(entry.weaponId))]))

  if (todo.length) {
    // every core: this process just waits while the shards run
    const count = Math.max(1, Math.min(cpus().length, 12, todo.length))
    rmSync(CACHE_DIR, { recursive: true, force: true })
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(new URL('todo.json', CACHE_DIR), JSON.stringify(todo))
    console.log(\`optimizing \${todo.length} of \${weapons.length} weapons x \${ONLY_BOARDS?.length ?? BOARDS.length} rankings on \${count} process(es)...\`)
    // the shards run a plain-JS bundle of this script instead of going through tsx: ~1.6x faster, same results
    // (tsx's on-the-fly compile wraps every inner function of the calc in a naming helper, and it runs millions of times)
    const runner = fileURLToPath(new URL('runner.mjs', CACHE_DIR))
    buildSync({ entryPoints: [fileURLToPath(import.meta.url)], bundle: true, platform: 'node', format: 'esm', outfile: runner, logLevel: 'warning', packages: 'external' })
    const root = fileURLToPath(ROOT).replace(/\\/$/, '')
    await Promise.all(
      Array.from({ length: count }, (_, shard) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, [runner, \`--shard=\${shard}\`, \`--of=\${count}\`, ...(BOSS ? ['--boss'] : []), ...(ONLY_BOARDS ? [\`--boards=\${ONLY_BOARDS.join(',')}\`] : [])], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, WF_ROOT: root } })
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(\`shard \${shard} exited with \${code}\`))))
        }),
      ),
    )
    for (let shard = 0; shard < count; shard++) {
      const part = JSON.parse(readFileSync(new URL(\`shard-\${shard}.json\`, CACHE_DIR), 'utf8')) as Boards
      for (const { key } of BOARDS) if (rerun(key)) boards[key].push(...(part[key] ?? []))
    }
  }

  writeFile(boards, engine, fingerprints)
  console.log(\`\\nwrote \${BOSS ? 'public/boss-leaderboard.json' : 'public/leaderboard.json'} in \${((Date.now() - started) / 1000).toFixed(0)}s\`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
`,i=`// fingerprints for the incremental leaderboard rebuild (scripts/build-leaderboard.ts).
//
// two levels:
//   engine  - one hash over the generic code every weapon runs through (damage formula, optimizer, scenario).
//             if it changes, every weapon is stale and it's a full rebuild
//   weapon  - one hash per weapon over everything that's specific to it: its own data, and the *outputs* of the
//             per-item lookups (parsed mods it can equip, its passives, heavy combo, exalted rule, Incarnon perks,
//             CO behavior per attack...). so fixing one augment's special line only changes the weapons that can
//             equip it, and adding a passive only changes the weapons that have it
//
// the trick is hashing what a lookup *returns* for this weapon instead of the file the lookup lives in.
// code I hash as source has comment-only lines and whitespace stripped so comment edits don't rebuild anything
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { getCompatibleArcanes, getCompatibleMods } from '../src/data'
import { defaultConditionalStacks, parseUpgrade, raisesFireRate, scopeApplies, utilityValue } from '../src/calc/parseMod'
import { MOD_SETS } from '../src/calc/modSets'
import { resolveCoBehavior } from '../src/calc/conditionOverload'
import { getIncarnonTiers, perkAppliesTo } from '../src/calc/incarnon'
import { exaltedRuleFor } from '../src/data/exalted'
import { hasBonusElement, passivesFor } from '../src/data/passives'
import { heavyComboFor } from '../src/data/heavyAttacks'
import { SHELL_BY_SHELL_RELOAD } from '../src/data/reloads'
import { COMPRESSION } from '../src/data/compression'
import { maxComboFor } from '../src/calc/constants'
import * as constants from '../src/calc/constants'
import * as heavyAttacks from '../src/data/heavyAttacks'
import * as passives from '../src/data/passives'
import * as exalted from '../src/data/exalted'
import * as conditionOverload from '../src/calc/conditionOverload'
import type { Arcane, Mod, Weapon } from '../src/types'
import type { SeedBuild } from '../src/optimizer/optimize'

const ROOT = new URL('../', import.meta.url)

// generic code, hashed as source. anything with weapon-specific branches in here (damage.ts has a few) means a
// full rebuild when it changes, there's no way to tell which weapons a code edit touches
const ENGINE_FILES = [
  'src/calc/damage.ts',
  'src/calc/simulate.ts',
  'src/calc/target.ts',
  'src/calc/modSets.ts',
  'src/calc/modConflicts.ts',
  'src/optimizer/optimize.ts',
  'src/optimizer/modPool.ts',
  'src/optimizer/objectives.ts',
  'src/optimizer/scenario.ts',
  'src/optimizer/leaderboardWeapon.ts',
  'src/optimizer/leaderboardTypes.ts',
  'src/types.ts',
  // stance combos: the class's stances decide melee Normal Attack DPS
  'src/data/stances.ts',
  'src/data/stances.json',
  'src/data/weaponClasses.ts',
]

// modules that mix generic helpers with per-weapon tables. their exports go into the engine hash *minus* the
// tables (functions by source), and the tables get covered per weapon through the lookups below.
// parseMod.ts, specialLines.ts, data/index.ts and the Incarnon perk parser aren't here at all: what they produce
// is hashed per mod/weapon, so a parser fix only reruns the weapons whose parsed mods actually changed
const MIXED_MODULES: [string, Record<string, unknown>, string[]][] = [
  ['constants', constants, []], // MAX_COMBO_BY_WEAPON isn't exported, maxComboFor() goes per weapon
  ['heavyAttacks', heavyAttacks, ['MULTI_HIT_HEAVIES']],
  ['passives', passives, ['PASSIVES']],
  ['exalted', exalted, ['EXALTED']],
  ['conditionOverload', conditionOverload, []], // CO_RULES is internal, resolveCoBehavior() goes per attack
]

// stable JSON: sorted keys, functions/regexes as their source, Sets/Maps as arrays
function stable(value: unknown): string {
  if (typeof value === 'function' || value instanceof RegExp) return JSON.stringify(String(value))
  if (value instanceof Set) return stable([...value])
  if (value instanceof Map) return stable([...value.entries()])
  if (Array.isArray(value)) return \`[\${value.map(stable).join(',')}]\`
  if (value && typeof value === 'object') {
    return \`{\${Object.keys(value).sort().map((key) => \`\${JSON.stringify(key)}:\${stable((value as Record<string, unknown>)[key])}\`).join(',')}}\`
  }
  return JSON.stringify(value) ?? 'null'
}
const hash = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 16)

// drop comment-only lines and whitespace. only whole-line comments, a trailing // could be inside a string
const normalizeSource = (source: string) =>
  source
    .replace(/^\\s*\\/\\*[\\s\\S]*?\\*\\/\\s*$/gm, '')
    .split('\\n')
    .filter((line) => !/^\\s*\\/\\//.test(line))
    .join('\\n')
    .replace(/\\s+/g, ' ')

export function engineFingerprint(): string {
  const parts = ENGINE_FILES.map((file) => \`\${file}:\${normalizeSource(readFileSync(new URL(file, ROOT), 'utf8'))}\`)
  for (const [name, module, tables] of MIXED_MODULES) {
    const exported = Object.fromEntries(Object.entries(module).filter(([key]) => !tables.includes(key)))
    parts.push(\`\${name}:\${normalizeSource(stable(exported))}\`)
  }
  // single helpers from otherwise per-item modules that damage.ts calls directly
  parts.push(\`helpers:\${normalizeSource([scopeApplies, perkAppliesTo].map(String).join('|'))}\`)
  return hash(parts.join('\\n'))
}

// one mod/arcane as the optimizer and calc see it: data + what it parses to at max rank + its set bonus
const upgradeHashes = new Map<string, string>()
function upgradeFingerprint(upgrade: Mod | Arcane, rank: number): string {
  const key = \`\${upgrade.uniqueName}@\${rank}\`
  let cached = upgradeHashes.get(key)
  if (!cached) {
    const modSet = 'modSet' in upgrade && upgrade.modSet ? MOD_SETS[upgrade.modSet] ?? null : null
    cached = hash(stable({
      upgrade,
      parsed: parseUpgrade(upgrade.levelStats, rank),
      stacks: [true, false].map((isMelee) => defaultConditionalStacks(upgrade.levelStats, rank, { isMelee, bodyShots: true })),
      raisesFireRate: raisesFireRate(upgrade.levelStats, rank),
      utility: [utilityValue(upgrade.levelStats, rank, false), utilityValue(upgrade.levelStats, rank, true)],
      modSet,
    }))
    upgradeHashes.set(key, cached)
  }
  return cached
}

// seeds (builds pasted in from the Compare tab) are part of the weapon's inputs, so adding one reruns just that weapon.
// the key is only there when a weapon has seeds, so every other fingerprint stays the same
export function weaponFingerprint(weapon: Weapon, seeds: SeedBuild[] = []): string {
  return hash(stable({
    ...(seeds.length ? { seeds } : {}),
    // only weapons in the Primary Compression table get the key, so the rest keep their fingerprints
    ...(COMPRESSION[weapon.name] ? { compression: COMPRESSION[weapon.name] } : {}),
    weapon,
    maxCombo: maxComboFor(weapon.name),
    heavyCombo: heavyComboFor(weapon.name),
    passives: passivesFor(weapon.name),
    bonusElement: hasBonusElement(weapon.name),
    exalted: exaltedRuleFor(weapon),
    shellReload: SHELL_BY_SHELL_RELOAD[weapon.name] ?? null,
    incarnon: getIncarnonTiers(weapon.name),
    conditionOverload: weapon.attacks.map((attack) => resolveCoBehavior(weapon, attack)),
    mods: getCompatibleMods(weapon).map((mod) => upgradeFingerprint(mod, mod.fusionLimit)),
    arcanes: getCompatibleArcanes(weapon).map((arcane) => upgradeFingerprint(arcane, arcane.levelStats.length - 1)),
  }))
}
`,a=`// the About page's write-ups, biggest algorithm first. each one cites the code it describes (sources), and
// src/about/verified.json holds the hash of that code from the last time the write-up was checked against it. edit the
// code and the page marks the write-up out of date until it's reread, fixed and restamped (npm run about:stamp).
// {{file#NAME}} pulls a constant's value straight out of the source, so numbers never go stale on their own.
// math is KaTeX. complexity uses: C = one damage calc, |P| = mod pool size, S = mod slots, B = beam width
import type { SourceRef } from './sync'

export interface Equation {
  name: string
  tex: string // display math
  complexity?: string // inline math, without $
  note?: string
}
export interface Algorithm {
  id: string
  title: string
  where: string // the page(s) it powers
  summary: string
  complexity: string // overall, inline math
  sources: SourceRef[]
  steps: string[] // plain text, $...$ for inline math
  equations: Equation[]
}

const OPT = 'src/optimizer/optimize.ts'
const SIM = 'src/calc/simulate.ts'
const DMG = 'src/calc/damage.ts'

export const ALGORITHMS: Algorithm[] = [
  {
    id: 'leaderboard',
    title: 'Leaderboard rebuild',
    where: 'Leaderboard, Compare, Data Analysis',
    summary: 'Precomputes the best build for every weapon attack on every ranking, offline, and only redoes the weapons whose inputs changed.',
    complexity: String.raw\`O\\!\\left(\\frac{|W_s|\\,\\bar A\\,|\\mathcal B|\\;T_{opt}}{p}\\right)\`,
    sources: [
      { file: 'scripts/build-leaderboard.ts', symbol: 'main' },
      { file: 'scripts/build-leaderboard.ts', symbol: 'runShard' },
      { file: 'scripts/build-leaderboard.ts', symbol: 'writeFile' },
      { file: 'scripts/leaderboardFingerprint.ts' },
      { file: 'src/optimizer/leaderboardWeapon.ts', symbol: 'optimizeWeapon' },
      { file: 'src/optimizer/objectives.ts', symbol: 'BOARDS' },
    ],
    steps: [
      'Fingerprint: one engine hash over the generic code every weapon runs through (comment lines and whitespace stripped), and one hash per weapon over its own data plus the outputs of every lookup it hits (the parsed mods it can equip, its passives, Incarnon perks, stance...).',
      'A weapon is stale when the engine hash or its own hash changed (or it was named with --only). --boards limits the re-optimizing to some boards and keeps the rest from the old file.',
      'Stale weapons are dealt round-robin to one worker process per core (max 12), each running a pre-bundled copy of the script.',
      'Per weapon: every attack that does damage (reload/expiry/turret events and headshot-only parts skipped) × every board goes through the build optimizer. Heavies and gated alt-fires skip the fire-rate boards. Guns on the Single damage instance board are scored on headshots.',
      'On fire-rate boards, the build found without fire-rate mods replaces the normal one if it scores higher (the search is a heuristic).',
      'Whole shots ("A + B") are re-scored with every build found for their parts, plus any saved Compare seeds; a seed only replaces the entry if it scores higher.',
      'Kept and new entries are merged, each board is sorted by score, and the file is written compact: mods, arcanes and weapons become indexes into shared tables.',
    ],
    equations: [
      {
        name: 'Total work',
        tex: String.raw\`T = \\frac{1}{p}\\sum_{w \\in W_s}\\;\\sum_{a \\in A_w}\\;\\sum_{b \\in \\mathcal{B}} T_{opt}(w, a, b)\`,
        complexity: String.raw\`O\\!\\left(|W_s|\\,\\bar A\\,|\\mathcal B|\\,T_{opt} / p\\right)\`,
        note: 'W_s = stale weapons, A_w = the weapon\\'s attacks, 𝓑 = boards (11 today), p = worker processes. T_opt is the build optimizer below.',
      },
      {
        name: 'Staleness test',
        tex: String.raw\`\\text{stale}(w) \\iff H_{engine} \\neq H'_{engine} \\;\\lor\\; H_w \\neq H'_w \\;\\lor\\; w \\in \\text{--only}, \\qquad H = \\operatorname{sha256}(\\cdot)_{[0,16)}\`,
        complexity: String.raw\`O(|\\text{source}| + \\sum_w |\\text{lookups}_w|)\`,
      },
      {
        name: 'Fire-rate fallback and seeds',
        tex: String.raw\`E_b(w,a) = \\operatorname*{arg\\,max}_{x \\,\\in\\, \\{x_b,\\; x_{b\\text{-nofr}}\\} \\,\\cup\\, \\{\\text{seed}(s) : s \\in \\text{parts}(a) \\cup \\text{seeds}\\}} f_b(x)\`,
        complexity: String.raw\`O(|\\text{seeds}|\\cdot C)\`,
      },
      {
        name: 'Merge and sort',
        tex: String.raw\`\\text{board}_b = \\operatorname{sort}_{\\downarrow f}\\big(\\text{kept}_b \\cup \\text{new}_b\\big)\`,
        complexity: String.raw\`O\\!\\left(\\textstyle\\sum_b N_b \\log N_b\\right)\`,
      },
    ],
  },
  {
    id: 'optimizer',
    title: 'Build optimizer (beam search)',
    where: 'Leaderboard, Compare, Rivens, Damage Cap, Boss board',
    summary: 'Finds a strong 8-mod build plus arcane, Incarnon evolutions, bonus element and element order for one attack and one goal. A heuristic, not an exhaustive search: checked against hand-built meta builds.',
    complexity: String.raw\`O\\big((SB|P| + 2RS|P| + 2|\\mathcal A| + 2\\textstyle\\sum_t|E_t| + 120)\\,C\\,(1+g)\\big)\`,
    sources: [
      { file: OPT, symbol: 'optimizeAttack' },
      { file: OPT, symbol: 'SLOT_COUNT' },
      { file: OPT, symbol: 'BEAM_WIDTH' },
      { file: OPT, symbol: 'MAX_SWAP_PASSES' },
      { file: OPT, symbol: 'MAX_ELEMENT_ORDERS' },
      { file: OPT, symbol: 'critViolation' },
      { file: 'src/optimizer/modPool.ts', symbol: 'damageModPool' },
      { file: 'src/optimizer/modPool.ts', symbol: 'usefulEffect' },
    ],
    steps: [
      'Pool: one copy per mod name (highest rank), only mods with an effect that can raise this goal\\'s number (fire rate / magazine / reload only on time-based goals, banes only against their faction, weak point mods and Acuity only on headshots, heavy-only stats only on heavies).',
      'Bonus element (Kuva / Tenet / Coda): each element tried at the max value.',
      'Beam search: grow builds one mod at a time, keep the best B = {{src/optimizer/optimize.ts#BEAM_WIDTH}} distinct mod sets at each size, for S = {{src/optimizer/optimize.ts#SLOT_COUNT}} slots. Incompatible pairs (same family, exclusive mods) are skipped.',
      'Then, twice over: re-pick the bonus element, pick the best evolution per Incarnon tier, pick the arcane (ties go to the one with headshot / reload value), single-mod swaps until nothing improves (up to {{src/optimizer/optimize.ts#MAX_SWAP_PASSES}} passes), and try every slot order of the elemental mods (they combine in slot order), up to {{src/optimizer/optimize.ts#MAX_ELEMENT_ORDERS}} orders.',
      'Against a real target (faction or headshot), the whole search runs again on the plain pool and the better one wins: a bane can crowd out a better crit build early.',
      'Status-gated evolutions that weren\\'t picked (Furis\\'s Stormburst needs Electricity) each get a full search with the evolution locked in, since the mods never had a reason to add the status it needs.',
    ],
    equations: [
      {
        name: 'Search score',
        tex: String.raw\`s(M) = f(M)\\,\\Big(1 - 10^{-7}\\!\\sum_{m \\in M}\\kappa(m)\\Big)\\cdot\\begin{cases}1 & \\mu = 0\\\\[2pt] 10^{-3}\\,e^{-20\\mu} & \\mu > 0\\end{cases},\\qquad \\mu = \\max(0, c - c_{max}) + \\max(0, c_{min} - c)\`,
        complexity: 'O(C)',
        note: 'f = the goal\\'s score from one damage calc, κ = 1 per catch (conditional or Niche mod) so ties go to the cleaner mod, μ = how far the crit chance c is outside the Compare tab\\'s crit limits. The penalty is steep but smooth so the search still has a slope.',
      },
      {
        name: 'Beam step',
        tex: String.raw\`\\mathcal{B}_{k+1} = \\operatorname{top}_{B}\\Big\\{\\, M \\cup \\{m\\} \\;:\\; M \\in \\mathcal{B}_k,\\; m \\in P,\\; m \\perp M \\,\\Big\\},\\qquad B = {{src/optimizer/optimize.ts#BEAM_WIDTH}},\\; k < S = {{src/optimizer/optimize.ts#SLOT_COUNT}}\`,
        complexity: String.raw\`O(S\\,B\\,|P|\\cdot C)\`,
        note: 'Builds are keyed by their sorted mod set, so the same set reached in two orders counts once.',
      },
      {
        name: 'Swap pass',
        tex: String.raw\`M \\leftarrow M[i \\mapsto m] \\;\\text{ if }\\; s(M[i \\mapsto m]) > s(M)(1 + 10^{-9}),\\qquad i \\le S,\\; m \\in P,\\; \\le R = {{src/optimizer/optimize.ts#MAX_SWAP_PASSES}} \\text{ passes}\`,
        complexity: String.raw\`O(R\\,S\\,|P|\\cdot C)\`,
      },
      {
        name: 'Evolutions, arcane, element order',
        tex: String.raw\`e_t^* = \\operatorname*{arg\\,max}_{e \\in E_t \\cup \\{\\varnothing\\}} s(M \\mid e),\\quad a^* = \\operatorname*{arg\\,max}_{a \\in \\mathcal{A} \\cup \\{\\varnothing\\}} s(M \\mid a),\\quad \\sigma^* = \\operatorname*{arg\\,max}_{\\sigma \\in \\mathfrak{S}_k} s(\\sigma M)\`,
        complexity: String.raw\`O\\big((\\textstyle\\sum_t |E_t| + |\\mathcal A| + \\min(k!, 120))\\cdot C\\big)\`,
        note: 'k = elemental mods in the build, so 5 elements = 120 orders.',
      },
      {
        name: 'Retries',
        tex: String.raw\`x^* = \\operatorname*{arg\\,max}\\big\\{x,\\; x_{\\text{plain pool}},\\; x_{e_1 \\text{ locked}},\\dots, x_{e_g \\text{ locked}}\\big\\}\`,
        complexity: String.raw\`O\\big((1 + [\\text{real target}] + g)\\,T_{opt}\\big)\`,
        note: 'g = status-gated evolutions not picked by the first search.',
      },
    ],
  },
  {
    id: 'damage-cap',
    title: 'Damage Cap ladder',
    where: 'Damage Cap',
    summary: 'How much has to stack up for one hit to pass the damage limit, as a ladder of steps that each add one layer and re-optimize for the biggest single instance.',
    complexity: String.raw\`O\\big(8\\,T_{opt} + |F|\\,K\\,C + \\tbinom{n+4}{5}\\, T_{frame}\\big)\`,
    sources: [
      { file: 'src/optimizer/damageCap.ts', symbol: 'runCapLadder' },
      { file: 'src/optimizer/damageCap.ts', symbol: 'combos' },
      { file: 'src/optimizer/damageCap.ts', symbol: 'searchFrames' },
      { file: 'src/optimizer/damageCap.ts', symbol: 'searchShards' },
      { file: 'src/optimizer/damageCap.ts', symbol: 'searchPriming' },
      { file: 'src/optimizer/damageCap.ts', symbol: 'searchAllies' },
      { file: 'src/optimizer/frameBuild.ts', symbol: 'optimizeFrameMods' },
    ],
    steps: [
      '1. Mods, weapon arcane and Incarnon, optimized for the peak hit against a level 9,999 Steel Path Heavy Gunner. 2. + headshot (never on AoE, off for melee unless asked).',
      '3. + solo priming: the statuses the build applies itself plus a companion\\'s (Diriga stands in for every primer). Companion picked, mods re-optimized for those debuffs, companion picked again on the new build.',
      '4. + Warframe arcanes and 5. + Archon Shards on "any Warframe" with nothing cast: every Tauforged 5-shard multiset, each with a quick frame mod search, then the best few searched properly.',
      '6. + your Warframe: every frame\\'s own modeled abilities (every combination of one option per ability, capped at 400) plus one Helminth subsume, screened at a reference Strength; the shortlist gets a real frame mod build (beam search over 8 slots + aura + exilus, sets placed whole) and the weapon mods re-optimized.',
      '7. + enemy debuffs maxed, 8. + allies: one teammate at a time, the frame that adds the most on top.',
    ],
    equations: [
      {
        name: 'Peak hit (what each step maximizes)',
        tex: String.raw\`\\text{peak} = D_{\\text{vs target, no crit}}\\cdot\\big(1 + \\lceil c\\rceil (M - 1)\\big)\\cdot \\text{beamMerge}\\cdot\\text{batteryScale}\`,
        complexity: 'O(C)',
        note: 'The top crit tier, not the average: the cap is about the biggest number one hit can show.',
      },
      {
        name: 'Ability setups per frame',
        tex: String.raw\`|\\text{setups}| = \\min\\Big(400,\\; \\prod_{g \\in G} \\big(|O_g| + [g \\text{ optional}]\\big)\\Big) \\times |\\text{subsumes}|\`,
        complexity: String.raw\`O(|F|\\cdot K \\cdot C)\`,
        note: 'F = frames, K = setups per frame after the cap.',
      },
      {
        name: 'Archon Shard sets',
        tex: String.raw\`\\#\\text{multisets} = \\binom{n + 5 - 1}{5}\`,
        complexity: String.raw\`O\\big(\\tbinom{n+4}{5}\\, T_{frame}\\big)\`,
        note: 'n = shard options that can matter for this weapon class, 5 slots, order doesn\\'t matter.',
      },
      {
        name: 'Frame mod beam',
        tex: String.raw\`\\mathcal{L}_{r+1} = \\operatorname{top}_{6}\\big\\{\\, \\text{place}(L, m) : L \\in \\mathcal{L}_r,\\; m \\in P_f \\cup \\text{sets}\\,\\big\\},\\quad r \\le 8 + \\text{aura} + 1\`,
        complexity: String.raw\`O\\big((8 + a)\\cdot 6 \\cdot |P_f| \\cdot C\\big)\`,
      },
    ],
  },
  {
    id: 'riven',
    title: 'Riven god-roll search',
    where: 'Rivens',
    summary: 'Which riven stats raise an attack the most once the other 7 mods are rebuilt around it. Every candidate riven goes through the full optimizer with the riven locked in.',
    complexity: String.raw\`O\\big((1 + |S_r| + 84 + |K_r|)\\,T_{opt}\\big)\`,
    sources: [{ file: 'src/optimizer/rivenSearch.ts', symbol: 'searchRivens' }, { file: 'src/optimizer/rivenSearch.ts', symbol: 'rollRiven' }],
    steps: [
      'Baseline: the attack\\'s best build with no riven.',
      'Screen: each stat alone on a 2-stat + curse riven, at the max or average roll, full optimizer run each.',
      'Shortlist: at most the 3 best elements (a second element mostly just combines with the first) and the best of everything else, 8 in all.',
      'Combine: every 2- and 3-stat riven from the shortlist with at most one spliced stat. Each also tries the builds already found for its smaller parts with the riven dropped in, so a 3-stat riven never scores below its 2-stat parts.',
      'Curses: the best riven\\'s build with each curse swapped in, same positives, to see which curses cost nothing.',
    ],
    equations: [
      {
        name: 'Candidates',
        tex: String.raw\`|R| = \\binom{8}{2} + \\binom{8}{3} = 28 + 56 = 84 \\;(\\text{minus rivens with two spliced stats})\`,
        complexity: String.raw\`O(84\\, T_{opt})\`,
      },
      {
        name: 'Riven value',
        tex: String.raw\`v(r) = \\frac{\\max\\big(f(x^*_r),\\; \\max_{r' \\subset r} f(x^*_{r'} \\oplus r)\\big)}{f(x^*_\\varnothing)} - 1\`,
        complexity: String.raw\`O(2^{|r|}\\,C)\`,
        note: 'x*_r = the optimizer\\'s build with riven r locked, x ⊕ r = an existing build with r dropped into its weakest slot.',
      },
    ],
  },
  {
    id: 'boss',
    title: 'Boss time-to-kill and damage attenuation',
    where: 'Leaderboard (Boss board)',
    summary: 'Ranks builds by seconds to strip a Steel Path boss\\'s shields and health, solo, with the wiki\\'s damage attenuation model on top of normal damage.',
    complexity: String.raw\`O\\big(T_{opt}^{est} + \\tfrac{T_{max}}{\\Delta t}\\,\\bar n\\big)\`,
    sources: [
      { file: 'src/optimizer/bossLeaderboard.ts', symbol: 'optimizeWeaponBoss' },
      { file: 'src/optimizer/bossLeaderboard.ts', symbol: 'BOSS_ATTENUATION' },
      { file: SIM, symbol: 'attenuationBins' },
      { file: SIM, symbol: 'attenuatedTimeToKill' },
      { file: SIM, symbol: 'BIN' },
      { file: SIM, symbol: 'LAMBDA' },
      { file: DMG, symbol: 'timeToReach' },
      { file: DMG, symbol: 'calculate' },
      { file: DMG, symbol: 'SHOTGUN_COMPENSATION' },
    ],
    steps: [
      'The search scores builds on a quick estimate (attenuation applied to the average rate), then the winner is re-scored with the exact bin simulation. Score = 1 / seconds.',
      'Per trigger, Reinhard tone mapping caps one shot\\'s damage softly at MDPT; a bucket B tracks the mapped damage of the last second and scales everything down by MDPS / B when it\\'s over.',
      'The caps are shares of the boss\\'s max health (health only, no shields): {{src/optimizer/bossLeaderboard.ts#BOSS_ATTENUATION}}. The per-trigger 5% is on both Hemocyte\\'s and Lephantis\\'s wiki pages; the per-second 20% only on Hemocyte\\'s. Multi-pellet weapons get {{src/calc/damage.ts#SHOTGUN_COMPENSATION}}× the per-trigger cap (the standardized model\\'s ShotgunCompensation; where it applies is my guess). The boards are marked untested.',
      'Steps of Δt = {{src/calc/simulate.ts#BIN}} s out to 600 s. DoT ticks go into the bucket but skip the per-trigger step. Merged attacks (Onos\\'s beam + blast) map each part\\'s hits separately.',
      'Without attenuation, time to reach an amount: secant steps from the steady rate, then a few halvings over the killing shot\\'s interval. Past 10 minutes it\\'s extrapolated so weak builds still have a slope.',
    ],
    equations: [
      {
        name: 'Per-trigger mapping (Reinhard)',
        tex: String.raw\`\\hat d = \\frac{M_t\\, D}{D + M_t},\\qquad D = \\bar h\\cdot\\text{multishot},\\qquad M_t = \\text{perTrigger}\\cdot HP\\cdot k_{sg},\\quad k_{sg} = \\begin{cases}{{src/calc/damage.ts#SHOTGUN_COMPENSATION}} & \\text{base multishot} > 1\\\\ 1 & \\text{otherwise}\\end{cases}\`,
        complexity: 'O(1)',
      },
      {
        name: 'Rate bucket (damped follower)',
        tex: String.raw\`B'' + 2\\lambda B' + \\lambda^2 B = \\lambda^2 Q,\\quad \\lambda = {{src/calc/simulate.ts#LAMBDA}},\\qquad d_{out} = \\hat d\\cdot\\min\\!\\Big(1, \\frac{M_s}{B}\\Big),\\quad M_s = \\text{perSecond}\\cdot HP\`,
        complexity: String.raw\`O(T_{max}/\\Delta t)\`,
        note: 'Q = mapped damage over the last 1 s. B jumps up to Q when Q > B and decays toward it otherwise.',
      },
      {
        name: 'Time to reach (no attenuation)',
        tex: String.raw\`t_{n+1} = t_n + \\frac{A - D(t_n)}{\\dot D},\\;\\; n < N_{sec};\\qquad \\text{then bisect } [t_k - \\tfrac1r,\\, t_k] \\text{ five times}\`,
        complexity: String.raw\`O\\big((N_{sec} + 5)\\cdot N_{shots}\\big)\`,
      },
    ],
  },
  {
    id: 'compare',
    title: 'Compare build paths',
    where: 'Compare › Build Paths',
    summary: 'Runs the build optimizer once per path (a set of rules: locked or banned mods, a riven, a fixed arcane or evolution, crit limits) per goal, so different build philosophies can be compared side by side.',
    complexity: String.raw\`O(|\\text{paths}|\\cdot|\\text{boards}|\\cdot T_{opt})\`,
    sources: [{ file: 'src/optimizer/compare.ts', symbol: 'runPath' }, { file: 'src/optimizer/compare.ts', symbol: 'constraintsFor' }],
    steps: [
      'Each path becomes optimizer constraints: locked mods (a riven too), excluded mods, locked or excluded arcane and evolutions, min / max crit chance.',
      '"Thorough" doubles the beam width (8 → 16). Runs in a Web Worker so the page stays responsive.',
    ],
    equations: [
      {
        name: 'One cell',
        tex: String.raw\`x_{p,b} = \\operatorname{optimize}\\big(w, a, b \\mid \\text{constraints}(p)\\big),\\qquad B = \\begin{cases}16 & \\text{thorough}\\\\ 8 & \\text{otherwise}\\end{cases}\`,
        complexity: String.raw\`O(S\\,B\\,|P|\\cdot C)\`,
      },
    ],
  },
  {
    id: 'advisor',
    title: 'Build Advisor',
    where: 'Calculator',
    summary: 'How much each stat is worth to this exact build right now, the best real mod for it, which slots carry the least, and greedy build paths. Everything is measured by running the calc with one more or one less mod.',
    complexity: String.raw\`O\\big((|\\Lambda| + S + |P| + 3 S |P|)\\cdot C\\big)\`,
    sources: [
      { file: 'src/calc/advisor.ts', symbol: 'advise' },
      { file: 'src/calc/advisor.ts', symbol: 'greedyPath' },
      { file: 'src/calc/advisor.ts', symbol: 'pathWithArcane' },
      { file: 'src/calc/advisor.ts', symbol: 'buildPaths' },
      { file: 'src/calc/advisor.ts', symbol: 'rankingScorer' },
      { file: 'src/calc/advisor.ts', symbol: 'DOT_WEIGHT_OFF_DOT_WEAPON' },
    ],
    steps: [
      'Lever weights: each stat (damage, crit, each element, faction...) is added at one typical mod\\'s worth (or the biggest mod still available for it) and the score change is read off.',
      'Slot values: the build with each mod vs without it.',
      'Best and cheapest real mod per stat: added to a free slot, or swapped for the weakest slot when the build is full; cheapest = most gain per capacity point.',
      'Over-stacking: a stat with 2+ mods where swapping one of them for the best mod of another stat makes the build bigger.',
      'Build paths: greedy, one slot at a time, always the mod that adds the most right now; then the best arcane, then the mods again with it in, until it settles. Three forks: pure greedy, crit only, status only.',
      'Status DoTs count at {{src/calc/advisor.ts#DOT_WEIGHT_OFF_DOT_WEAPON}}× in the rankings unless the weapon is built for them (25%+ base status, a beam, or forced procs).',
    ],
    equations: [
      {
        name: 'Lever weight',
        tex: String.raw\`w_\\ell = \\frac{f(M \\oplus \\delta_\\ell) - f(M)}{f(M)}\`,
        complexity: String.raw\`O(|\\Lambda|\\cdot C)\`,
        note: 'Damage is a product of buckets, so adding to a bucket that\\'s already big moves the product less: that\\'s over-stacking in numbers.',
      },
      {
        name: 'Slot contribution',
        tex: String.raw\`\\gamma_m = \\frac{f(M)}{f(M \\setminus \\{m\\})} - 1\`,
        complexity: String.raw\`O(S\\cdot C)\`,
      },
      {
        name: 'Greedy path',
        tex: String.raw\`M_{k+1} = M_k \\cup \\Big\\{\\operatorname*{arg\\,max}_{m \\in P,\\, m \\perp M_k} f(M_k \\cup \\{m\\})\\Big\\}\`,
        complexity: String.raw\`O(S\\,|P|\\cdot C)\\text{ per pass}\`,
      },
    ],
  },
  {
    id: 'damage',
    title: 'Damage calculation',
    where: 'Every page',
    summary: 'One attack, one build, one target: base damage through mods, element combining, quantization, crit, multishot, armor and faction, status procs and DoTs, then magazine and reload. Everything else on the site calls this.',
    complexity: String.raw\`O(L + T + N_{shots})\`,
    sources: [
      { file: DMG, symbol: 'calculateOnce' },
      { file: DMG, symbol: 'calculate' },
      { file: DMG, symbol: 'quantize' },
      { file: 'src/calc/target.ts', symbol: 'scaleArmor' },
      { file: 'src/calc/target.ts', symbol: 'armorDamageMultiplier' },
      { file: 'src/calc/constants.ts', symbol: 'COMBINED_ELEMENTS' },
    ],
    steps: [
      'Collect every mod, arcane, passive, Warframe ability, combo and Incarnon effect into stat buckets. Conditionals at the scenario\\'s stacks (per-shell stacks like Felarx\\'s Mounting Momentum capped at the base form\\'s magazine).',
      'Damage types: physical types scaled by their own mods, elements added in slot order and combined two at a time, each final type quantized to 1/32 of base damage.',
      'Crit (tiers above 100%, headcrit, Cold\\'s crit damage), faction, multishot, fire rate.',
      'Target: armor (scaled by level, clamped, stripped by Heat / Corrosive / Corrosive Projection), faction weaknesses, headshot, vulnerability.',
      'Status: procs per second split by each type\\'s share of damage, DoT ticks per proc, Heat stacks refreshing together.',
      'Magazine and reload (shell-by-shell where it applies), Incarnon battery and refill, then the sustained and time-window numbers via the shot simulator.',
    ],
    equations: [
      {
        name: 'Quantization',
        tex: String.raw\`q(p) = \\frac{\\operatorname{sgn}(p)\\,\\big\\lfloor 32|p| + 0.5\\big\\rfloor}{32},\\qquad D_t = q\\!\\left(p_t\\right)\\cdot D_{base}(1 + \\beta)\`,
        complexity: 'O(T)',
        note: 'p_t = the type\\'s share of base damage after its mods, β = base damage mods (Serration...).',
      },
      {
        name: 'Crit',
        tex: String.raw\`\\bar m_{crit} = 1 + c\\,(M - 1),\\qquad m_{\\text{low tier}} = 1 + \\lfloor c\\rfloor (M-1),\\qquad m_{\\text{high tier}} = 1 + \\lceil c\\rceil (M-1)\`,
        complexity: 'O(1)',
        note: 'Above 100% crit the lowest tier is the "normal" hit and the next tier up is the "crit". M includes headcrit (×2 on the base) and Cold\\'s bonus.',
      },
      {
        name: 'Armor',
        tex: String.raw\`A(q) = \\operatorname{clamp}\\!\\Big(A_0\\big(\\ell + (h - \\ell)\\,s\\big),\\,200,\\,2700\\Big),\\;\\; \\ell = 1 + 0.005\\,q^{1.75},\\; h = 1 + 0.4\\,q^{0.75},\\; s = \\operatorname{smoothstep}\\!\\Big(\\tfrac{q - 70}{10}\\Big)\`,
        complexity: 'O(1)',
      },
      {
        name: 'Armor damage multiplier',
        tex: String.raw\`\\text{DM}(A) = 1 - 0.9\\sqrt{A / 2700}\`,
        complexity: 'O(1)',
      },
      {
        name: 'Status procs',
        tex: String.raw\`\\lambda_t = s \\cdot n_{hit} \\cdot r \\cdot \\frac{w_t}{\\sum_u w_u}\`,
        complexity: 'O(T)',
        note: 's = status chance, n_hit = hits per attack, r = fire rate, w_t = the type\\'s modded damage (separate elements excluded).',
      },
    ],
  },
  {
    id: 'simulate',
    title: 'Time windows and sustained DPS',
    where: 'Calculator, Leaderboard',
    summary: 'Damage over a stretch of time: shots on the fire rate, magazine and reload, status procs ticking on their own clocks. A deterministic expected version for the optimizer and a Monte Carlo version for the bad-luck / good-luck range.',
    complexity: String.raw\`O(N_{shots}\\cdot T\\cdot \\bar k)\`,
    sources: [{ file: SIM, symbol: 'shotTimes' }, { file: SIM, symbol: 'expectedDamage' }, { file: SIM, symbol: 'simulateDamage' }, { file: SIM, symbol: 'heatExpiries' }, { file: SIM, symbol: 'ticksInside' }],
    steps: [
      'Shot times from t = 0: a full magazine at the fire rate, then a reload, and so on, until the window closes.',
      'Each shot adds its expected direct damage and, per status type, its expected procs\\' DoT ticks that land inside the window (and before the proc expires).',
      'Heat: every stack refreshes on a new Heat proc, so stacks die together only when no new Heat proc lands within one duration.',
      'Monte Carlo: crits and procs rolled per pellet with a seeded mulberry32 RNG, runs capped at ~400k pellet rolls (60–300 runs).',
    ],
    equations: [
      {
        name: 'Shot times',
        tex: String.raw\`t_{k+1} = t_k + \\frac1r + R\\cdot\\big[(k+1) \\bmod m = 0\\big]\`,
        complexity: String.raw\`O(N_{shots})\`,
      },
      {
        name: 'Expected damage in a window',
        tex: String.raw\`E[D(T)] = \\sum_{k} \\Big(\\bar h + \\sum_{t} \\pi_t\\, \\bar\\tau_t \\cdot \\#\\{\\, j : t_k + \\phi_t + j < \\min(T,\\; t_k + d_t) \\,\\}\\Big)\`,
        complexity: String.raw\`O(N_{shots}\\cdot T\\cdot \\bar k)\`,
        note: 'π_t = expected procs of type t per shot, τ̄_t = average tick, φ_t = first tick delay, d_t = duration, k̄ = ticks per proc.',
      },
    ],
  },
  {
    id: 'incarnon',
    title: 'Incarnon battery and refill',
    where: 'Calculator, Leaderboard',
    summary: 'Incarnon forms fire a fixed battery of charges, then have to be refilled from the normal form with weak point hits. The refill counts as the form\\'s "reload".',
    complexity: 'O(1)',
    sources: [{ file: DMG, symbol: 'INCARNON_SWAP_RELOADS' }, { file: DMG, symbol: 'calculateOnce' }, { file: 'src/data/reloads.ts', symbol: 'SHELL_BY_SHELL_RELOAD' }],
    steps: [
      'Charges come back per weak point hit (wiki: "each charge producing 3 rounds" on Vasto). Every normal-form bullet is assumed to land on a weak point (Torid / Angstrum count direct hits): the best case.',
      'Hits land at the normal form\\'s own rate (its fire rate mods count) times its projectiles, reloads included.',
      'Switching forms takes {{src/calc/damage.ts#INCARNON_SWAP_RELOADS}}× the base form\\'s reload each way (reload speed mods don\\'t shorten it).',
      'Ammo Efficiency (mods, arcanes, evolutions) never stretches the charges: they aren\\'t ammo.',
      'The refill\\'s reloads are the base form\\'s: shell-by-shell weapons (Felarx, Strun) reload shell by shell with the base form\\'s modded magazine. The swap uses the listed reload stat.',
    ],
    equations: [
      {
        name: 'Refill time',
        tex: String.raw\`t_{refill} = \\frac{Q / \\rho}{(1 + g)\\; r_{norm}\\; n_{proj}} + t_{reloads} + 2\\cdot {{src/calc/damage.ts#INCARNON_SWAP_RELOADS}}\\cdot R_{base}\`,
        complexity: 'O(1)',
        note: 'Q = charges, ρ = rounds per hit, g = charge gain bonus (Incarnon Efficiency), t_reloads = the base form\\'s own reloads while filling (shell by shell where it applies), R_base = the listed reload.',
      },
      {
        name: 'Sustained DPS of the form',
        tex: String.raw\`\\text{DPS} = \\frac{D_{battery}}{t_{fire} + t_{refill}}\`,
        complexity: 'O(1)',
      },
    ],
  },
  {
    id: 'percentile',
    title: 'Weapon standing (percentiles)',
    where: 'Compare › Weapons, Rivens',
    summary: 'Where a weapon\\'s base numbers sit among its own subtype (shotguns vs shotguns, glaives vs glaives), from the unmodded attack data.',
    complexity: String.raw\`O(n)\\text{ per stat}\`,
    sources: [{ file: 'src/calc/weaponProfile.ts', symbol: 'standing' }, { file: 'src/calc/weaponProfile.ts', symbol: 'MIN_GROUP' }, { file: 'src/calc/weaponProfile.ts', symbol: 'rankGroup' }],
    steps: [
      'Each weapon counts once per pool, by its first attack (or first Incarnon attack for the Incarnon pool). Exalted weapons are left out.',
      'A subtype with fewer than {{src/calc/weaponProfile.ts#MIN_GROUP}} weapons falls back to the whole category.',
      'Ties count half, so a value most weapons share reads as typical, not the lowest. "Highest" / "lowest" only when few weapons share the value.',
    ],
    equations: [
      {
        name: 'Share beaten',
        tex: String.raw\`\\text{beats}(v) = \\frac{\\#\\{u < v\\} + \\max(0,\\, \\#\\{u = v\\} - 1)/2}{n - 1}\`,
        complexity: 'O(n)',
        note: 'Flipped (counts u > v) for stats where lower is better, like reload time.',
      },
    ],
  },
  {
    id: 'enervate',
    title: 'Secondary Enervate average crit',
    where: 'Calculator, Data Analysis',
    summary: 'Enervate adds +10% crit per hit and resets after 6 big crits. The calc averages crit over a whole build-up-and-reset cycle as a small Markov chain.',
    complexity: String.raw\`O(K\\cdot J)\`,
    sources: [{ file: DMG, symbol: 'enervateAverageCrit' }],
    steps: [
      'State = (hit number k, big crits so far j). A big crit (orange or red) happens with chance crit − 100% once crit is past 100%.',
      'The 6th big crit ends the cycle. Run until the remaining probability mass is under 10⁻¹².',
    ],
    equations: [
      {
        name: 'Chain',
        tex: String.raw\`c_k = c_0 + 0.1k,\\quad p_k = \\operatorname{clamp}(c_k - 1, 0, 1),\\quad \\pi_{k+1,j} = \\pi_{k,j}(1 - p_k) + \\pi_{k,j-1}\\,p_k \\;\\; (j < 6)\`,
        complexity: String.raw\`O(K\\cdot J),\\; J = 6\`,
      },
      {
        name: 'Average crit',
        tex: String.raw\`\\bar c = \\frac{\\sum_k c_k \\sum_j \\pi_{k,j}}{\\sum_k \\sum_j \\pi_{k,j}}\`,
        complexity: 'O(K)',
        note: 'Past 200% every hit is a big crit, so it resets every 6 hits: (0 + 10 + … + 50%) / 6 = +25%.',
      },
    ],
  },
  {
    id: 'analysis',
    title: 'Data Analysis statistics',
    where: 'Experimental › Data Analysis',
    summary: 'Arsenal-wide summaries: medians, histograms, release-update buckets, Prime uplift and how well base stats predict leaderboard score.',
    complexity: String.raw\`O(n \\log n)\`,
    sources: [
      { file: 'src/components/DataExplorer.tsx', symbol: 'median' },
      { file: 'src/components/DataExplorer.tsx', symbol: 'spearman' },
      { file: 'src/components/DataExplorer.tsx', symbol: 'pickShot' },
      { file: 'src/components/DataExplorer.tsx', symbol: 'applyEvolutions' },
      { file: 'src/components/DataExplorer.tsx', symbol: 'ERA_SIZE' },
      { file: 'src/components/DataExplorer.tsx', symbol: 'rowsFor' },
    ],
    steps: [
      'Per weapon, one shot per attack mode (normal, alt-fire / special, Incarnon, melee heavy): merged parts summed, the hardest-hitting one when there are several.',
      'Incarnon weapons get the base-stat lines of the evolutions the leaderboard picked for that attack.',
      'Unmodded DPS: each weapon run through the damage calculation with no mods and no arcane, only its innate passives and those evolutions, sustained DPS on the neutral target (one whole heavy for melee heavies). The subtype section uses only this; the leaderboard section is the only place with modded builds.',
      'Release trends bucket the wiki\\'s "Introduced" update into groups of {{src/components/DataExplorer.tsx#ERA_SIZE}} updates.',
    ],
    equations: [
      {
        name: 'Median',
        tex: String.raw\`\\tilde x = \\begin{cases} x_{((n+1)/2)} & n \\text{ odd}\\\\ \\tfrac12\\big(x_{(n/2)} + x_{(n/2+1)}\\big) & n \\text{ even}\\end{cases}\`,
        complexity: String.raw\`O(n\\log n)\`,
      },
      {
        name: 'Spearman rank correlation',
        tex: String.raw\`\\rho = \\frac{\\sum_i (R_i - \\bar R)(S_i - \\bar S)}{\\sqrt{\\sum_i (R_i - \\bar R)^2 \\sum_i (S_i - \\bar S)^2}}\`,
        complexity: String.raw\`O(n\\log n)\`,
        note: 'R, S = ranks of the base stat and the score, ties share their average rank.',
      },
      {
        name: 'Prime uplift',
        tex: String.raw\`\\Delta = \\operatorname{median}_{(b,\\,p)}\\Big(\\frac{x_p}{x_b} - 1\\Big)\`,
        complexity: 'O(n log n)',
      },
    ],
  },
  {
    id: 'about-sync',
    title: 'This page\\'s sync check',
    where: 'About',
    summary: 'Every write-up here cites the functions it describes and is stamped with a hash of them. When the code changes, the write-up is flagged as out of date and the project\\'s checks fail until it\\'s reread and restamped.',
    complexity: String.raw\`O(|\\text{source}|)\`,
    sources: [{ file: 'src/about/sync.ts' }],
    steps: [
      'Each cited function is cut out of its file by bracket matching from its declaration; comment-only lines and whitespace are dropped so rewording a comment doesn\\'t count.',
      'Numbers written as placeholders are read out of the code when the page renders, so a changed constant updates itself.',
    ],
    equations: [
      {
        name: 'Stamp',
        tex: String.raw\`h = \\operatorname{FNV1a}_{32}\\Big(\\textstyle\\bigoplus_{s \\in \\text{sources}} \\operatorname{normalize}(\\operatorname{extract}(s))\\Big),\\qquad \\text{stale} \\iff h \\ne h_{verified}\`,
        complexity: String.raw\`O(|\\text{source}|)\`,
      },
    ],
  },
]
`,o=`// keeps the About page honest: every algorithm there names the code it describes (a file, or one function / const in it),
// and its write-up is stamped with a hash of that code (src/about/verified.json). change the code and the hash stops
// matching: the page flags the write-up as out of date and \`npm run check\` fails until it's reread and restamped
// (\`npm run about:stamp\`). numbers in the write-ups ({{file#NAME}}) are read straight out of the source, so a changed
// constant shows up without anyone touching the text. pure functions, the page and scripts/check-about.ts both use them

export interface SourceRef { file: string; symbol?: string }

// comment-only lines and whitespace don't count, same idea as the leaderboard fingerprint: rewording a comment isn't a code change
export function normalize(code: string): string {
  return code.split('\\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('//')).join('\\n').replace(/\\s+/g, ' ')
}

// one function / const out of a file: from its declaration to the brace that closes it (or the end of the line for a
// one-line const). null if it's gone, which counts as out of date too
export function extractSymbol(code: string, symbol: string): string | null {
  const start = code.search(new RegExp(\`(?:function\\\\*?|const|let|class|interface|type)\\\\s+\${symbol}\\\\b\`))
  if (start < 0) return null
  // walk brackets until a line break at depth 0 that doesn't continue the statement (a line ending in \`=\`, \`=>\`, \`,\`...)
  let depth = 0
  for (let index = start; index < code.length; index++) {
    const char = code[index]
    if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char)) depth--
    else if (char === '\\n' && depth <= 0 && !/(=>|[=(,:?+\\-*/|&])\\s*$/.test(code.slice(start, index))) return code.slice(start, index)
  }
  return code.slice(start)
}

// FNV-1a, 32 bit, as hex. not cryptographic, it only has to notice edits
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// one hash over everything an algorithm cites. read = file path -> its text (null if the file is missing)
export function sourcesHash(sources: SourceRef[], read: (file: string) => string | null): { hash: string; missing: string[] } {
  const missing: string[] = []
  const parts = sources.map(({ file, symbol }) => {
    const code = read(file)
    const part = code === null ? null : symbol ? extractSymbol(code, symbol) : code
    if (part === null) missing.push(symbol ? \`\${file}#\${symbol}\` : file)
    return normalize(part ?? '')
  })
  return { hash: fnv1a(parts.join('\\n\\u0000\\n')), missing }
}

// {{src/optimizer/optimize.ts#BEAM_WIDTH}} -> the constant's value as written in the code ("8"). an unresolved one is left
// as "?" and reported, so a renamed constant can't silently show a stale number
export const PLACEHOLDER = /\\{\\{([^#}]+)#([A-Za-z_$][\\w$]*)\\}\\}/g
export function readConstant(code: string | null, name: string): string | null {
  if (!code) return null
  const match = code.match(new RegExp(\`(?:const|let)\\\\s+\${name}\\\\s*(?::[^=]+)?=\\\\s*([^\\\\n;]+)\`))
  if (!match) return null
  return match[1].replace(/\\s*\\/\\/.*$/, '').replace(/\\bas const\\b/, '').trim()
}
export function fillPlaceholders(text: string, read: (file: string) => string | null, unresolved?: string[]): string {
  return text.replace(PLACEHOLDER, (_, file: string, name: string) => {
    const value = readConstant(read(file), name)
    if (value === null) unresolved?.push(\`\${file}#\${name}\`)
    return value ?? '?'
  })
}
`,s=`// Warframe ability damage. each ability (src/data/abilityDamage.ts) turns its wiki numbers into a timeline of hits, raw
// damage with Ability Strength already in, and I run that against the target here: damage type vs faction, armor, Viral,
// vulnerability, Roar and the Archon Shard "Ability Damage on enemies affected by X" bonuses, plus the DoTs from the
// status procs the ability puts out (same tick rules as weapons, src/calc/constants.ts DOT_STATUSES)
//  - wiki Ability_Damage: sources are the shards (+10%, +15% tauforged), Shattering Frost and Roar ("bonus damage to all
//    weapons and abilities")
//  - wiki Damage_Vulnerability: "Damage Vulnerability effects multiply the damage that a target receives"
//  - abilities don't crit unless their page says so, so there's no crit here at all
import { DOT_STATUSES, FACTION_DAMAGE_MODIFIERS, viralMultiplier } from './constants'
import { armorDamageMultiplier, effectiveArmor } from './target'
import type { Debuffs } from '../types'

export interface AbilityContext {
  strength: number // 1 = 100%
  duration: number
  range: number
  roar: number // bonus fraction from Roar casts
  shardVsStatus: { electricity: number; radiation: number; corrosive: number } // Archon Shard ability damage bonuses
  subsumed: boolean // cast through the Helminth (some abilities are weaker subsumed)
  uwb?: UniversalBonuses // weapon buffs that also reach "weapon damage abilities" (wiki Universal_Weapon_Bonuses)
  target: {
    faction: string
    armor: number // before debuffs
    debuffs: Debuffs
    health: number // max health/shields for the % of health abilities (Reave, Smite)
    shield: number
  }
}

// wiki Universal_Weapon_Bonuses: some abilities count as weapons for these. which ones an ability takes is on the hit (uwb)
//  - base: "Damage" bonuses (Arcane Arachne 150%, Vigorous Swap 165%, Vex Armor...), added up like Serration
//  - elemental: "Lavos's Valence Formation - 200%" (any element, "Also increases DoT damage by 200% for the selected element"),
//    "Grendel's Nourish - 75%" Viral, "Hydroid's Plunder - Up to 200%" Corrosive
//  - multiplier: "Mirage's Eclipse - 200%", Nidus's Parasitic Link, Vauban's passive... ("multiplicative to each other")
//  - crit: "base critical chance of 0% ... Absolute bonuses like Arcane Avenger instead add a flat amount", the 1.0x multiplier
//    goes up with flat additions ("Arcane Crepuscular, Tenacious Bond, or Grave Spirit")
export interface UniversalBonuses {
  base: number
  elemental: { damageType: string; value: number }[]
  multiplier: number // 1 = none
  flatCritChance: number
  critMultiplierBonus: number // added to the 1.0x
}
export const NO_UWB: UniversalBonuses = { base: 0, elemental: [], multiplier: 1, flatCritChance: 0, critMultiplierBonus: 0 }
export interface UwbTakes { base?: boolean; elemental?: boolean; multiplier?: boolean; crit?: boolean }

// one damage instance from the ability itself. raw has Ability Strength in already
export interface DamageEvent {
  t: number // seconds after cast
  label: string
  raw: number
  types: Record<string, number> // share of raw per damage type
  procs?: Record<string, number> // status procs this hit applies (fractions = expected value)
  procSeconds?: number // status duration of those procs (default 6 s)
  trueDamage?: boolean // True damage / % of health drains: no armor, no type modifiers, straight to health (Viral still counts)
  // % of what the target has left right now, on top of raw (Smite: "% of their current Health, Shields"; Reap on a Sown enemy:
  // "25% of their current health as True damage")
  percentCurrent?: { fraction: number; of: 'health' | 'healthAndShields' }
  skipShields?: boolean // defaults to trueDamage: True damage goes straight to health, a drain of both (Reave) doesn't
  armorStripBefore?: number // fraction of the target's remaining armor removed before this hit lands
  clearProcs?: string[] // statuses this hit removes (Thermal Sunder's combine cancels the old proc)
  vulnerability?: number // Damage Vulnerability this hit leaves on the target for everything after it (Demonium, Light's Judgment)
  uwb?: UwbTakes // which Universal Weapon Bonuses this hit takes (Jade Stars: elemental and crit, not base or multipliers)
}
export interface AbilityRun {
  events: DamageEvent[]
  notes?: string[] // what this run assumed, shown under the numbers
}

export interface InstanceLine { label: string; hits: number; first: number; total: number }
export interface AbilityResult {
  total: number // everything from one cast on one target, DoT tails included
  direct: number
  dot: number
  window10: number // damage dealt in the first 10 s (the board's DPS window)
  biggestHit: number
  lastHitTime: number
  // against the target's health/shields (when it has some): how much of it one cast takes, and when it dies
  pool: number // health + shields
  poolFraction: number // damage dealt / pool, capped at 1
  killTime: number | null // seconds after cast, null if it lives
  lines: InstanceLine[]
  dotLines: InstanceLine[]
  notes: string[]
}

export const ABILITY_WINDOW = 10

interface ActiveProc { type: string; start: number; end: number; perTick: number; ticksLeft: number[] }

const SHARD_STATUS: Record<string, 'electricity' | 'radiation' | 'corrosive'> = { electricity: 'electricity', radiation: 'radiation', corrosive: 'corrosive' }
const STATUS_SECONDS = 6
// Gas clouds cap at 10 (DOT_STATUSES note), the rest stack freely
const MAX_ACTIVE: Record<string, number> = { gas: 10 }

export function runAbility(run: AbilityRun, ctx: AbilityContext): AbilityResult {
  const events = [...run.events].sort((a, b) => a.t - b.t)
  const { target } = ctx
  const weakness = FACTION_DAMAGE_MODIFIERS[target.faction] ?? {}
  const uwb = ctx.uwb ?? NO_UWB
  let armorLeft = 1 // fraction of armor the ability's own strips left
  // the ability's own non-DoT procs, for Viral/Corrosive stacks and the shard bonuses: [type, from, until]
  const ownStatus: [string, number, number][] = []
  const procs: ActiveProc[] = []
  const lines = new Map<string, InstanceLine>()
  const dotLines = new Map<string, InstanceLine>()
  let direct = 0, dot = 0, window10 = 0, biggestHit = 0, lastHitTime = 0
  // the target's pools: shields soak first (True damage skips them), the kill is when health hits 0
  let shieldLeft = target.shield, healthLeft = target.health
  let dealt = 0
  let killTime: number | null = null
  const land = (amount: number, t: number, skipShields: boolean) => {
    if (!(target.health > 0)) return
    let rest = amount
    if (!skipShields) { const soaked = Math.min(shieldLeft, rest); shieldLeft -= soaked; rest -= soaked }
    const taken = Math.min(healthLeft, rest)
    healthLeft -= taken
    dealt += (amount - rest) + taken
    if (healthLeft <= 0 && killTime === null) killTime = t
  }
  // the ability's own vulnerability debuffs: [value, from]. the same debuff doesn't stack with itself, so I keep the biggest
  const ownVulnerability: [number, number][] = []

  const stacksAt = (type: string, t: number) => (target.debuffs.stacks[type] ?? 0) + ownStatus.filter(([kind, from, until]) => kind === type && from <= t && t < until).length
    + procs.filter((proc) => proc.type === type && proc.start <= t && t < proc.end).length
  const typeFactor = (damageType: string, t: number, bypassArmor: boolean) => {
    const corrosive = Math.min(10, stacksAt('corrosive', t))
    // Heat on the target strips armor the same way it does for weapons (the Debuffs panel's 50% with Heat up)
    const heatArmorStrip = Math.max(target.debuffs.heatArmorStrip, stacksAt('heat', t) > 0 ? 0.5 : 0)
    const armor = effectiveArmor(target.armor * armorLeft, { ...target.debuffs, heatArmorStrip, stacks: { ...target.debuffs.stacks, corrosive } })
    const armorMultiplier = bypassArmor || damageType === 'true' ? 1 : armorDamageMultiplier(armor)
    return (weakness[damageType] ?? 1) * armorMultiplier * viralMultiplier(Math.min(10, stacksAt('viral', t)))
  }
  // Roar, vulnerability and the shards: "+10% Ability Damage on enemies affected by Electricity status"
  const bonusAt = (t: number) => {
    let shard = 0
    for (const [status, key] of Object.entries(SHARD_STATUS)) if (ctx.shardVsStatus[key] && stacksAt(status, t) > 0) shard += ctx.shardVsStatus[key]
    // Roar: "bonus damage to all weapons and abilities", and "Multiple Roars do not stack" (the panel passes the strongest)
    const own = Math.max(0, ...ownVulnerability.filter(([, from]) => from < t).map(([value]) => value))
    return (1 + ctx.roar) * (1 + shard) * (1 + target.debuffs.damageVulnerability) * (1 + own)
  }
  const add = (map: Map<string, InstanceLine>, label: string, amount: number) => {
    const line = map.get(label) ?? { label, hits: 0, first: amount, total: 0 }
    line.hits++
    line.total += amount
    map.set(label, line)
  }

  // DoT ticks that are due before time t
  const tickUntil = (t: number) => {
    for (const proc of procs) {
      while (proc.ticksLeft.length && proc.ticksLeft[0] <= t) {
        const at = proc.ticksLeft.shift()!
        const info = DOT_STATUSES[proc.type]
        const amount = proc.perTick * typeFactor(proc.type, at, info.bypassesArmor) * bonusAt(at)
        dot += amount
        land(amount, at, proc.type === 'toxin') // Toxin ticks skip shields (DOT_STATUSES note)
        if (at < ABILITY_WINDOW) window10 += amount
        add(dotLines, \`\${proc.type[0].toUpperCase()}\${proc.type.slice(1)} status\`, amount)
      }
    }
  }

  for (const event of events) {
    tickUntil(event.t)
    if (event.armorStripBefore) armorLeft *= Math.max(0, 1 - event.armorStripBefore)
    if (event.clearProcs) for (const proc of procs) if (event.clearProcs.includes(proc.type)) proc.ticksLeft = []
    const bonus = bonusAt(event.t)
    const current = event.percentCurrent
      ? event.percentCurrent.fraction * (healthLeft + (event.percentCurrent.of === 'healthAndShields' ? shieldLeft : 0))
      : 0
    // Universal Weapon Bonuses on the hits that take them: base adds, multipliers multiply, crit averages in, and elemental
    // bonuses grow their own element (and its DoT) or add a new one on top of the base
    const takes = event.uwb ?? {}
    const crit = takes.crit ? 1 + uwb.flatCritChance * uwb.critMultiplierBonus : 1
    const raw = (event.raw * (takes.base ? 1 + uwb.base : 1) * (takes.multiplier ? uwb.multiplier : 1) + current) * crit
    const elementalOf = (type: string) => (takes.elemental ? uwb.elemental.filter((bonus) => bonus.damageType === type).reduce((sum, bonus) => sum + bonus.value, 0) : 0)
    const types: Record<string, number> = { ...event.types }
    for (const bonus of takes.elemental ? uwb.elemental : []) if (!(bonus.damageType in types)) types[bonus.damageType] = 0
    const shareOf = (type: string) => (event.types[type] ?? 0) * (1 + elementalOf(type)) + (event.types[type] === undefined ? elementalOf(type) : 0)
    const amount = event.trueDamage
      ? raw * bonus * viralMultiplier(Math.min(10, stacksAt('viral', event.t)))
      : Object.keys(types).reduce((sum, type) => sum + raw * shareOf(type) * typeFactor(type, event.t, false), 0) * bonus
    direct += amount
    land(amount, event.t, event.skipShields ?? Boolean(event.trueDamage))
    if (event.t < ABILITY_WINDOW) window10 += amount
    biggestHit = Math.max(biggestHit, amount)
    lastHitTime = Math.max(lastHitTime, event.t)
    add(lines, event.label, amount)
    if (event.vulnerability) ownVulnerability.push([event.vulnerability, event.t])

    // status procs: DoTs tick off the hit's raw damage (wiki: "Heat ... 50% of base damage per tick"), the rest just sit
    // on the target for Viral/Corrosive/shard bonuses
    const seconds = event.procSeconds ?? STATUS_SECONDS
    for (const [type, count] of Object.entries(event.procs ?? {})) {
      if (count <= 0) continue
      const info = DOT_STATUSES[type]
      if (!info) {
        // whole procs only, the expected share goes in as a share of one
        for (let n = 0; n < Math.ceil(count); n++) ownStatus.push([type, event.t, event.t + seconds])
        continue
      }
      // one proc's tick: its fraction of the hit's raw damage (Roar's in, the target's modifiers go on at tick time)
      const perTick = info.fraction * raw * (1 + elementalOf(type)) * (1 + ctx.roar)
      const whole = Math.floor(count), part = count - whole
      // Electricity ticks right away (0-5 s), the others 1 s after the hit, Blast once after its 1.5 s fuse
      const firstTick = type === 'electricity' ? 0 : type === 'blast' ? 1.5 : 1
      const ticks = type === 'blast' ? 1 : Math.max(1, Math.round(info.ticks * seconds / STATUS_SECONDS))
      for (let n = 0; n < whole + (part > 0 ? 1 : 0); n++) {
        const scale = n < whole ? 1 : part // an expected-value share of a proc (50% status chance) ticks for that share
        procs.push({ type, start: event.t, end: event.t + seconds, perTick: perTick * scale, ticksLeft: Array.from({ length: ticks }, (_, i) => event.t + firstTick + i) })
      }
      // Heat: a new proc refreshes every Heat stack on the target (DOT_STATUSES note), so older ones keep ticking
      if (type === 'heat') {
        for (const proc of procs) {
          if (proc.type !== 'heat' || !proc.ticksLeft.length) continue
          // the duration resets but the old stack keeps its tick rhythm (once a second from where it was), else a Heat proc
          // every 0.25 s would push every tick to the end of the cast
          const next = proc.ticksLeft[0]
          const ticks = Math.max(1, Math.floor(event.t + seconds - next) + 1)
          proc.ticksLeft = Array.from({ length: ticks }, (_, i) => next + i)
          proc.end = event.t + seconds
        }
      }
      const cap = MAX_ACTIVE[type]
      if (cap) {
        const live = procs.filter((proc) => proc.type === type && proc.ticksLeft.length)
        for (const old of live.slice(0, Math.max(0, live.length - cap))) old.ticksLeft = []
      }
    }
  }
  tickUntil(Infinity)
  // the target's worst moment in the window: what status the ability itself kept on it (level cap is about these)
  const peak = (type: string) => Math.max(0, ...events.filter((event) => event.t < ABILITY_WINDOW).map((event) => stacksAt(type, event.t + 0.001)))
  const statusNotes: string[] = []
  const viralPeak = Math.min(10, peak('viral')), corrosivePeak = Math.min(10, peak('corrosive')), heatPeak = peak('heat')
  if (viralPeak) statusNotes.push(\`Viral x\${viralPeak} (health damage x\${viralMultiplier(viralPeak)})\`)
  if (corrosivePeak || heatPeak) {
    const armorLeftNow = effectiveArmor(target.armor * armorLeft, { ...target.debuffs, heatArmorStrip: heatPeak ? Math.max(0.5, target.debuffs.heatArmorStrip) : target.debuffs.heatArmorStrip, stacks: { ...target.debuffs.stacks, corrosive: corrosivePeak } })
    if (target.armor > 0) statusNotes.push(\`\${corrosivePeak ? \`Corrosive x\${corrosivePeak}\` : ''}\${corrosivePeak && heatPeak ? ' + ' : ''}\${heatPeak ? 'Heat' : ''}: armor \${Math.round(target.armor)} -> \${Math.round(armorLeftNow)} at its lowest\`)
  }

  const sorted = (map: Map<string, InstanceLine>) => [...map.values()].sort((a, b) => b.total - a.total)
  const pool = target.health + target.shield
  return {
    total: direct + dot, direct, dot, window10, biggestHit, lastHitTime, pool, poolFraction: pool > 0 ? Math.min(1, dealt / pool) : 0, killTime,
    lines: sorted(lines), dotLines: sorted(dotLines), notes: [...(run.notes ?? []), ...statusNotes],
  }
}

// a neutral context for checks: 300% Strength, 100% Duration/Range, no faction/armor/status, 100,000 health
export const ABILITY_BOARD_STRENGTH = 3
export const ABILITY_BOARD_HEALTH = 100_000
export const neutralAbilityContext = (overrides: Partial<AbilityContext> = {}): AbilityContext => ({
  strength: ABILITY_BOARD_STRENGTH, duration: 1, range: 1, roar: 0, subsumed: false,
  shardVsStatus: { electricity: 0, radiation: 0, corrosive: 0 },
  target: {
    faction: 'None', armor: 0, health: ABILITY_BOARD_HEALTH, shield: 0,
    debuffs: { stacks: {}, heatArmorStrip: 0, corrosiveProjections: 0, otherArmorReduction: 0, damageVulnerability: 0, liftedOrKnockedDown: false, statusTypeSource: 'build' },
  },
  ...overrides,
})
`,c=`// the build advisor: how much each stat is worth to *this* build right now, which real mod is the best (and cheapest)
// way to get it, which slots pull the least weight, and greedy build paths that show the order stats stop paying off.
// everything is measured by running the calc with one more (or one less) mod, so the weights move as the build does:
// Warframe damage is a product of buckets (base damage x multishot x crit x elements x fire rate...), and adding to a
// bucket that's already big moves the product less than adding to a small one. that's what "over-stacking" means here
import { SUSTAINED_FIGHT_SECONDS, calculate, type CalcInput, type CalcResult } from './damage'
import { parseUpgrade, type ModEffect } from './parseMod'
import { modsConflict } from './modConflicts'
import { BANE_TARGET } from './constants'
import { modCatch } from './modTieBreak'
import { expectedDamage } from './simulate'
import type { Arcane, Attack, EquippedArcane, EquippedMod, Mod } from '../types'

export type LeverId = string // 'damage', 'critChance', 'element:heat', 'physical:slash', 'faction', 'perStatus'...

export interface Lever {
  id: LeverId
  label: string
  line: string // the test line fed to the calc: one typical mod's worth of the stat
  size: string // that amount in words, for the explanation ("+90% Heat, like Hellfire")
}

export interface LeverRow extends Lever {
  weight: number // score gain from +10% of this stat, 0.05 = +5%
  equippedCount: number // mods in the build that touch it
  bestMod: ModOption | null // the strongest real mod for it
  cheapestMod: ModOption | null // the most gain per capacity point, when it isn't the strongest
  combines: string[] // damage types it would create by combining with an element already there ("radiation")
}

export interface ModOption {
  mod: Mod
  gain: number // score gain from adding it (or swapping out the weakest slot when the build is full)
  drain: number // capacity at max rank
  swapsOut: string | null // the mod it replaces when the build is full
}

export interface SlotValue {
  mod: Mod
  contribution: number // how much the build loses without it, as a share of what's left (0.3 = the build is 30% bigger with it)
  levers: LeverId[]
}

export interface Advice {
  score: number
  levers: LeverRow[]
  slots: SlotValue[]
  swaps: { out: Mod; in: Mod; gain: number }[]
  flags: string[]
}

export interface PathStep {
  mod: Mod
  gain: number // this step's gain over the step before
  score: number
  levers: LeverId[]
}

export interface BuildPath {
  name: string
  note: string
  steps: PathStep[]
  arcane: EquippedArcane | null // the arcane the path settled on (picked for its mods, then the mods re-picked with it)
  arcaneGain: number // what the arcane adds on top of the mods
  score: number
}

export interface ArcaneOption {
  arcane: EquippedArcane
  gain: number // vs the build as it is (with your current arcane, if any)
  current: boolean
}

// plain-words version of a weight, relative to the best stat right now
export type Rating = 'Top pick' | 'Strong' | 'Some' | 'Little' | 'No effect' | 'Hurts'
export function rating(weight: number, top: number): Rating {
  if (weight < -0.0005) return 'Hurts'
  if (weight < 0.0005) return 'No effect'
  const share = top > 0 ? weight / top : 0
  return share >= 0.75 ? 'Top pick' : share >= 0.4 ? 'Strong' : share >= 0.15 ? 'Some' : 'Little'
}

const ELEMENTS = ['heat', 'cold', 'electricity', 'toxin']
const PHYSICALS = ['impact', 'puncture', 'slash']
const SLOTS = 8
// how much of each stat one typical max-rank mod gives. a +10% sliver can read as "hurts" when a real mod helps:
// a little Heat on a Slash weapon vs heavy armor steals Slash procs (bleeds ignore armor) and adds almost nothing back
const typical = (melee: boolean) => ({
  damage: melee ? 120 : 165, multishot: 90, critChance: 120, critDamage: 120, statusChance: 90, fireRate: melee ? 30 : 60,
  element: 90, physical: 120, perStatus: melee ? 120 : 80,
})

// ties go to the mod without a catch: no Niche tag first (Serration over Heavy Caliber), then no condition (Vital Sense
// over Bladed Rounds). the calc can't see accuracy and counts conditionals at full stacks, so those tie on paper
const isNiche = (mod: Mod) => modCatch(mod) === 2
const beats = (value: number, mod: Mod, bestValue: number, bestMod: Mod) => {
  const tie = Math.abs(value - bestValue) <= 1e-6 * Math.max(1, Math.abs(bestValue))
  return tie ? modCatch(mod) < modCatch(bestMod) : value > bestValue
}

// status DoTs count half in the advisor's rankings unless the weapon is built for them (25%+ base status, a beam, or
// forced procs): Electricity's procs shouldn't outrank Primed Cryo Rounds' raw damage on a 20% status rifle. it's
// still real damage, the panel says so, but a target often dies before the ticks land
export const DOT_WEIGHT_OFF_DOT_WEAPON = 0.5
export const isDotWeapon = (attack: Attack) => attack.statusChance >= 0.25 || Boolean(attack.continuous) || Boolean(attack.forcedProcs?.length)
const dotsIn = (result: CalcResult, seconds: number) =>
  expectedDamage({ ...result.shotModel, hit: { normal: 0, crit: 0, average: 0 } }, seconds)
export function rankingScorer(objectiveId: string, score: Scorer, attack: Attack): { score: Scorer; dotWeight: number } {
  const dotWeight = isDotWeapon(attack) ? 1 : DOT_WEIGHT_OFF_DOT_WEAPON
  if (dotWeight === 1) return { score, dotWeight }
  const seconds = objectiveId === 'sustained' ? SUSTAINED_FIGHT_SECONDS : /^window(\\d+)$/.test(objectiveId) ? Number(objectiveId.slice(6)) : null
  if (seconds) {
    return { dotWeight, score: (result) => (result.damageInWindow(seconds) - (1 - dotWeight) * dotsIn(result, seconds)) / (objectiveId === 'sustained' ? seconds : 1) }
  }
  if (objectiveId === 'attack') return { dotWeight, score: (result) => result.averageShot + dotWeight * (result.attackTotal - result.averageShot) }
  return { score, dotWeight } // single hit has no DoT in it
}

const cap = (word: string) => word[0].toUpperCase() + word.slice(1)
const drainOf = (mod: Mod) => mod.baseDrain + mod.fusionLimit

// which levers a mod line feeds. a dual-stat mod feeds two
function leversOfEffect(effect: ModEffect): LeverId[] {
  switch (effect.kind) {
    case 'damageType':
      return [PHYSICALS.includes(effect.damageType) ? \`physical:\${effect.damageType}\` : \`element:\${effect.damageType}\`]
    case 'faction':
      return ['faction']
    case 'stat':
      if (effect.value <= 0) return []
      if (effect.stat === 'damagePerStatusType') return ['perStatus']
      if (['damage', 'multishot', 'critChance', 'critDamage', 'statusChance', 'fireRate'].includes(effect.stat)) return [effect.stat]
      return []
    default:
      return []
  }
}
const leversOfStats = (levelStats: string[][], rank: number): LeverId[] => {
  const parsed = parseUpgrade(levelStats, rank)
  return [...new Set([...parsed.effects, ...parsed.conditionals.map((conditional) => conditional.effect)].flatMap(leversOfEffect))]
}
export const leversOf = (mod: Mod): LeverId[] => leversOfStats(mod.levelStats, mod.fusionLimit)
export const leversOfArcane = (arcane: Arcane): LeverId[] => leversOfStats(arcane.levelStats, arcane.levelStats.length - 1)

// every arcane that fits, in place of the current one, best first
export function arcaneOptions(input: CalcInput, score: Scorer, arcanes: EquippedArcane[]): ArcaneOption[] {
  const base = score(calculate(input))
  const currentName = input.arcane?.arcane.name
  return arcanes
    .map((arcane) => {
      const current = arcane.arcane.name === currentName
      const value = current ? base : score(calculate({ ...input, arcane }))
      return { arcane, gain: base > 0 ? value / base - 1 : 0, current }
    })
    .sort((a, b) => b.gain - a.gain)
}

// the biggest plain amount of one stat a real mod you could still add gives (Primed Cryo Rounds: +165% Cold), so a stat
// with a bigger mod isn't ranked as if it only had the +90% one. only always-on lines count
function biggestMod(available: Mod[], id: LeverId): { amount: number; name: string } | null {
  let best: { amount: number; name: string; mod: Mod } | null = null
  for (const mod of available) {
    for (const effect of parseUpgrade(mod.levelStats, mod.fusionLimit).effects) {
      if (!leversOfEffect(effect).includes(id) || !('value' in effect)) continue
      const amount = Math.round(effect.value * 100)
      if (amount > 0 && (!best || beats(amount, mod, best.amount, best.mod))) best = { amount, name: mod.name, mod }
    }
  }
  return best
}

// the stats worth testing on this weapon: no multishot on melee, physical types only if the attack has them.
// each is tested at one typical mod's worth, or at the biggest mod for it you could still add when that's bigger
export function leversFor(input: CalcInput, available: Mod[] = []): Lever[] {
  const melee = input.weapon.category === 'Melee'
  const size = typical(melee)
  const lever = (id: LeverId, label: string, typicalAmount: number, stat: string, like: string): Lever => {
    const real = id === 'faction' ? null : biggestMod(available, id)
    const amount = real && real.amount > typicalAmount ? real.amount : typicalAmount
    const example = real && real.amount > typicalAmount ? real.name : like
    return { id, label, line: \`+\${amount}% \${stat}\`, size: \`+\${amount}% \${stat.replace(' affecting target', '')}, like \${example}\` }
  }
  const levers: Lever[] = [
    lever('damage', 'Base damage (Serration-type)', size.damage, 'Damage', melee ? 'Pressure Point' : 'Serration'),
    ...(melee ? [] : [lever('multishot', 'Multishot', size.multishot, 'Multishot', 'Split Chamber')]),
    lever('critChance', 'Crit chance', size.critChance, 'Critical Chance', melee ? 'True Steel' : 'Point Strike'),
    lever('critDamage', 'Crit damage', size.critDamage, 'Critical Damage', melee ? 'Organ Shatter' : 'Vital Sense'),
    lever('statusChance', 'Status chance', size.statusChance, 'Status Chance', 'Rifle Aptitude'),
    lever('fireRate', melee ? 'Attack speed' : 'Fire rate', size.fireRate, melee ? 'Attack Speed' : 'Fire Rate', melee ? 'Fury' : 'Speed Trigger'),
    ...ELEMENTS.map((element) => lever(\`element:\${element}\`, \`\${cap(element)} (elemental)\`, size.element, cap(element),
      { heat: 'Hellfire', cold: 'Cryo Rounds', electricity: 'Stormbringer', toxin: 'Infected Clip' }[element]!)),
    ...PHYSICALS.filter((type) => (input.attack.damage[type] ?? 0) > 0)
      .map((type) => lever(\`physical:\${type}\`, \`\${cap(type)} (IPS)\`, size.physical, cap(type), { impact: 'Rupture', puncture: 'Piercing Hit', slash: 'Fanged Fusillade' }[type]!)),
    lever('perStatus', 'Per status type (CO / Galvanized)', size.perStatus, 'Damage per Status Type affecting target', 'Condition Overload'),
  ]
  // a Bane only does something against its faction
  const bane = BANE_TARGET[input.target.faction]
  if (bane) levers.push({ id: 'faction', label: \`Faction (Bane of \${bane})\`, line: \`x1.55 Damage to \${bane}\`, size: \`+55% damage to \${bane}, like Primed Bane\` })
  return levers
}

const fakeMod = (weaponType: string, name: string, line: string): Mod => ({
  uniqueName: \`advisor/\${name}\`, name, type: weaponType, compatName: null, polarity: null, rarity: null,
  baseDrain: 0, fusionLimit: 0, imageName: null, isExilus: false, levelStats: [[line]],
})
const modTypeOf = (input: CalcInput) =>
  input.weapon.category === 'Melee' ? 'Melee Mod' : input.weapon.category === 'Secondary' ? 'Secondary Mod' : 'Primary Mod'

export type Scorer = (result: CalcResult) => number

export function advise(input: CalcInput, score: Scorer, pool: EquippedMod[]): Advice {
  const run = (mods: EquippedMod[]) => score(calculate({ ...input, mods }))
  const base = run(input.mods)
  const ratio = (value: number) => (base > 0 ? value / base - 1 : 0)
  const equipped = input.mods
  const equippedNames = new Set(equipped.map((slot) => slot.mod.name))
  const full = equipped.length >= SLOTS

  // what each equipped mod is pulling: the build with it vs without it
  const slots: SlotValue[] = equipped.map((slot, index) => {
    const without = run(equipped.filter((_, other) => other !== index))
    return { mod: slot.mod, contribution: without > 0 ? base / without - 1 : 0, levers: leversOf(slot.mod) }
  })
  const weakestIndex = slots.length ? slots.reduce((weakest, slot, index) => (slot.contribution < slots[weakest].contribution ? index : weakest), 0) : -1

  // a real mod's value: added to a free slot, or swapped for the weakest one when the build is full
  const candidates = pool.filter((option) => !equippedNames.has(option.mod.name) && !equipped.some((slot) => modsConflict(slot.mod, option.mod)))
  const optionFor = (option: EquippedMod): ModOption => {
    if (!full) return { mod: option.mod, gain: ratio(run([...equipped, option])), drain: drainOf(option.mod), swapsOut: null }
    const swapped = equipped.map((slot, index) => (index === weakestIndex ? option : slot))
    return { mod: option.mod, gain: ratio(run(swapped)), drain: drainOf(option.mod), swapsOut: equipped[weakestIndex].mod.name }
  }
  const options = candidates.map((option) => ({ option: optionFor(option), levers: leversOf(option.mod) }))

  const baseTypes = new Set(calculate({ ...input, mods: equipped }).damageTypes.map((row) => row.damageType))
  const levers: LeverRow[] = leversFor(input, candidates.map((option) => option.mod)).map((lever) => {
    const withLever = calculate({ ...input, mods: [...equipped, { mod: fakeMod(modTypeOf(input), lever.id, lever.line), rank: 0, conditionalStacks: 0 }] })
    const weight = ratio(score(withLever))
    const own = lever.id.startsWith('element:') ? lever.id.slice(8) : null
    const combines = own ? withLever.damageTypes.map((row) => row.damageType).filter((type) => type !== own && !baseTypes.has(type)) : []
    // a full build shows the best swap even when it's a loss, so you can see how far off it is
    const forLever = options.filter((entry) => entry.levers.includes(lever.id) && (full || entry.option.gain > 1e-6)).map((entry) => entry.option)
    const bestMod = forLever.reduce<ModOption | null>((best, option) => (!best || beats(option.gain, option.mod, best.gain, best.mod) ? option : best), null)
    const cheapest = forLever.filter((option) => option.gain > 0)
      .reduce<ModOption | null>((best, option) => (!best || beats(option.gain / option.drain, option.mod, best.gain / best.drain, best.mod) ? option : best), null)
    // with a free slot, a stat is worth at least what its best real mod adds: Galvanized Chamber's on-kill stacks
    // make Multishot worth far more than a plain +90%. with all 8 full that number is a swap, so it stays the test
    const realBeats = !full && bestMod !== null && bestMod.gain > weight
    return {
      ...lever, combines,
      weight: realBeats ? bestMod!.gain : weight,
      size: realBeats ? \`\${bestMod!.mod.name}, the best mod for it (conditional parts at the usual stacks)\` : lever.size,
      equippedCount: equipped.filter((slot) => leversOf(slot.mod).includes(lever.id)).length,
      bestMod,
      cheapestMod: cheapest && cheapest !== bestMod ? cheapest : null,
    }
  }).sort((a, b) => b.weight - a.weight)

  // swaps that beat the weakest slot (only meaningful when the build is full)
  const swaps = full
    ? options.filter((entry) => entry.option.gain > 0.005).sort((a, b) => b.option.gain - a.option.gain || Number(isNiche(a.option.mod)) - Number(isNiche(b.option.mod))).slice(0, 3)
      .map((entry) => ({ out: equipped[weakestIndex].mod, in: entry.option.mod, gain: entry.option.gain }))
    : []

  // over-stacking: a stat with 2+ mods where one of them, swapped for the best mod from another stat, makes the build
  // bigger. a low "+10% adds" alone doesn't mean a mod is wasted (it can still be the best thing for its slot), a swap
  // that wins does
  const flags: string[] = []
  const flagged = new Set<string>()
  for (const lever of levers) {
    if (lever.equippedCount < 2) continue
    const stacked = equipped
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => leversOf(slot.mod).includes(lever.id) && !flagged.has(slot.mod.name))
    // the one in that stat pulling least
    const weakest = stacked.reduce<{ slot: EquippedMod; index: number } | null>((low, entry) =>
      (!low || slots[entry.index].contribution < slots[low.index].contribution ? entry : low), null)
    if (!weakest) continue
    let best: { mod: Mod; gain: number } | null = null
    for (const entry of options) {
      if (entry.levers.includes(lever.id)) continue // another mod of the same stat isn't "something else"
      const option = pool.find((candidate) => candidate.mod === entry.option.mod)!
      const gain = ratio(run(equipped.map((slot, index) => (index === weakest.index ? option : slot))))
      if (!best || beats(gain, option.mod, best.gain, best.mod)) best = { mod: option.mod, gain }
    }
    if (best && best.gain > 0.01) {
      flagged.add(weakest.slot.mod.name)
      flags.push(\`\${lever.label} is over-stacked (\${lever.equippedCount} mods): \${weakest.slot.mod.name} adds \${pctText(slots[weakest.index].contribution)} now, \` +
        \`\${best.mod.name} in its place makes the build \${pctText(best.gain)} bigger. That stat's bucket is already big, so each extra point of it moves the total less.\`)
    }
  }
  const result = calculate({ ...input, mods: equipped })
  if (result.critChance > 0 && result.critChance < 0.25 && levers.find((lever) => lever.id === 'critDamage')?.equippedCount) {
    flags.push(\`Crit damage is modded but crit chance is only \${pctText(result.critChance)}, so most hits never crit. Crit chance first, or drop crit damage.\`)
  }
  if (equipped.length && full && slots[weakestIndex].contribution < 0.03 && !flagged.has(slots[weakestIndex].mod.name)) {
    flags.push(\`\${slots[weakestIndex].mod.name} adds only \${pctText(slots[weakestIndex].contribution)}: that slot can go to something else.\`)
  }

  return { score: base, levers, slots, swaps, flags }
}

export const pctText = (value: number) => \`\${value >= 0 ? '+' : ''}\${(value * 100).toFixed(value !== 0 && Math.abs(value) < 0.1 ? 1 : 0)}%\`

// one slot at a time, always the mod that adds the most right now. not the true best build (the optimizer looks further
// ahead), but it shows the order stats pay off in and where each one runs out
export function greedyPath(input: CalcInput, score: Scorer, pool: EquippedMod[], name: string, note: string, allow: (mod: Mod) => boolean, keep: EquippedMod[] = []): BuildPath {
  const run = (mods: EquippedMod[]) => score(calculate({ ...input, mods }))
  const picked: EquippedMod[] = [...keep]
  const steps: PathStep[] = []
  let current = run(picked)
  while (picked.length < SLOTS) {
    let best: { option: EquippedMod; score: number } | null = null
    for (const option of pool) {
      if (!allow(option.mod) || picked.some((slot) => slot.mod.name === option.mod.name || modsConflict(slot.mod, option.mod))) continue
      const next = run([...picked, option])
      if (!best || beats(next, option.mod, best.score, best.option.mod)) best = { option, score: next }
    }
    if (!best || best.score <= current * (1 + 1e-6)) break
    picked.push(best.option)
    steps.push({ mod: best.option.mod, gain: current > 0 ? best.score / current - 1 : 0, score: best.score, levers: leversOf(best.option.mod) })
    current = best.score
  }
  return { name, note, steps, arcane: input.arcane ?? null, arcaneGain: 0, score: current }
}

// a path with its arcane: mods first, then the best arcane for them, then the mods again with that arcane in (an arcane
// can change what the mods should be, Arcane Rage wants crit), and the arcane once more. stops when it settles
function pathWithArcane(
  input: CalcInput, score: Scorer, pool: EquippedMod[], arcanes: EquippedArcane[], name: string, note: string,
  allow: (levers: LeverId[]) => boolean, keep: EquippedMod[],
): BuildPath {
  const allowedArcanes = arcanes.filter((arcane) => allow(leversOfArcane(arcane.arcane)))
  const modsAllowed = (mod: Mod) => allow(leversOf(mod))
  let arcane: EquippedArcane | null = null
  let path = greedyPath({ ...input, arcane: null }, score, pool, name, note, modsAllowed, keep)
  for (let round = 0; round < 2; round++) {
    const mods = [...keep, ...path.steps.map((step) => pool.find((option) => option.mod === step.mod)!)]
    const best = arcaneOptions({ ...input, mods, arcane: null }, score, allowedArcanes)[0]
    if (!best || best.gain <= 1e-6 || best.arcane.arcane.name === arcane?.arcane.name) break
    arcane = best.arcane
    path = greedyPath({ ...input, arcane }, score, pool, name, note, modsAllowed, keep)
  }
  const mods = [...keep, ...path.steps.map((step) => pool.find((option) => option.mod === step.mod)!)]
  const without = score(calculate({ ...input, mods, arcane: null }))
  return { ...path, arcane, arcaneGain: arcane && without > 0 ? path.score / without - 1 : 0 }
}

// the usual forks: pure greedy, crit (no status chance mods or arcanes), status (no crit ones). an immune target skips status
export function buildPaths(input: CalcInput, score: Scorer, pool: EquippedMod[], arcanes: EquippedArcane[], keep: EquippedMod[], statusImmune: boolean): BuildPath[] {
  const without = (ids: LeverId[]) => (levers: LeverId[]) => !levers.some((id) => ids.includes(id))
  return [
    pathWithArcane(input, score, pool, arcanes, 'Best each slot', 'Always the mod that adds the most right now.', () => true, keep),
    pathWithArcane(input, score, pool, arcanes, 'Crit', 'No status chance mods or arcanes.', without(['statusChance']), keep),
    ...(statusImmune ? [] : [pathWithArcane(input, score, pool, arcanes, 'Status', 'No crit chance / crit damage mods or arcanes.', without(['critChance', 'critDamage']), keep)]),
  ]
}
`,l=`// mod capacity + drain, per wiki.warframe.com/w/Polarity
//   matching polarity: drain halved, rounded up
//   mismatched polarity: drain +25%, rounded up
//   universal ("Any") slot matches everything except Umbra

export const WEAPON_SLOT_POLARITIES = [null, 'madurai', 'vazarin', 'naramon', 'zenurik', 'unairu', 'umbra', 'universal'] as const
export type SlotPolarity = (typeof WEAPON_SLOT_POLARITIES)[number]

export const BASE_CAPACITY = 30 // rank 30 weapon
export const capacityFor = (hasCatalyst: boolean) => BASE_CAPACITY * (hasCatalyst ? 2 : 1)

export function modDrain(baseDrain: number, rank: number, modPolarity: string | null, slotPolarity: SlotPolarity): number {
  const drain = baseDrain + rank
  if (!slotPolarity || !modPolarity) return drain
  const matches = slotPolarity === modPolarity || (slotPolarity === 'universal' && modPolarity !== 'umbra')
  return matches ? Math.ceil(drain / 2) : Math.ceil(drain * 1.25)
}

// aura mods add capacity instead of using it (negative base drain). matching polarity doubles the bonus,
// a mismatch takes 20% off (rounded, my reading of the wiki's Polarity page)
export function auraCapacity(baseDrain: number, rank: number, modPolarity: string | null, slotPolarity: SlotPolarity): number {
  const bonus = Math.abs(baseDrain) + rank
  if (!slotPolarity || !modPolarity) return bonus
  const matches = slotPolarity === modPolarity || slotPolarity === 'universal'
  return matches ? bonus * 2 : Math.round(bonus * 0.8)
}

export const nextPolarity = (current: SlotPolarity): SlotPolarity =>
  WEAPON_SLOT_POLARITIES[(WEAPON_SLOT_POLARITIES.indexOf(current) + 1) % WEAPON_SLOT_POLARITIES.length]
`,u=`// how "per status type" bonuses (Condition Overload, Galvanized Aptitude/Savvy/Shot, Secondary Shiver) apply,
// per wiki.warframe.com/w/Condition_Overload_(Mechanic) (pulled Oct 2026):
//   "Adding" type:      base x [(most bonuses x other multipliers) + CO]   (intended, most common)
//   "Multiplying" type: base x most bonuses x CO x other multipliers       (mostly projectiles, not intended)
// scale = the wiki's "CO relative to base" column: charged shots that only count the uncharged base (bows 50%,
// Ballistica 25%), hitscan explosions that count the hitscan hit (Opticor 250%)...
// which damage gets it at all (wiki): hitscan and its explosions on the directly hit enemy, projectiles, embedded
// clouds on the embedded enemy, beams. projectile explosion radii never do.
// the wiki page cut off for me partway through the secondaries (at Ballistica), so the rest of the secondaries and
// the melee rows come from rainy's GunCO sheet (38.0.12 edition, Feb 2025), marked source 'sheet'. wiki wins
// wherever both have a row
import type { Attack, Weapon } from '../types'

export type CoMode = 'add' | 'multiply' | 'none'

export interface CoBehavior {
  mode: CoMode
  scale: number // 1 = full bonus, 0.25 = Ballistica charged shot etc.
  source: 'wiki' | 'sheet' | 'default' | 'override'
  note?: string
}

interface CoRule {
  weapons: string[]
  attack: RegExp // matched against warframe-items attack names, which differ from the wiki's wording
  mode: CoMode
  scale?: number
  note?: string
  sheet?: boolean // from the GunCO sheet, not the wiki
}

const BOW_CHARGED = 'CO only counts the uncharged base damage'
const DIRECT_ONLY = 'Only on the enemy the hitscan shot hits directly, and scales off the hitscan damage'

const CO_RULES: CoRule[] = [
  // ---- primaries (wiki) ----
  { weapons: ['Acceltra'], attack: /^Rocket Impact$/, mode: 'add', scale: 0.743, note: 'CO uses 26 damage instead of the listed 35' },
  { weapons: ['Aeolak'], attack: /^(Normal Attack|Alt-Fire)$/, mode: 'multiply' },
  { weapons: ['Alternox', 'Alternox Prime'], attack: /^Normal Attack$/, mode: 'multiply' },
  { weapons: ['Ambassador'], attack: /^Charged AoE$/, mode: 'add', scale: 0.75, note: DIRECT_ONLY },
  { weapons: ['Arca Plasmor', 'Tenet Arca Plasmor'], attack: /^Normal Attack$/, mode: 'multiply' },
  { weapons: ['Basmu'], attack: /^Auto$/, mode: 'multiply' },
  { weapons: ['Battacor'], attack: /^Normal Attack$/, mode: 'multiply' },
  { weapons: ['Braton', 'Mk1-Braton', 'Braton Prime', 'Braton Vandal'], attack: /^Incarnon Form AoE$/, mode: 'add', scale: 0.95, note: DIRECT_ONLY },
  { weapons: ['Bubonico', 'Coda Bubonico'], attack: /^(Auto|Burst)$/, mode: 'multiply' }, // the Coda one too (same weapon, Coda variant)
  { weapons: ['Burston', 'Burston Prime'], attack: /^Incarnon Form Radial Attack$/, mode: 'add', scale: 0.24, note: DIRECT_ONLY },
  { weapons: ['Buzlok'], attack: /^(Normal Attack|Beacon)$/, mode: 'multiply' },
  { weapons: ['Cedo', 'Cedo Prime'], attack: /^Alt-Fire Glaive$/, mode: 'multiply' },
  { weapons: ['Cernos', 'Cernos Prime', 'Rakta Cernos', 'Mutalist Cernos', 'Daikyu Prime', 'Dread', 'Paris', 'Paris Prime', 'Mk1-Paris', 'Kuva Drakgoon'],
    attack: /^Charged( Horizontal\\/Vertical)? Shot$/, mode: 'add', scale: 0.5, note: BOW_CHARGED },
  { weapons: ['Coda Bassocyst'], attack: /^Normal Attack$/, mode: 'multiply' },
  { weapons: ['Coda Bassocyst'], attack: /^Alt-Fire$/, mode: 'none' },
  { weapons: ['Coda Hema', 'Hema', 'Exergis', 'Steflos', 'Shedu'], attack: /^Normal Attack$/, mode: 'multiply' },
  { weapons: ['Mutalist Cernos'], attack: /^Uncharged Shot$/, mode: 'multiply' },
  // the data has one cloud for both shots. uncharged multiplies, the charged one adds off the 205 arrow base (4100%),
  // I go with the uncharged one so it isn't overrated
  { weapons: ['Mutalist Cernos'], attack: /^Toxin Cloud$/, mode: 'multiply', note: 'Uncharged cloud. The charged cloud instead adds CO based on the arrow\\'s 205 damage' },
  { weapons: ['Cinta'], attack: /^(Quick Shot|Charged Shot|Perfect Shot)$/, mode: 'multiply' },
  { weapons: ['Drakgoon'], attack: /^Charged Shot$/, mode: 'add', scale: 0.57, note: BOW_CHARGED },
  { weapons: ['Dread', 'Paris', 'Paris Prime', 'Mk1-Paris'], attack: /^Incarnon Form/, mode: 'multiply' },
  { weapons: ['Evensong'], attack: /^Charged Shot$/, mode: 'add', scale: 0.65, note: BOW_CHARGED },
  { weapons: ['Evensong'], attack: /^Charged Radial Attack$/, mode: 'none' },
  { weapons: ['Felarx'], attack: /^(Normal Attack|Incarnon Form)$/, mode: 'multiply' },
  { weapons: ['Ferrox'], attack: /^Radial Attack$/, mode: 'add', scale: 3.5, note: DIRECT_ONLY },
  { weapons: ['Tenet Ferrox'], attack: /^Radial Attack$/, mode: 'add', scale: 3.33, note: DIRECT_ONLY },
  { weapons: ['Fulmin', 'Fulmin Prime'], attack: /^Semi-Auto Mode$/, mode: 'multiply' },
  { weapons: ['Harpak'], attack: /^Harpoon$/, mode: 'multiply' },
  { weapons: ['Javlok'], attack: /^Projectile Impact$/, mode: 'multiply' },
  { weapons: ['Lanka'], attack: /^Charged Shot$/, mode: 'add', scale: 0.38, note: 'CO only counts the partially charged base damage' },
  { weapons: ['Latron', 'Latron Prime', 'Latron Wraith', 'Miter'], attack: /^Incarnon Form$/, mode: 'multiply' },
  { weapons: ['Latron', 'Latron Prime', 'Latron Wraith'], attack: /^Incarnon Form AoE$/, mode: 'none', note: 'CO does not apply to the AoE in any way' },
  { weapons: ['Miter'], attack: /^Charged Shot$/, mode: 'add', scale: 0.4, note: 'CO only counts the partially charged base damage' },
  { weapons: ['Nataruk'], attack: /^(Charged Shot|Perfect Shot)$/, mode: 'multiply' },
  { weapons: ['Nunchasa'], attack: /^Alt-Fire$/, mode: 'multiply' },
  { weapons: ['Opticor'], attack: /^(Charged|Quick) Shot AoE$/, mode: 'add', scale: 2.5, note: DIRECT_ONLY },
  { weapons: ['Opticor Vandal'], attack: /^Charged Shot AoE$/, mode: 'add', scale: 2, note: DIRECT_ONLY },
  { weapons: ['Paracyst'], attack: /^Infested Harpoon/, mode: 'multiply' },
  { weapons: ['Phantasma', 'Phantasma Prime'], attack: /^Cluster Bombs Impact$/, mode: 'multiply' },
  { weapons: ['Proboscis Cernos'], attack: /^(Appendages|Charged Shot Explosion)$/, mode: 'none' },
  { weapons: ['Quellor'], attack: /^Alt-Fire$/, mode: 'multiply' },
  { weapons: ['Scourge', 'Scourge Prime'], attack: /^Spear Throw( Impact)?$/, mode: 'multiply' },
  { weapons: ['Stahlta'], attack: /^(Auto|Alt-Fire)$/, mode: 'multiply' },
  { weapons: ['Tenet Envoy'], attack: /^Grenade Impact$/, mode: 'multiply' },
  { weapons: ['Torid'], attack: /^(Grenade Impact|Poison Cloud)$/, mode: 'multiply' },
  { weapons: ['Trumna', 'Trumna Prime'], attack: /^Auto AoE$/, mode: 'add', scale: 1.64, note: DIRECT_ONLY },
  { weapons: ['Trumna', 'Trumna Prime'], attack: /^Grenade Impact$/, mode: 'multiply' },
  { weapons: ['Zarr'], attack: /^Cannon Mode Cluster Bomb Contact$/, mode: 'add', scale: 1.67, note: 'Uses the main projectile\\'s 25 damage' },
  { weapons: ['Kuva Zarr'], attack: /^Cannon Mode Cluster Bomb Contact$/, mode: 'add', scale: 3.33, note: 'Uses the main projectile\\'s 50 damage' },
  { weapons: ['Zhuge Prime'], attack: /^Arrow Explosion$/, mode: 'none' },
  // ---- primaries the wiki table doesn't have (sheet) ----
  { weapons: ['Kuva Bramma'], attack: /^Cluster Bomb Contact$/, mode: 'add', scale: 4.92, note: 'Uses the main arrow\\'s damage', sheet: true },
  { weapons: ['Zylok', 'Zylok Prime'], attack: /^Incarnon Form Radial Attack$/, mode: 'add', scale: 0.59, note: DIRECT_ONLY, sheet: true },
  // ---- secondaries (wiki, down to Ballistica) ----
  { weapons: ['Akarius Prime'], attack: /^Rocket Impact$/, mode: 'multiply' },
  { weapons: ['Aegrit'], attack: /^Direct Hit$/, mode: 'multiply' },
  { weapons: ['Angstrum', 'Prisma Angstrum'], attack: /^Incarnon Form$/, mode: 'multiply' },
  { weapons: ['Azima'], attack: /^Turret/, mode: 'none', note: 'Bug: should count as hitscan but gets nothing' },
  { weapons: ['Balefire Charger', 'Balefire Charger Prime'], attack: /./, mode: 'none', note: 'Bug: should apply but doesn\\'t' },
  { weapons: ['Ballistica'], attack: /^Charged Shot$/, mode: 'add', scale: 0.25, note: BOW_CHARGED },
  // ---- the rest of the secondaries (sheet) ----
  { weapons: ['Akarius'], attack: /^Rocket Impact$/, mode: 'multiply', sheet: true },
  { weapons: ['Rakta Ballistica'], attack: /^Charged Shot$/, mode: 'add', scale: 0.25, note: BOW_CHARGED, sheet: true },
  { weapons: ['Ballistica Prime'], attack: /^Charged Shot$/, mode: 'add', scale: 0.5, note: BOW_CHARGED, sheet: true },
  // Secondary Shiver's wiki page: multiplicative with Hornet Strike on these. the sheet agrees
  { weapons: ['Cyanex', 'Catchmoon', 'Epitaph', 'Epitaph Prime', 'Seer', 'Kuva Seer', 'Sepulcrum', 'Tenet Spirex'],
    attack: /^(?!.*(AoE|Explosion|Radial)).*/, mode: 'multiply', note: 'From the Secondary Shiver wiki page' },
  { weapons: ['Glory'], attack: /./, mode: 'none', sheet: true },
  { weapons: ['Kulstar'], attack: /^Cluster Bombs$/, mode: 'add', scale: 2.67, note: 'Uses the main rocket\\'s damage', sheet: true },
  { weapons: ['Kunai'], attack: /^Incarnon Form$/, mode: 'multiply', note: 'Gets the Evolution base damage too', sheet: true },
  { weapons: ['Onos'], attack: /^Normal Attack$/, mode: 'multiply', sheet: true },
  { weapons: ['Pox'], attack: /^Poison Cloud$/, mode: 'add', scale: 2.5, note: 'Embedded enemy only, scales off the contact hit', sheet: true },
  { weapons: ['Sonicor'], attack: /./, mode: 'none', note: 'Bug: should apply but doesn\\'t', sheet: true },
  { weapons: ['Stug'], attack: /./, mode: 'none', sheet: true },
  { weapons: ['Tenet Diplos'], attack: /^Lock-on Mode$/, mode: 'multiply', sheet: true },
  { weapons: ['Tenet Plinx'], attack: /^Alt-Fire$/, mode: 'multiply', sheet: true },
  { weapons: ['Zakti', 'Zakti Prime'], attack: /^(Dart Impact|Normal Attack)$/, mode: 'multiply', sheet: true },
  { weapons: ['Zymos'], attack: /^Homing Spore Contact$/, mode: 'multiply', sheet: true },
]

export function resolveCoBehavior(weapon: Weapon, attack: Attack): CoBehavior {
  const rule = CO_RULES.find((candidate) => candidate.weapons.includes(weapon.name) && candidate.attack.test(attack.name))
  if (rule) return { mode: rule.mode, scale: rule.scale ?? 1, source: rule.sheet ? 'sheet' : 'wiki', note: rule.note }
  // unlisted hitscan/beam explosions: the wiki says the directly hit enemy gets it ("Hitscan explosions (directly hit
  // target only)", "Beams, including beam AoE"), projectile explosions never do
  if (attack.hitscanAoE) return { mode: 'add', scale: 1, source: 'default', note: DIRECT_ONLY }
  return attack.isAoE
    ? { mode: 'none', scale: 1, source: 'default', note: 'Projectile explosion radius doesn\\'t get CO' }
    : { mode: 'add', scale: 1, source: 'default' }
}

export const CO_MODE_LABELS: Record<CoMode, string> = { add: 'Additive', multiply: 'Multiplicative', none: 'Doesn\\'t apply' }
`,ee=`// all the game numbers live here so they're easy to check against the wiki
// sources: wiki.warframe.com/w/Damage/Calculation, /w/Status_Effect, /w/Damage/Overview_Table,
// /w/Heat, /w/Cold, /w/Viral, /w/Faction_Damage_Bonus, /w/Enemy_Level_Scaling

export const PHYSICAL_TYPES = ['impact', 'puncture', 'slash']
export const PRIMARY_ELEMENTS = ['heat', 'cold', 'electricity', 'toxin']
export const DAMAGE_TYPES = [
  'impact', 'puncture', 'slash', 'heat', 'cold', 'electricity', 'toxin',
  'blast', 'corrosive', 'gas', 'magnetic', 'radiation', 'viral', 'void', 'tau', 'true',
]

// elements combine in slot order, two at a time
export const COMBINED_ELEMENTS: Record<string, string> = {
  'cold+heat': 'blast',
  'electricity+toxin': 'corrosive',
  'heat+toxin': 'gas',
  'cold+electricity': 'magnetic',
  'cold+toxin': 'viral',
  'electricity+heat': 'radiation',
}

// Update 36 faction weaknesses: vulnerable = x1.5, resistant = x0.5 (Damage/Overview_Table)
export const FACTION_DAMAGE_MODIFIERS: Record<string, Record<string, number>> = {
  Grineer: { impact: 1.5, corrosive: 1.5 },
  'Kuva Grineer': { impact: 1.5, corrosive: 1.5, heat: 0.5 },
  Scaldra: { impact: 1.5, corrosive: 1.5, gas: 0.5 },
  Corpus: { puncture: 1.5, magnetic: 1.5 },
  'Corpus Amalgam': { electricity: 1.5, magnetic: 1.5, blast: 0.5 },
  Infested: { slash: 1.5, heat: 1.5 },
  'Infested Deimos': { blast: 1.5, gas: 1.5, viral: 0.5 },
  Orokin: { puncture: 1.5, viral: 1.5, radiation: 0.5 },
  Sentient: { cold: 1.5, radiation: 1.5, corrosive: 0.5 },
  Narmer: { slash: 1.5, toxin: 1.5, magnetic: 0.5 },
  'The Murmur': { electricity: 1.5, radiation: 1.5, viral: 0.5 },
  Techrot: { gas: 1.5, magnetic: 1.5, cold: 0.5 },
  Anarchs: { impact: 1.5, electricity: 1.5, radiation: 0.5 },
  Zariman: { void: 1.5 },
}
export const FACTIONS = ['None', ...Object.keys(FACTION_DAMAGE_MODIFIERS)]

// which Bane/Primed Bane mod ("x1.3 Damage to Grineer") counts against which faction
// Scaldra/Techrot/Orokin bonuses come from Expel mods and spliced riven stats ("Damage to Techrot")
export const BANE_TARGET: Record<string, string> = {
  Grineer: 'Grineer',
  'Kuva Grineer': 'Grineer',
  Corpus: 'Corpus',
  'Corpus Amalgam': 'Corpus',
  Infested: 'Infested',
  'Infested Deimos': 'Infested',
  Orokin: 'Orokin',
  'The Murmur': 'Murmur',
  Scaldra: 'Scaldra',
  Techrot: 'Techrot',
}

export interface StatusInfo {
  name: string
  maxStacks: number | null // null = no stack cap (DoTs: Slash/Heat/Toxin/Electricity keep stacking, Harmony can detonate 100 at once)
  effect: string
}

export const STATUS_EFFECTS: Record<string, StatusInfo> = {
  impact: { name: 'Knockback', maxStacks: 5, effect: 'No damage multiplier' },
  puncture: { name: 'Weakened', maxStacks: 5, effect: '+5% crit chance per stack (flat)' },
  slash: { name: 'Bleed', maxStacks: null, effect: 'DoT only' },
  heat: { name: 'Ignite', maxStacks: null, effect: 'Strips up to 50% armor' },
  cold: { name: 'Freeze', maxStacks: 10, effect: '+0.1x crit mult, +0.05x per stack, +1.0x at 10' },
  electricity: { name: 'Tesla Chain', maxStacks: null, effect: 'DoT only' },
  toxin: { name: 'Poison', maxStacks: null, effect: 'DoT only' },
  blast: { name: 'Detonate', maxStacks: 10, effect: 'No damage multiplier' },
  corrosive: { name: 'Corrosion', maxStacks: 10, effect: '-26% armor, -6% per stack (80% max)' },
  gas: { name: 'Gas Cloud', maxStacks: 10, effect: 'DoT only' },
  magnetic: { name: 'Disrupt', maxStacks: 10, effect: '+100% shield/overguard dmg, +25% per stack' },
  radiation: { name: 'Confusion', maxStacks: 10, effect: 'No damage multiplier' },
  viral: { name: 'Virus', maxStacks: 10, effect: '+100% health dmg, +25% per stack' },
  void: { name: 'Bullet Attractor', maxStacks: 1, effect: 'No damage multiplier' },
  tau: { name: 'Status Vulnerability', maxStacks: 10, effect: '+10% status chance per stack (flat)' },
}
export const STATUS_TYPES = Object.keys(STATUS_EFFECTS)
// status-capped enemies (Target panel's "capped" mode) hold at most this many stacks of each status
export const CAPPED_STATUS_STACKS = 4
// total Ammo Efficiency from all sources, Hotfix 44.1.3
export const AMMO_EFFICIENCY_CAP = 0.75

export const viralMultiplier = (stacks: number) => (stacks > 0 ? 2 + 0.25 * (Math.min(stacks, 10) - 1) : 1)
export const magneticMultiplier = viralMultiplier // same curve, just for shields/overguard
export const corrosiveArmorReduction = (stacks: number) => (stacks > 0 ? 0.2 + 0.06 * Math.min(stacks, 10) : 0)
export const coldCritMultiplierBonus = (stacks: number) => {
  if (stacks <= 0) return 0
  if (stacks >= 10) return 1.0
  return 0.1 + 0.05 * (stacks - 1)
}
export const punctureCritChanceBonus = (stacks: number) => 0.05 * Math.min(stacks, 5)
export const tauStatusChanceBonus = (stacks: number) => 0.1 * Math.min(stacks, 10)

export const HEAT_ARMOR_STRIP_STAGES = [0, 0.15, 0.3, 0.4, 0.5] // ramps every 0.5s after the proc
export const CORROSIVE_PROJECTION_PER_AURA = 0.18

// status proc damage, per Damage_over_Time / Gas / Blast wiki pages:
//   tick = fraction x modded base x (1 + element mod) x (1 + faction) x (1 + status damage) x crit x body part
//   modded base = base x (1 + damage mods) x (1 + faction)   <- so faction counts twice
// ticks: Total Ticks = floor(rate x (duration - delay)) + 1. Slash/Heat/Toxin start after 1s and tick 1-6s,
// Electricity/Gas tick 0-5s (the 7th tick at 6s deals nothing), so 6 damaging ticks for all of them.
export interface DotInfo {
  fraction: number
  ticks: number
  usesElementMods: boolean // only literal element mods count (Hellfire -> Heat). Blast/Slash get none
  bypassesArmor: boolean
  fullHeadshot: boolean // Gas clouds only get headshot *bonuses* (Target Acquired etc), base 1x
  note: string
}

export const DOT_STATUSES: Record<string, DotInfo> = {
  slash: { fraction: 0.35, ticks: 6, usesElementMods: false, bypassesArmor: true, fullHeadshot: true, note: 'Ticks 1-6s, ignores armor. Physical mods (Sawtooth Clip) don\\'t buff it.' },
  heat: { fraction: 0.5, ticks: 6, usesElementMods: true, bypassesArmor: false, fullHeadshot: true, note: 'Ticks 1-6s. New Heat procs refresh every Heat stack, so sustained fire keeps them ticking longer than this.' },
  toxin: { fraction: 0.5, ticks: 6, usesElementMods: true, bypassesArmor: false, fullHeadshot: true, note: 'Ticks 1-6s, skips shields.' },
  electricity: { fraction: 0.5, ticks: 6, usesElementMods: true, bypassesArmor: false, fullHeadshot: true, note: 'Ticks 0-5s, also hits enemies within 3m and stuns.' },
  gas: { fraction: 0.5, ticks: 6, usesElementMods: true, bypassesArmor: false, fullHeadshot: false, note: 'Cloud ticks 0-5s on everything within 3m (+0.3m per stack, 10 clouds max). Heat/Toxin mods don\\'t buff it.' },
  blast: { fraction: 0.3, ticks: 1, usesElementMods: false, bypassesArmor: false, fullHeadshot: true, note: 'Single hit after a 1.5s fuse. 10-stack AoE = all stacks popping for 300% to enemies within 5m (not the target). Heat/Cold/Blast mods don\\'t buff it.' },
}

// at 10 stacks (or on death) every Blast stack pops at once: the target takes the 10 x 30% it was owed,
// and enemies within 5m (not the target) take 300% modded base, no falloff
export const BLAST_DETONATION_MULTIPLIER = 3

// wiki Weak_Point: heads are 3x on most factions, ~1.5x on Murmur and Techrot.
// "headcrit" heads also double the weapon's base crit multiplier on crits. Grineer (incl. Corrupted, Narmer,
// Anarchs), Scaldra and most Infested/Sentients have them, most Corpus, Murmur and much of Techrot don't.
export const HEAD_WEAK_POINT_MULTIPLIER: Record<string, number> = { 'The Murmur': 1.5, Techrot: 1.5 }
export const DEFAULT_HEAD_MULTIPLIER = 3
export const HEADCRIT_FACTIONS = new Set([
  'None', 'Grineer', 'Kuva Grineer', 'Scaldra', 'Orokin', 'Narmer', 'Anarchs', 'Infested', 'Infested Deimos', 'Sentient',
])
export const HEADCRIT_MULTIPLIER = 2

// auto values when the target panel isn't overriding them
export const headMultiplierFor = (faction: string) => HEAD_WEAK_POINT_MULTIPLIER[faction] ?? DEFAULT_HEAD_MULTIPLIER
export const hasHeadcrits = (faction: string) => HEADCRIT_FACTIONS.has(faction)

// a couple of the U36 faction names don't match what people call them in game
export const FACTION_LABELS: Record<string, string> = { Orokin: 'Orokin (Corrupted)', Zariman: 'Zariman (Void)' }
export const factionLabel = (faction: string) => FACTION_LABELS[faction] ?? faction
export const WEAK_POINT_BONUS_RATE_ON_HEAD = 1.5 // weak point damage bonuses count 1.5x on heads

// ---- melee combo (wiki Melee_Combo) ----
// every 20 hits adds 1x, starting at 1x and capping at 12x on 220 hits. Venka Prime goes to 13x,
// Dex Nikana needs only 11 hits per tier but caps at 11x
export const DEFAULT_MAX_COMBO = 12
const MAX_COMBO_BY_WEAPON: Record<string, number> = { 'Venka Prime': 13, 'Dex Nikana': 11 }
const HITS_PER_TIER_BY_WEAPON: Record<string, number> = { 'Dex Nikana': 11 }
export const maxComboFor = (weaponName: string) => MAX_COMBO_BY_WEAPON[weaponName] ?? DEFAULT_MAX_COMBO
export const hitsPerComboTier = (weaponName: string) => HITS_PER_TIER_BY_WEAPON[weaponName] ?? 20
// Heavy Attack Efficiency keeps part of the counter, capped at 90% (wiki Melee_Combo)
export const MAX_HEAVY_EFFICIENCY = 0.9
// Gladiator set bonus: +10% melee crit chance per piece, per combo multiplier, same shape as Blood Rush
export const GLADIATOR_CRIT_PER_PIECE = 0.1
export const GLADIATOR_MAX_PIECES = 6
`,te=`// the damage pipeline, following wiki.warframe.com/w/Damage/Calculation:
//   1. proportions of each damage type vs base damage (physical/elemental mods, element combining)
//   2. quantize each type to the nearest 1/32 of base damage
//   3. x modded base damage (base x (1 + damage mods)), x faction bonus, x crit
//   4. per type: faction weakness x armor (health only) x viral/magnetic, then other vulnerabilities
// status DoTs use the same modded base, but faction applies twice and only literal element mods count.

import {
  AMMO_EFFICIENCY_CAP, BANE_TARGET, BLAST_DETONATION_MULTIPLIER, CAPPED_STATUS_STACKS, GLADIATOR_CRIT_PER_PIECE, GLADIATOR_MAX_PIECES, MAX_HEAVY_EFFICIENCY, hitsPerComboTier, maxComboFor, HEADCRIT_MULTIPLIER, WEAK_POINT_BONUS_RATE_ON_HEAD, hasHeadcrits, headMultiplierFor, COMBINED_ELEMENTS, DAMAGE_TYPES, DOT_STATUSES, FACTION_DAMAGE_MODIFIERS, PHYSICAL_TYPES, PRIMARY_ELEMENTS,
  coldCritMultiplierBonus, magneticMultiplier, punctureCritChanceBonus, tauStatusChanceBonus, viralMultiplier,
} from './constants'
import { parseUpgrade, scopeApplies, type ModEffect, type StatKey } from './parseMod'
import { arcanesById } from '../data'
import { exaltedRuleFor } from '../data/exalted'
import { NIRA_SLAM_PER_PIECE, VIGILANTE_ENHANCE_PER_PIECE, addPieces, countSets, setEnhancement, setSummary } from './modSets'
import { resolveCoBehavior, type CoBehavior } from './conditionOverload'
import { perkAppliesTo, type PerkEffect, type SelectedPerk } from './incarnon'
import { armorDamageMultiplier, effectiveArmor } from './target'
import { hasBonusElement, type BonusElement, type WeaponPassive } from '../data/passives'
import { SHELL_BY_SHELL_RELOAD } from '../data/reloads'
import { compressionFor } from '../data/compression'
import { abilitiesById, abilityApplies, castStacks, effectsFor, scaledValue, strengthFor, type AbilityCast } from '../data/warframeAbilities'
import { biggestHit, comboTotal, forcedProcShares, heavyComboFor, type HeavyCombo, type HeavyMode } from '../data/heavyAttacks'
import { attenuatedTimeToKill, expectedDamage, simulateDamage, type DamageRange, type ShotModel } from './simulate'
import { STANCES, applyStance, bestCombo, comboLabel, usesStance, type StanceChoice } from '../data/stances'

// "sustained" = average DPS over a fight this long: reloads, DoT ramp-up and Heat stacking count, and DoT ticks
// after the fight ends don't (so long Status Duration tails stop inflating it)
// one Incarnon swap (in or out) in base reloads. the Genesis pages say "equal to the weapon's reload speed", but in game it's
// longer, so 2x until there's a measured number
export const INCARNON_SWAP_RELOADS = 2
export const SUSTAINED_FIGHT_SECONDS = 10 // about how long one tough enemy lives; Heat stacks die with it
// the DoTs a beam's merged tick feeds twice (wiki Multishot)
const GAS_MAX_INSTANCES = 10
const BEAM_MERGED_DOTS = ['slash', 'heat', 'toxin', 'electricity', 'blast', 'gas'] // wiki Multishot's list, Blast included
import type { Attack, Buffs, Debuffs, EquippedArcane, EquippedMod, TargetSettings, Weapon } from '../types'

export interface CalcInput {
  weapon: Weapon
  attack: Attack
  mods: EquippedMod[]
  arcane?: EquippedArcane | null
  coBehavior?: CoBehavior // defaults to the wiki table for this weapon/attack
  incarnonPerks?: SelectedPerk[]
  passives?: SelectedPassive[] // weapon passives (src/data/passives.ts)
  bonusElement?: BonusElement | null // Kuva/Tenet/Coda bonus element
  heavyMode?: HeavyMode // multi-hit heavies: score the biggest hit (default) or every hit added up
  stance?: StanceChoice | 'none' | null // melee Normal Attack: which stance combo (null = the best one, 'none' = one plain swing per attack speed)
  target: TargetSettings
  armor: number // target armor before debuffs (already level scaled)
  debuffs: Debuffs
  buffs: Buffs
}

export interface SelectedPassive {
  passive: WeaponPassive
  stacks: number // only matters for passives with a condition
}

export interface DamageTypeRow {
  damageType: string
  modded: number // per projectile, no crit, no faction, before target modifiers
  vsTarget: number // average per projectile vs the target, crits averaged in
  procShare: number // share of status procs this type gets
}

export interface CritSplit {
  normal: number // the proc came from a non-crit (or lowest tier) hit
  crit: number // the proc came from a crit (next tier up) hit
  average: number // crits averaged in
}

export interface DotRow {
  damageType: string
  procsPerSecond: number
  tick: CritSplit // vs target
  ticks: number
  perProc: CritSplit // tick x ticks
  dps: number
  aoe: { label: string; damage: CritSplit } | null // damage to *other* enemies (Blast detonation)
  note: string
  // what the tick is made of (the formula panel), tick = fraction x statusBase x element x faction x (1 + status damage)
  // x (1 + vulnerability) x headshot x merged x type, crits on top
  factors: {
    fraction: number; statusBase: number; element: number; faction: number; statusDamage: number; vulnerability: number
    headshot: number; merged: number; type: number
  }
}

// the factors behind one hit (the formula panel). hit.average = (sum of modded x type + extraHit) x faction x
// (1 + vulnerability) x headshot x (critAverage + attrition)
// one piece of a damage type's share of base damage
export type TypePart =
  | { kind: 'physical'; base: number; mod: number } // base share x (1 + IPS mods)
  | { kind: 'element'; element: string; mod: number; innate: number } // element mods (% of all base) + innate share
  | { kind: 'separate'; source: 'passive' | 'ability'; value: number } // doesn't combine (Tonkkatt, Freeze Force)

export interface HitBreakdown {
  baseDamage: number
  damageBonus: number // damage mods (Serration...), as a fraction
  separateMultiplier: number // Sharpshot, slam/throw bonuses, exalted finals...
  coMode: 'add' | 'multiply' | 'none'
  coBonus: number
  heavyCombo: number // heavy attack / exalted combo multiplier, 1 otherwise
  damageScale: number
  types: { damageType: string; share: number; modded: number; type: number; weakness: number; armor: number; debuff: number; debuffName: string }[] // share = quantized fraction of base
  // where each type's share comes from, for the formula panel: raw = before quantizing, parts add up to raw
  typeParts: { damageType: string; raw: number; parts: TypePart[] }[]
  extraHit: number // Xata's Whisper style separate hits (faction already in)
  faction: number
  vulnerability: number
  headshot: number
  critChance: number
  critMultiplier: number
  critAverage: number
  critNormal: number
  critHit: number
  attrition: number
}

export interface CalcResult {
  damageTypes: DamageTypeRow[]
  moddedBaseDamage: number
  critChance: number
  critMultiplier: number
  critTier: number // 0 = can't crit, 1 = yellow, 2 = orange, 3+ = red
  statusChance: number
  multishot: number
  multishotLocked: boolean
  beam: boolean // multishot beams merge into one tick (wiki Multishot)
  beamMerge: number // beams per merged tick (multishot on a beam, 1 otherwise): one instance = hit x beamMerge
  multishotModsIgnored: boolean // hitscan explosion / beam blast / speargun throw
  fireRate: number
  factionMultiplier: number
  activeStatusTypes: number
  conditionOverload: { mode: CoBehavior['mode']; bonus: number; source: CoBehavior['source']; note?: string }
  headshot: { applied: boolean; factor: number; weakPointMultiplier: number; headshotBonus: number; headcrit: boolean }
  armor: { before: number; after: number; damageMultiplier: number }
  hit: { normal: number; crit: number; average: number } // per projectile vs target
  // the biggest single damage instance this attack can land: top crit tier (or a Devouring Attrition non-crit if that's
  // bigger), a beam's merged tick. what matters for the 32-bit damage limit. DoT ticks are their own instances
  peakHit: number
  peakDotTick: { damageType: string; value: number } | null
  averageShot: number
  attackTotal: number // one attack: every pellet/duplicate + the full DoT of its procs
  // an Incarnon form's whole battery: shots in it, time to fire them all, the damage they do (DoTs included), and the refill
  // (weak point hits + swaps) before the next one. null for anything that isn't a charged Incarnon form
  battery: { rounds: number; shots: number; seconds: number; damage: number; refillSeconds: number | null } | null
  duplicateStrikes: number // Melee Duplicate: average strikes per attack (1 without it)
  burstDps: number
  procsPerSecond: number
  dots: DotRow[]
  dotDps: number
  totalDps: number // burst: direct + DoT while firing nonstop
  magazineSize: number | null // null = no reload modeled (melee, Incarnon form)
  reloadTime: number | null
  uptime: number // share of time spent firing
  sustainedDps: number // expected damage over a SUSTAINED_FIGHT_SECONDS fight / its length
  partShotModels?: ShotModel[] // a merged attack's parts, each on its own timeline (attenuation maps each part's hits separately)
  timeToKill: number | null // seconds to kill target.pool (shields then health), null without a pool, Infinity if it can't
  steadyStateDps: number // old formula: burst x uptime, every DoT tick counted, no Heat stacking
  shellByShell: boolean // reloads one shell at a time (reload time grows with magazine size)
  damageInWindow: (seconds: number) => number // expected damage in the first \`seconds\`
  simulateWindows: (windows: number[], runs?: number) => DamageRange[] // Monte Carlo range (crit/status rolls)
  shotModel: ShotModel
  fireRateLocked: boolean
  passives: string[] // names of the passives that are on for this attack
  abilities: string[] // Warframe abilities that apply to this weapon
  setBonuses: ReturnType<typeof setSummary> // mod sets with pieces equipped (weapon + Warframe)
  requirements: string[] // every conditional the numbers assume (kills, headshots, buffs up, frozen target...)
  statusTriggers: { key: string; type: string }[] // status-triggered buffs that were on ("upgrade|trigger", status type or 'any')
  procTypes: string[] // statuses this attack actually applies
  heavyCombo: { combo: HeavyCombo; mode: HeavyMode; multiplier: number } | null // multi-hit heavy, what got scored
  detonation: { ownProcs: number; existingStacks: number } | null // Harmony heavy: DoT damage dealt at once, per heavy
  melee: {
    combo: number // multiplier actually used (clamped to the weapon's cap)
    heavy: boolean
    critFromCombo: number // Blood Rush + Gladiator set, added inside the crit mod bracket
    statusFromCombo: number // Weeping Wounds
    windUp: number | null // modded heavy wind-up
    comboAfterHeavy: number | null // multiplier left after the heavy attack (Heavy Attack Efficiency)
  } | null
  statusTypeSource: 'build' | 'debuffs'
  unparsed: string[]
  breakdown: HitBreakdown
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

// Secondary Enervate (wiki): every hit adds a flat \`step\` crit chance ("Critical chance is an absolute bonus"), and it all
// resets after \`resets\` Big Critical Hits ("any tier above regular Critical Hits", so orange or better). a hit at crit c is
// big with chance c - 1 between 100% and 200%, always above. I follow the chance of being at each big-crit count hit by
// hit through one cycle; average crit per hit = expected crit summed over the cycle / expected cycle length
export function enervateAverageCrit(startCrit: number, step: number, resets: number): number {
  let alive: number[] = Array.from({ length: resets }, (_, index) => (index === 0 ? 1 : 0)) // chance of being on hit k with j big crits
  let critSum = 0
  let hits = 0
  for (let hit = 0; hit < 100000; hit++) {
    const mass = sum(alive)
    if (mass < 1e-12) break
    const crit = startCrit + step * hit
    critSum += mass * crit
    hits += mass
    const bigChance = Math.min(1, Math.max(0, crit - 1))
    const next = alive.map((share) => share * (1 - bigChance))
    for (let big = 0; big + 1 < resets; big++) next[big + 1] += alive[big] * bigChance // the last big crit ends the cycle
    alive = next
  }
  return hits > 0 ? critSum / hits : startCrit
}
// rounds to the nearest 1/32, sign(x) * floor(|x| * 32 + 0.5) / 32
const quantize = (proportion: number) => (Math.sign(proportion) * Math.floor(Math.abs(proportion) * 32 + 0.5)) / 32

// "On Toxin Status Effect:" (Primary Blight), "On Melee Electricity Status:", "On Status Effect:" -> the status it waits
// for ('any' for no type), null when the trigger isn't a status one
export function statusTrigger(trigger: string): string | null {
  // Incarnon wording: "On hitting Electricity-affected enemies" (Furis Stormburst), "On Toxin-affected targets"
  const affected = trigger.match(/^On (?:hitting )?([A-Za-z]+)[- ]affected\\b|^On hitting ([A-Za-z]+) target/i)
  if (affected) {
    const type = (affected[1] ?? affected[2]).toLowerCase()
    return DAMAGE_TYPES.includes(type) ? type : null
  }
  const match = trigger.match(/^On (?:Weapon |Melee )?(?:([A-Za-z]+) )?Status\\b/i)
  if (!match) return null
  const type = match[1]?.toLowerCase()
  return type && DAMAGE_TYPES.includes(type) ? type : 'any'
}

// status-triggered buffs only count when the build actually lands that status. Primary Blight on a pure Electricity
// Alternox never gets a stack, so the optimizer was picking it for free crit damage. I run the calc, and if a status
// trigger's type never procs, run it again with that trigger off (turning it off can't add a status, so once is enough)
// time to kill a boss pool (target.pool): shields first, then health, each off the expected damage over time (reloads,
// Incarnon refills, DoTs as they land). "toxin skips shields" is left to the shield layer's own numbers
export const SHOTGUN_COMPENSATION = 0.7
export function calculate(rawInput: CalcInput): CalcResult {
  const pool = rawInput.target.pool
  if (!pool) return calculateLayers(rawInput)
  const vsHealth = calculateLayers({ ...rawInput, target: { ...rawInput.target, layer: 'health' } })
  const vsShield = pool.shield > 0 ? calculateLayers({ ...rawInput, target: { ...rawInput.target, layer: 'shield' } }) : null
  // attenuated bosses: caps "proportional to Max Health" (Update 40), only health counts toward them
  const attenuation = rawInput.target.attenuation
  if (attenuation) {
    // multi-pellet weapons get a smaller per-trigger cap: the standardized model's "ShotgunCompensation = 0.7 if base multishot > 0"
    // (wiki Archon, Damage Resistance Parameters). the page doesn't say what it multiplies, I'm putting it on the per-trigger cap
    const baseMultishot = rawInput.attack.multishot ?? rawInput.weapon.multishot ?? 1
    const shotgunCompensation = baseMultishot > 1 ? SHOTGUN_COMPENSATION : 1
    const caps = { mdpt: attenuation.perTrigger * pool.health * shotgunCompensation, mdps: attenuation.perSecond * pool.health }
    if (rawInput.target.exactTimeToKill) {
      const models = (result: CalcResult) => result.partShotModels ?? [result.shotModel]
      return { ...vsHealth, timeToKill: attenuatedTimeToKill(vsShield ? models(vsShield) : null, pool.shield, models(vsHealth), pool.health, caps) }
    }
    // the search's estimate: each layer takes at least its unattenuated time, and at least pool / (its rate after the caps): the
    // per-trigger map on the direct part, DoTs as they are, the total held to MDPS
    const capped = (result: CalcResult) => {
      // per part (a merged attack's blast is mapped as the blast, not spread over the beam ticks)
      const firing = sum((result.partShotModels ?? [result.shotModel]).map((model) => {
        const trigger = model.hit.average * model.multishot
        const mapRatio = trigger > 0 ? caps.mdpt / (trigger + caps.mdpt) : 1
        const dots = sum(model.dots.map((dot) => dot.procsPerPellet * model.multishot * dot.tick.average * Math.max(1, dot.ticks)))
        return (trigger * mapRatio + dots) * model.fireRate
      }))
      // the cap bites while firing, so it goes on before the reload / refill share (a short Incarnon battery is capped, then idle)
      return Math.min(caps.mdps, firing) * result.uptime
    }
    const layer = (result: CalcResult, amount: number) => (amount > 0 ? Math.max(timeToReach(result, amount), amount / Math.max(1e-9, capped(result))) : 0)
    return { ...vsHealth, timeToKill: (vsShield ? layer(vsShield, pool.shield) : 0) + layer(vsHealth, pool.health) }
  }
  const shieldSeconds = vsShield ? timeToReach(vsShield, pool.shield) : 0
  return { ...vsHealth, timeToKill: shieldSeconds + timeToReach(vsHealth, pool.health) }
}

// when damageInWindow reaches the amount: start from the steady rate and correct a few times (damage over time is close to a
// straight line once reloads and DoTs settle in), then halve the bracket. cheap enough for the optimizer
const TTK_LIMIT = 600
function timeToReach(result: CalcResult, amount: number): number {
  if (amount <= 0) return 0
  const rate = result.steadyStateDps
  if (!(rate > 0)) return Infinity
  let time = amount / rate
  for (let step = 0; step < 6; step++) {
    // past 10 minutes it's extrapolated at the 10-minute rate instead of Infinity, so a weak build still scores something and
    // the optimizer has a slope to climb (an unmodded weapon vs a level 375 boss would otherwise score 0 everywhere)
    if (time >= TTK_LIMIT) {
      const capped = result.damageInWindow(TTK_LIMIT)
      return capped >= amount ? TTK_LIMIT : capped > 0 ? TTK_LIMIT * amount / capped : Infinity
    }
    const dealt = result.damageInWindow(time)
    if (dealt <= 0) { time = time * 2 + 0.5; continue }
    const next = Math.max(0.01, time * amount / dealt)
    if (Math.abs(next - time) < 0.005 * time + 0.002) { time = next; break }
    time = next
  }
  // damage comes in steps (one shot at a time), so the secant lands on the far side of the killing shot's step. a few halvings
  // over the last shot interval pull it back to when that shot lands
  const interval = 1 / Math.max(1e-6, result.shotModel.fireRate)
  let low = Math.max(0, time - interval), high = time
  if (result.damageInWindow(high) < amount) return Math.min(time, TTK_LIMIT)
  for (let step = 0; step < 5; step++) {
    const middle = (low + high) / 2
    if (result.damageInWindow(middle) >= amount) high = middle
    else low = middle
  }
  return Math.min(high, TTK_LIMIT)
}

function calculateLayers(rawInput: CalcInput): CalcResult {
  const input = withStance(rawInput)
  // a whole shot: every part with the same build, each on its own rules, then added up per shot
  const parts = partsOf(input)
  // a whole shot's parts all hit the same enemy, so each part's CO / Galvanized count includes the status types the
  // other parts apply (Bubonico's Burst counts the Radial Attack's Viral). first pass finds them, second pass uses them
  const appliedTypes = (result: CalcResult) => [
    ...(result.statusChance > 0 ? result.damageTypes.filter((row) => row.modded > 0).map((row) => row.damageType) : []),
    ...result.procTypes,
  ].filter((type) => type !== 'true')
  const run = (off: string[], others: string[][]) => parts.map((part, index) => calculateOnce(part, off, others[index] ?? []))
  const first = run([], [])
  // a part scored on its own (Latron's Incarnon direct hit) still comes with the rest of its shot in game, so the other
  // parts' procs count for its triggers too (the AoE's Puncture keeps Riddled Target up for the direct hit)
  const siblingProcTypes = (): string[] => {
    if (parts.length > 1) return []
    const owner = input.weapon.attacks.find((attack) => attack.parts?.includes(input.attack.name))
    if (!owner) return []
    return partsOf({ ...input, attack: owner }).filter((part) => part.attack.name !== input.attack.name)
      .flatMap((part) => calculateOnce(part, [], []).procTypes)
  }
  const ownProcTypes = first.flatMap((result) => result.procTypes)
  const anyDead = first.some((result) => result.statusTriggers.length > 0)
  const procTypes = [...new Set([...ownProcTypes, ...(anyDead ? siblingProcTypes() : [])])]
  const dead = [...new Map(first.flatMap((result) => result.statusTriggers).map((trigger) => [trigger.key, trigger])).values()]
    .filter(({ type }) => (type === 'any' ? procTypes.length === 0 : !procTypes.includes(type)))
  const others = parts.length > 1 ? first.map((_, index) => first.filter((__, other) => other !== index).flatMap(appliedTypes)) : []
  const results = dead.length || others.some((list) => list.length) ? run(dead.map(({ key }) => key), others) : first
  return results.length === 1 ? results[0] : combineParts(results, parts.map((part) => part.attack.name))
}

// melee Normal Attack through a stance combo (src/data/stances.ts): average combo hit, combo hits per second
function withStance(input: CalcInput): CalcInput {
  if (input.stance === 'none' || !usesStance(input.weapon, input.attack)) return input
  const choice = input.stance ?? bestCombo(input.weapon)
  const combo = choice ? STANCES[choice.stance]?.combos[choice.combo] : null
  if (!choice || !combo) return input
  const { attack, forcedSlashPerHit } = applyStance(input.attack, combo)
  const rate = (combo.hits / combo.duration).toFixed(2)
  return { ...input, attack: { ...attack,
    ...(forcedSlashPerHit > 0 ? { forcedProcChance: { ...attack.forcedProcChance, slash: forcedSlashPerHit } } : {}),
    stanceNote: \`Stance combo \${comboLabel(choice)} on repeat: \${combo.hits} hits for \${combo.multiplier}x damage in \${combo.duration} s at 1.0 attack speed (\${rate} hits/s before attack speed)\${combo.bleeds ? \`, \${combo.bleeds} forced Slash\` : ''} (wiki Module:Stances)\`,
  } }
}

// the attacks a whole shot is made of. each part gets its own CO rule (the radial part of a hitscan shot doesn't get
// the shot's CO), unless the CO was set by hand
function partsOf(input: CalcInput): CalcInput[] {
  if (!input.attack.parts?.length) return [input]
  const found = input.attack.parts.map((name) => input.weapon.attacks.find((attack) => attack.name === name && !attack.parts))
  if (found.some((attack) => !attack)) return [input]
  // parts that only happen on a headshot or only on a body shot follow the target's headshot toggle
  const happens = (attack: Attack) => (input.target.headshot ? !attack.bodyShotOnly : !attack.headshotOnly)
  return (found as Attack[]).filter(happens).map((attack) => ({
    ...input, attack, coBehavior: input.coBehavior?.source === 'override' ? input.coBehavior : resolveCoBehavior(input.weapon, attack),
  }))
}

const firstTickFor = (damageType: string) =>
  damageType === 'blast' ? 1.5 : damageType === 'electricity' || damageType === 'gas' || damageType === 'cascadia' ? 0 : 1

// one shot's worth of every part. the direct part (first) is what the shot "is" for the stat lines (crit, status, fire
// rate, magazine); damage numbers are added up. the biggest single instance stays the biggest one part lands, since in
// game they're separate hits. parts at another fire rate keep their own (Alternox's alt-fire explosion)
function combineParts(results: CalcResult[], names: string[]): CalcResult {
  const [main] = results
  const add = (pick: (result: CalcResult) => number) => sum(results.map(pick))
  const labelFor = (index: number) => (index === 0 ? '' : \` (\${names[index]})\`)
  const byType = new Map<string, DamageTypeRow>()
  results.forEach((result) => result.damageTypes.forEach((row) => {
    const existing = byType.get(row.damageType)
    byType.set(row.damageType, existing
      ? { ...existing, modded: existing.modded + row.modded, vsTarget: existing.vsTarget + row.vsTarget }
      : { ...row })
  }))
  const totalProcs = add((result) => result.procsPerSecond)
  const procsByType = new Map<string, number>()
  results.forEach((result) => result.damageTypes.forEach((row) => procsByType.set(row.damageType, (procsByType.get(row.damageType) ?? 0) + row.procShare * result.procsPerSecond)))
  const damageTypes = [...byType.values()].map((row) => ({ ...row, procShare: totalProcs > 0 ? (procsByType.get(row.damageType) ?? 0) / totalProcs : 0 }))
    .sort((a, b) => b.modded - a.modded)
  const dots = results.flatMap((result, index) => result.dots.map((dot) => ({ ...dot, damageType: \`\${dot.damageType}\${labelFor(index)}\` })))
  // the formula panel's timeline: the main part's shots, every part's damage per main-part pellet
  const mainPellets = Math.max(1e-9, main.shotModel.multishot)
  const scale = (result: CalcResult) => result.shotModel.multishot / mainPellets
  const shotModel: ShotModel = {
    ...main.shotModel,
    hit: {
      normal: add((result) => result.shotModel.hit.normal * scale(result)),
      crit: add((result) => result.shotModel.hit.crit * scale(result)),
      average: add((result) => result.shotModel.hit.average * scale(result)),
    },
    dots: results.flatMap((result, index) => result.shotModel.dots.map((dot) => ({ ...dot, damageType: \`\${dot.damageType}\${labelFor(index)}\`, procsPerPellet: dot.procsPerPellet * scale(result) }))),
  }
  const peak = results.reduce((best, result) => (result.peakHit > best.peakHit ? result : best), main)
  const peakDot = results.map((result) => result.peakDotTick).filter((tick): tick is NonNullable<typeof tick> => Boolean(tick))
    .sort((a, b) => b.value - a.value)[0] ?? null
  const unique = (lists: string[][]) => [...new Set(lists.flat())]
  return {
    ...main,
    damageTypes,
    moddedBaseDamage: add((result) => result.moddedBaseDamage),
    hit: { normal: add((result) => result.hit.normal), crit: add((result) => result.hit.crit), average: add((result) => result.hit.average) },
    peakHit: peak.peakHit,
    peakDotTick: peakDot,
    averageShot: add((result) => result.averageShot),
    attackTotal: add((result) => result.attackTotal),
    // a whole cycle (Onos's beam + blast): every part's battery damage added up, the slowest part's firing time
    battery: main.battery ? {
      ...main.battery,
      seconds: Math.max(...results.map((result) => result.battery?.seconds ?? 0)),
      damage: add((result) => result.battery?.damage ?? 0),
    } : null,
    burstDps: add((result) => result.burstDps),
    procsPerSecond: totalProcs,
    dots,
    dotDps: add((result) => result.dotDps),
    totalDps: add((result) => result.totalDps),
    sustainedDps: add((result) => result.sustainedDps),
    timeToKill: null,
    partShotModels: results.map((result) => result.shotModel),
    steadyStateDps: add((result) => result.steadyStateDps),
    damageInWindow: (seconds: number) => sum(results.map((result) => result.damageInWindow(seconds))),
    // luck ranges added part by part, so the spread comes out a bit wider than one roll of the whole shot would be
    simulateWindows: (windows: number[], runs?: number) => {
      const each = results.map((result) => result.simulateWindows(windows, runs))
      return windows.map((_, index) => ({
        low: sum(each.map((ranges) => ranges[index].low)), expected: sum(each.map((ranges) => ranges[index].expected)),
        median: sum(each.map((ranges) => ranges[index].median)), high: sum(each.map((ranges) => ranges[index].high)),
      }))
    },
    shotModel,
    activeStatusTypes: Math.max(...results.map((result) => result.activeStatusTypes)),
    passives: unique(results.map((result) => result.passives)),
    abilities: unique(results.map((result) => result.abilities)),
    requirements: unique([[\`Whole shot: \${names.join(' + ')}, each part on its own rules (CO, multishot, headshots), added up per shot\`], ...results.map((result) => result.requirements)]),
    statusTriggers: [...new Map(results.flatMap((result) => result.statusTriggers).map((trigger) => [trigger.key, trigger])).values()],
    procTypes: unique(results.map((result) => result.procTypes)),
    unparsed: unique(results.map((result) => result.unparsed)),
  }
}

function calculateOnce({
  weapon, attack, mods, arcane, coBehavior, incarnonPerks = [], passives = [], bonusElement, heavyMode = 'biggestHit', target, armor, debuffs, buffs,
}: CalcInput, offTriggers: string[], otherPartStatusTypes: string[] = []): CalcResult {
  // multi-hit heavies (src/data/heavyAttacks.ts): the export's heavy number isn't one hit, so rescale the Heavy Attack to
  // the biggest single hit, or every hit added up for the "full heavy" ranking
  const heavyComboData = attack.heavy && attack.heavyMultiplier ? heavyComboFor(weapon.name) : null
  let heavyCombo: CalcResult['heavyCombo'] = null
  if (heavyComboData && attack.heavyMultiplier) {
    const multiplier = heavyMode === 'fullCombo' ? comboTotal(heavyComboData) : biggestHit(heavyComboData)
    const scale = multiplier / attack.heavyMultiplier
    // each hit's forced Bleed / Impact / Puncture, weighted by that hit's share of the scored damage
    const forced = { ...attack.forcedProcChance }
    for (const [damageType, share] of Object.entries(forcedProcShares(heavyComboData, heavyMode))) forced[damageType] = (forced[damageType] ?? 0) + share
    attack = {
      ...attack,
      damage: Object.fromEntries(Object.entries(attack.damage).map(([damageType, amount]) => [damageType, amount * scale])),
      heavyMultiplier: multiplier,
      forcedProcChance: forced,
    }
    heavyCombo = { combo: heavyComboData, mode: heavyMode, multiplier }
  }
  // exalted / pseudo-exalted weapons (src/data/exalted.ts): base damage x your Ability Strength, or a strength damage bonus
  const exalted = exaltedRuleFor(weapon)
  const exaltedStrength = buffs.warframe?.abilityStrength ?? 1
  if (exalted?.strength === 'base') {
    attack = { ...attack, damage: Object.fromEntries(Object.entries(attack.damage).map(([damageType, amount]) => [damageType, amount * exaltedStrength])) }
  }
  // the target's status behaviour: an immune one has no statuses on it at all (no CO count, no Viral, no Heat strip, no
  // procs), a capped one holds at most 4 stacks of each
  const statusMode = target.statusMode ?? 'normal'
  if (statusMode !== 'normal') {
    const immune = statusMode === 'immune'
    debuffs = {
      ...debuffs,
      stacks: Object.fromEntries(Object.entries(debuffs.stacks).map(([statusType, count]) => [statusType, immune ? 0 : Math.min(count, CAPPED_STATUS_STACKS)])),
      heatArmorStrip: immune ? 0 : debuffs.heatArmorStrip,
      liftedOrKnockedDown: immune ? false : debuffs.liftedOrKnockedDown,
    }
  }
  // status types the target never takes (The Fragmented One: Viral) have no stacks on it and the build's procs of them don't land
  if (target.statusImmune?.length) debuffs = { ...debuffs, stacks: Object.fromEntries(Object.entries(debuffs.stacks).map(([statusType, count]) => [statusType, target.statusImmune!.includes(statusType) ? 0 : count])) }
  const stacks = (statusType: string) => debuffs.stacks[statusType] ?? 0
  // CO counts status *types*, not stacks. Lifted/knocked down is a hidden status that also counts
  const debuffStatusTypes = Object.values(debuffs.stacks).filter((count) => count > 0).length

  // ---- 1. collect mod effects ----
  const bonus: Record<StatKey, number> = {
    damage: 0, damagePerStatusType: 0, damagePerColdStack: 0, critChance: 0, weakpointCritChance: 0,
    critDamage: 0, multishot: 0, fireRate: 0, statusChance: 0, statusDamage: 0, headshotMultiplier: 0, weakpointDamage: 0,
    magazineCapacity: 0, reloadSpeed: 0, ammoEfficiency: 0,
    critChancePerCombo: 0, statusChancePerCombo: 0, heavyCritChance: 0, heavyDamage: 0, heavyWindUpSpeed: 0, heavyEfficiency: 0,
    statusDuration: 0, slamDamage: 0, throwDamage: 0, finisherDamage: 0,
  }
  const physicalBonus: Record<string, number> = {}
  const elementBonus: Record<string, number> = {} // literal mod bonus per element, also used for DoTs
  const elementOrder: string[] = [] // slot order matters for combining
  let factionBonus = buffs.roar // Roar is additive with bane mods
  let slashOnCritChance = 0
  let slashOnImpactChance = 0
  let overguardMultiplier = 1
  let separateDamageMultiplier = 1 // Longbow Sharpshot style, multiplies outside the damage mods
  let multishotLocked = false // Acuity mods
  let duplicateOnCritChance = 0 // Melee Duplicate
  let napalm: Extract<ModEffect, { kind: 'napalm' }> | null = null // Nightwatch Napalm
  let critPerPunctureStatus = 0 // Melee Doughty
  let platedRound = 0 // Primary Plated Round's coefficient (0.15)
  let flatPerProc = 0 // Cascadia Empowered
  let bodyShotMultiplier = 1 // Meticulous Aim
  let noBodyCrit = false // King's Gambit
  const modFlat = { critChance: 0, statusChance: 0 } // "+20 Final Status Chance" (Entropy Burst, Napalm Grenades)
  let critPerHit: { value: number; resetsAfter: number } | null = null // Secondary Enervate
  let infiniteAmmo = false
  const fireRateLocked = mods.some(({ mod }) => mod.locksFireRate) // Semi-___ Cannonade: fire rate stays at base
  const unparsed: string[] = []
  // elements added on top of the weapon's own (Melee Exposure's Corrosive, Tonkkatt's Heat, Lesion's Toxin): they add
  // damage but don't combine with other elements and don't take a share of the status procs, so they can't dilute
  // your procs and don't proc on their own. you still need status chance + your own elements for procs
  const separateElements: Record<string, number> = {}
  const forcedProcsPerPellet: Record<string, number> = {} // guaranteed procs on every hit (Reconifex's Heat rounds)
  // the attack's own forced procs (glaive detonations, from build-data)
  for (const damageType of attack.forcedProcs ?? []) forcedProcsPerPellet[damageType] = (forcedProcsPerPellet[damageType] ?? 0) + 1
  for (const [damageType, share] of Object.entries(attack.forcedProcChance ?? {})) forcedProcsPerPellet[damageType] = (forcedProcsPerPellet[damageType] ?? 0) + share

  const applyEffect = (effect: ModEffect, times: number) => {
    switch (effect.kind) {
      case 'stat':
        bonus[effect.stat] += effect.value * times
        // a single 100%+ Ammo Efficiency source (Skull Shots, Brain Storm, Arcane Pistoleer) is "Infinite Ammo" now
        if (effect.stat === 'ammoEfficiency' && effect.value >= 1 && times > 0) infiniteAmmo = true
        break
      case 'faction':
        if (BANE_TARGET[target.faction] === effect.faction) factionBonus += effect.value * times
        break
      case 'slashOnCrit':
        slashOnCritChance += effect.value * times
        break
      case 'slashOnImpact':
        slashOnImpactChance += effect.value * times
        break
      case 'overguardMultiplier':
        overguardMultiplier *= effect.value
        break
      case 'damageMultiplier':
        separateDamageMultiplier *= 1 + effect.value * times
        break
      case 'lockMultishot':
        multishotLocked = true
        break
      case 'flatStat':
        modFlat[effect.stat] += effect.value * times
        break
      case 'critPerHit':
        if (times > 0) critPerHit = { value: effect.value, resetsAfter: effect.resetsAfter }
        break
      case 'forcedProcChance':
        forcedProcsPerPellet[effect.damageType] = (forcedProcsPerPellet[effect.damageType] ?? 0) + effect.value * times
        break
      case 'duplicateOnCrit':
        duplicateOnCritChance += effect.value * times
        break
      case 'napalm':
        napalm = effect
        break
      case 'critPerPunctureStatus':
        critPerPunctureStatus += effect.value * times
        break
      case 'damagePerMagazine':
        platedRound += effect.coefficient * times
        break
      case 'flatPerProc':
        flatPerProc += effect.value * times
        break
      case 'bodyShotMultiplier':
        bodyShotMultiplier *= 1 + effect.value * times
        break
      case 'noBodyCrit':
        if (times > 0) noBodyCrit = true
        break
      case 'heavyScaledCritChance':
        // normal attacks get the value, heavies get value x factor, so the extra part only counts on heavies
        bonus.critChance += effect.value * times
        bonus.heavyCritChance += effect.value * (effect.heavyFactor - 1) * times
        break
      case 'damageType':
        if (PHYSICAL_TYPES.includes(effect.damageType)) {
          physicalBonus[effect.damageType] = (physicalBonus[effect.damageType] ?? 0) + effect.value * times
        } else {
          if (!(effect.damageType in elementBonus)) elementOrder.push(effect.damageType)
          elementBonus[effect.damageType] = (elementBonus[effect.damageType] ?? 0) + effect.value * times
        }
    }
  }

  // mod sets: pieces on this weapon + on the Warframe (src/calc/modSets.ts)
  const setPieces = addPieces(countSets(mods.map(({ mod }) => mod)), buffs.warframe?.setPieces)

  // mods and the arcane use the same stat text, so they go through the same parser
  const upgrades = [
    // set members get their set's enhancement (Umbra, Sacrificial: "Enhance mods in this set")
    ...mods.map(({ mod, rank, conditionalStacks }) => ({ name: mod.name, levelStats: mod.levelStats, rank, conditionalStacks, enhance: setEnhancement(mod, setPieces) })),
    ...(arcane ? [{ name: arcane.arcane.name, levelStats: arcane.arcane.levelStats, rank: arcane.rank, conditionalStacks: arcane.conditionalStacks, isArcane: true }] : []),
    // the Warframe's arcanes (Arcane Avenger, Arcane Fury...), their weapon lines only count on the weapon type they name
    ...(buffs.warframe?.arcanes ?? []).flatMap(({ arcaneId, rank, conditionalStacks }) => {
      const frameArcane = arcanesById.get(arcaneId)
      return frameArcane ? [{ name: frameArcane.name, levelStats: frameArcane.levelStats, rank, conditionalStacks, isFrameArcane: true }] : []
    }),
  ]
  // everything the build's numbers assume is happening in the fight (shown in red under the results)
  const requirements: string[] = []
  // gauge-gated alt-fire: DPS numbers assume you can hold it down, which you can't
  if (attack.stanceNote) requirements.push(attack.stanceNote)
  if (attack.altGate) requirements.push(\`\${attack.name}: a full gauge every shot (wiki: "\${attack.altGate.text}"). Treat it as one volley, the DPS figures assume you could fire it nonstop\`)
  const statusTriggers: CalcResult['statusTriggers'] = []
  let frameArcaneFlatCrit = 0 // Arcane Avenger: "adds 45 percentage points to a weapon's critical chance after other bonuses"
  for (const upgrade of upgrades) {
    const parsed = parseUpgrade(upgrade.levelStats, upgrade.rank)
    // arcane elements (Melee Exposure) are separate elements, see separateElements
    const enhance = 'enhance' in upgrade ? upgrade.enhance : 1
    const apply = (effect: ModEffect, rawTimes: number) => {
      const times = rawTimes * enhance
      if ('isFrameArcane' in upgrade && effect.kind === 'stat' && effect.stat === 'critChance') frameArcaneFlatCrit += effect.value * times
      else if ('isArcane' in upgrade && effect.kind === 'damageType' && !PHYSICAL_TYPES.includes(effect.damageType)) {
        separateElements[effect.damageType] = (separateElements[effect.damageType] ?? 0) + effect.value * times
      } else applyEffect(effect, times)
    }
    parsed.effects.forEach((effect) => apply(effect, 1))
    for (const conditional of parsed.conditionals) {
      if (!scopeApplies(conditional.scope, weapon)) continue
      // Double Tap on the Latron Incarnon: "Only the AoE benefits, not the direct damage" (wiki Bugs)
      if (upgrade.name === 'Double Tap' && attack.name === 'Incarnon Form') continue
      const triggerType = statusTrigger(conditional.trigger)
      const triggerKey = \`\${upgrade.name}|\${conditional.trigger}\`
      if (triggerType && offTriggers.includes(triggerKey)) {
        const line = \`\${upgrade.name}: off, this build never applies \${triggerType === 'any' ? 'a status effect' : \`\${triggerType[0].toUpperCase()}\${triggerType.slice(1)} procs\`} (its trigger)\`
        if (!requirements.includes(line)) requirements.push(line)
        continue
      }
      let activeStacks = Math.min(upgrade.conditionalStacks, conditional.maxStacks)
      // Primary Bulwark: with a Warframe armor set in the Warframe panel, its stacks come from that (1 stack = 1 armor past 1,000)
      const armorThreshold = conditional.trigger.match(/^Warframe armor past ([\\d,]+)/)
      const warframeArmor = buffs.warframe?.armor ?? 0
      if (armorThreshold && warframeArmor > 0) {
        activeStacks = Math.min(conditional.maxStacks, Math.max(0, warframeArmor - Number(armorThreshold[1].replace(/,/g, ''))))
      }
      // Dreadful Killshot: "for every 75 Warframe Health", from the Warframe panel when there is one
      const healthStep = conditional.trigger.match(/^Warframe health per ([\\d,]+)/)
      if (healthStep && (buffs.warframe?.health ?? 0) > 0) {
        activeStacks = Math.min(conditional.maxStacks, Math.floor(buffs.warframe!.health! / Number(healthStep[1].replace(/,/g, ''))))
      }
      if (activeStacks > 0) {
        if (triggerType) statusTriggers.push({ key: triggerKey, type: triggerType })
        apply(conditional.effect, activeStacks)
        const label = \`\${upgrade.name}: \${conditional.trigger.replace(/:$/, '').replace(/^On /, 'on ').replace(/^When /, 'when ').replace(/^While /, 'while ')}\` +
          (conditional.maxStacks > 1 ? \` (\${activeStacks}/\${conditional.maxStacks} stacks)\` : '')
        if (!requirements.includes(label)) requirements.push(label)
      }
    }
    // Primary Compression is handled below from the wiki table, its text doesn't parse
    if (!('isFrameArcane' in upgrade) && upgrade.name !== 'Primary Compression') unparsed.push(...parsed.unparsed.map((line) => \`\${upgrade.name}: \${line}\`))
  }

  // ---- Primary Compression: "+X% damage for every 1m radius lost" while aiming, from src/data/compression.ts ----
  // the table is rank 5 (+100% per meter), lower ranks are 50% + 10% per rank. Firestorm-style "Blast Range" mods make
  // the radius bigger, so more is lost and the bonus grows with them
  if (arcane?.arcane.name === 'Primary Compression' && weapon.type !== 'Shotgun') {
    const mode = compressionFor(weapon.name, attack.name)
    if (mode) {
      const perMeter = 0.5 + 0.1 * arcane.rank
      const blastRange = mode.noFirestorm ? 0 : mods.reduce((total, { mod, rank }) => {
        const line = (mod.levelStats?.[Math.min(rank, mod.levelStats.length - 1)] ?? []).join(' ')
        const match = line.match(/([+-][\\d.]+)% Blast Range/)
        return total + (match ? Number(match[1]) / 100 : 0)
      }, 0)
      const scale = perMeter * (1 + blastRange)
      if (mode.add) bonus.damage += mode.add * scale
      if (mode.multiply) separateDamageMultiplier *= 1 + mode.multiply * scale
      const total = [mode.add ? \`+\${Math.round(mode.add * scale * 100)}% added to damage mods\` : '', mode.multiply ? \`x\${(1 + mode.multiply * scale).toFixed(2)} on its own\` : ''].filter(Boolean).join(', ')
      requirements.push(\`Primary Compression: aiming (explosion radius x0.2, \${total}\${mode.note ? \`; \${mode.note}\` : ''})\`)
    } else {
      requirements.push('Primary Compression: no bonus on this attack (no explosion it can shrink, per the wiki table)')
    }
  }

  // ---- weapon passives (hand-kept table, see src/data/passives.ts) ----
  // mod-like parts go through applyEffect, the rest gets collected here and used further down
  const passiveFlat = { critChance: 0, statusChance: 0 }
  let critPerStatusType = 0 // Galariak Prime, flat after mods
  let damagePerStatusTypePassive = 0 // Cedo, additive with damage mods
  let finalCritMultiplierBonus = 0 // Knell
  const statusDurationByType: Record<string, number> = {} // '*' = every DoT
  const statusDamageByType: Record<string, number> = {} // Ash's passive: Slash procs deal 25% more
  let critOverride: { chance: number; critChance: number } | null = null // Gotva Prime
  let statusOverride: { chance: number; statusChance: number } | null = null // Sagek Prime
  let fireRateMultiplier = 1 // Lesion, multiplies with attack speed mods
  let reloadOverride: number | null = null // Reconifex perfect reload
  let detonatesDots = false // Harmony
  const passiveBase = { critChance: 0, statusChance: 0 } // Tekko with Atlas
  let magazineMultiplier = 1 // Pyrana Prime
  const activePassives: string[] = []
  for (const { passive, stacks: chosenStacks } of passives) {
    if (passive.attacks && !passive.attacks.test(attack.name)) continue
    const times = passive.condition ? Math.min(chosenStacks, passive.maxStacks ?? 1) : 1
    if (times <= 0) continue
    activePassives.push(passive.name)
    if (passive.condition) requirements.push(\`\${passive.name} (weapon passive): \${passive.condition}\${(passive.maxStacks ?? 1) > 1 ? \` (\${times}/\${passive.maxStacks} stacks)\` : ''}\`)
    for (const effect of passive.effects) {
      switch (effect.kind) {
        case 'mod':
          applyEffect(effect.effect, times)
          break
        case 'flat':
          passiveFlat[effect.stat] += effect.value * times
          break
        case 'flatPerStatusType':
          critPerStatusType += effect.value * times
          break
        case 'damagePerStatusType':
          damagePerStatusTypePassive += effect.value * times
          break
        case 'finalCritMultiplier':
          finalCritMultiplierBonus += effect.value * times
          break
        case 'statusDuration':
          for (const damageType of effect.types ?? ['*']) {
            statusDurationByType[damageType] = (statusDurationByType[damageType] ?? 0) + effect.value * times
          }
          break
        case 'nextHitCritOverride':
          critOverride = effect
          break
        case 'nextHitStatusOverride':
          statusOverride = effect
          break
        case 'fireRateMultiplier':
          fireRateMultiplier *= (1 + effect.value) ** times
          break
        case 'reloadTime':
          reloadOverride = effect.seconds
          break
        case 'heavyDetonatesDots':
          detonatesDots = true
          break
        case 'base':
          passiveBase[effect.stat] += effect.value * times
          break
        case 'separateElement':
          separateElements[effect.damageType] = (separateElements[effect.damageType] ?? 0) + effect.value * times
          break
        case 'magazineMultiplier':
          magazineMultiplier *= effect.value
          break
        case 'forcedProc':
          forcedProcsPerPellet[effect.damageType] = (forcedProcsPerPellet[effect.damageType] ?? 0) + effect.procsPerHit * times
      }
    }
  }

  // ---- Warframe abilities (src/data/warframeAbilities.ts), scaled by Ability Strength ----
  let abilityFlatCritChance = 0 // Wrathful Advance, after mods
  let abilityCritDamageScale = 1 // Electric Shield, multiplies every other crit damage source
  const extraHits: Record<string, number> = {} // separate hits worth this share of the weapon's damage (Xata's Whisper Void, Resupply...)
  let xataShare = 0 // the Xata's Whisper part of that: headshot counts twice on it, and it also goes off on Blast detonations
  let abilityVulnerability = 0 // Petrify: the target takes more from everything
  let finisherVulnerability = 0 // Savage Silence / Radiant Finish, only on finisher attacks
  let oneShotFlat = 0 // Ballistic Battery: flat base damage on one shot, only for the biggest-hit numbers
  const uncombinedElements: Record<string, number> = {} // Freeze Force / Electric Shield: don't combine, do proc
  const statusElementBonus: Record<string, number> = {} // uncombined ability elements that still count for their DoT
  const activeAbilities: string[] = []
  const warframe = buffs.warframe
  if (warframe) {
    // squad auras that buff weapons (Steel Charge, Rifle Amp...), added in with the damage mods
    const aura = warframe.auraDamage
    if (aura) {
      bonus.damage +=
        weapon.category === 'Melee' ? aura.melee
          : weapon.category === 'Secondary' ? aura.pistol
            : weapon.type === 'Shotgun' ? aura.shotgun
              : aura.rifle + (weapon.type === 'Sniper' ? aura.sniper : 0)
    }
    bonus.weakpointCritChance += warframe.weakpointCritChance ?? 0
    // Archon Shards: additive with the matching mods ("Melee Critical Damage is additive with Organ Shatter"), and they
    // work on exalted weapons of the same class. the Violet electricity goes in after the mods in the combine order
    const shards = warframe.shards
    if (shards) {
      if (weapon.category === 'Melee') bonus.critDamage += shards.meleeCritDamage
      if (weapon.category === 'Primary') {
        bonus.statusChance += shards.primaryStatusChance
        if (shards.primaryElectricity > 0) {
          if (!('electricity' in elementBonus)) elementOrder.push('electricity')
          elementBonus.electricity = (elementBonus.electricity ?? 0) + shards.primaryElectricity
        }
      }
      if (weapon.category === 'Secondary') bonus.critChance += shards.secondaryCritChance
      if (shards.toxinStatusDamage) statusDamageByType.toxin = (statusDamageByType.toxin ?? 0) + shards.toxinStatusDamage
    }
    // the same buff twice doesn't stack, the strongest one applies (Shock Trooper wiki: "Multiple Shock Troopers don't stack.
    // The one with the highest Ability Strength applies")
    const strongest = new Map<string, AbilityCast>()
    for (const cast of warframe.casts) {
      const current = strongest.get(cast.id)
      if (!current || strengthFor(cast, warframe) > strengthFor(current, warframe)) strongest.set(cast.id, cast)
    }
    for (const cast of strongest.values()) {
      const ability = abilitiesById.get(cast.id)
      if (!ability || !abilityApplies(ability, weapon)) continue
      // passives only work on that frame, cast by you
      if (ability.selfOnly && (cast.by !== 'self' || ability.warframe !== warframe.frameName)) continue
      // caster-only buffs (Eclipse, Xata's Whisper) do nothing when a teammate casts them
      if (ability.casterOnly && cast.by === 'ally') continue
      const times = castStacks(ability, cast)
      const effects = effectsFor(ability, cast.by)
      if (effects.length === 0 || effects.every((effect) => effect.perStack && times <= 0)) continue
      const caster = cast.by === 'helminth' ? 'your subsumed' : cast.by === 'ally' ? 'an ally\\'s' : 'your'
      activeAbilities.push(\`\${ability.name}\${cast.by === 'helminth' ? ' (subsumed)' : cast.by === 'ally' ? ' (ally)' : ''}\`)
      // passives (no ability to cast) just need their condition
      const needs = ability.ability ? \`\${caster} \${ability.ability} up\${ability.condition ? \`, \${ability.condition}\` : ''}\` : ability.condition ?? \`playing \${ability.warframe}\`
      requirements.push(\`\${ability.name}: \${needs}\${ability.stacks ? \` (\${times} \${ability.stacks.label})\` : ''}\`)
      for (const effect of effects) {
        const value = scaledValue(ability, effect.value, strengthFor(cast, warframe)) * (effect.perStack ? times : 1)
        switch (effect.kind) {
          case 'factionDamage':
            factionBonus += value
            break
          case 'damageMultiplier':
            separateDamageMultiplier *= 1 + value
            break
          case 'baseDamage':
            bonus.damage += value
            break
          case 'element':
            // Shock Trooper: extra Electricity that doesn't dilute your procs, plus a guaranteed Electricity proc per hit
            if (effect.forcedProc) {
              separateElements[effect.damageType] = (separateElements[effect.damageType] ?? 0) + value
              forcedProcsPerPellet[effect.damageType] = (forcedProcsPerPellet[effect.damageType] ?? 0) + 1
              if (effect.boostsStatus) statusElementBonus[effect.damageType] = (statusElementBonus[effect.damageType] ?? 0) + value
              break
            }
            if (effect.combines) applyEffect({ kind: 'damageType', damageType: effect.damageType, value }, 1)
            else uncombinedElements[effect.damageType] = (uncombinedElements[effect.damageType] ?? 0) + value
            // Thermal Transfer: "the Heat bonus is additive with other Heat bonuses for status"
            if (!effect.combines && effect.boostsStatus) statusElementBonus[effect.damageType] = (statusElementBonus[effect.damageType] ?? 0) + value
            break
          case 'extraHit': {
            // Resupply's sniper bonus is doubled (Neutralizer gets it too, it's a sniper)
            const amount = weapon.type === 'Sniper' && effect.sniperValue ? value * (effect.sniperValue / effect.value) : value
            extraHits[effect.damageType] = (extraHits[effect.damageType] ?? 0) + amount
            if (effect.xata) xataShare += amount
            if (effect.forcedProc) forcedProcsPerPellet[effect.damageType] = (forcedProcsPerPellet[effect.damageType] ?? 0) + 1
            break
          }
          case 'attackSpeed':
            bonus.fireRate += value
            break
          case 'flatCritChance':
            abilityFlatCritChance += value
            break
          case 'critDamageMultiplier':
            abilityCritDamageScale *= 1 + value
            break
          case 'critChanceMod':
            bonus.critChance += value
            break
          case 'critDamageMod':
            bonus.critDamage += value
            break
          case 'finisherVulnerability':
            finisherVulnerability += value
            break
          case 'statusTypeDamage':
            statusDamageByType[effect.damageType] = (statusDamageByType[effect.damageType] ?? 0) + value
            break
          case 'statusTypeDuration':
            statusDurationByType[effect.damageType] = (statusDurationByType[effect.damageType] ?? 0) + value
            break
          case 'statusChanceMod':
            bonus.statusChance += value
            break
          case 'statusDurationMod':
            bonus.statusDuration += value
            break
          case 'weakpointDamage':
            bonus.weakpointDamage += value
            break
          case 'targetVulnerability':
            abilityVulnerability += value
            break
          case 'oneShotFlat':
            oneShotFlat += value
        }
      }
    }
  }

  // ---- melee combo (wiki Melee_Combo / Heavy_Attack) ----
  // the multiplier only changes damage on heavy attacks/heavy slams. Blood Rush, Weeping Wounds and the Gladiator
  // set read it on every melee attack: bonus x (multiplier - 1), added in with the other crit/status mods.
  // heavies read the combo before they spend it, so a 12x heavy gets the 12x Blood Rush bonus
  const isMelee = weapon.category === 'Melee'
  const isHeavy = isMelee && Boolean(attack.heavy)
  const combo = isMelee ? Math.min(maxComboFor(weapon.name), Math.max(1, buffs.combo ?? 1)) : 1
  const comboSteps = combo - 1
  // the combo only matters if something reads it
  if (isMelee && combo > 1 && (Boolean(attack.heavy) || Boolean(exalted?.abilityCombo) || bonus.critChancePerCombo > 0 || bonus.statusChancePerCombo > 0 || mods.some(({ mod }) => mod.name.startsWith('Gladiator ')))) {
    requirements.push(\`Melee combo at \${combo}x\${attack.heavy ? ' (spent by the heavy)' : ''}\`)
  }
  const gladiatorPieces = Math.min(
    GLADIATOR_MAX_PIECES,
    (setPieces.Gladiator ?? 0) + (buffs.gladiatorWarframePieces ?? 0),
  )
  const critFromCombo = isMelee ? (bonus.critChancePerCombo + GLADIATOR_CRIT_PER_PIECE * gladiatorPieces) * comboSteps : 0
  const statusFromCombo = isMelee ? bonus.statusChancePerCombo * comboSteps : 0
  // Killing Blow style "Melee Damage on Heavy Attack" just adds to the damage mods
  if (isHeavy) bonus.damage += bonus.heavyDamage
  // Seismic Wave / Power Throw are their own multipliers (wiki: multiplicative with Pressure Point), only on those attacks.
  // Power Throw counts on the throw itself, the wiki doesn't say it reaches the explosion so I leave that out
  // Nira's set: +150% slam damage per piece, "additive to" Seismic Wave
  if (isMelee && /slam/i.test(attack.name)) separateDamageMultiplier *= 1 + bonus.slamDamage + NIRA_SLAM_PER_PIECE * Math.min(3, setPieces.Nira ?? 0)
  if (isMelee && /throw$/i.test(attack.name)) separateDamageMultiplier *= 1 + bonus.throwDamage
  // finisher attacks (Blade Storm): Finisher Damage bonuses add together (Obex page: Armored Finisher "is additive to other
  // sources of Finisher Damage such as Finishing Touch"), and Savage Silence / Radiant Finish multiply on top ("Multiplicative
  // to Finishing Touch")
  if (attack.finisher) separateDamageMultiplier *= (1 + bonus.finisherDamage) * (1 + finisherVulnerability)
  // pseudo-exalted (Landslide, Shattered Lash, Whipclaw, Blade Storm): "1x additional damage per combo multiplier" on every hit
  // Exalted Blade's heavy waves: "Energy wave's damage does not scale off combo counter"
  const heavyComboFactor = (isHeavy && !attack.noCombo) || (isMelee && exalted?.abilityCombo) ? combo : 1
  if (exalted && exalted.strength !== 'none') {
    requirements.push(\`\${exalted.ability} active (\${exalted.strength === 'base' ? 'base damage' : \`+\${Math.round((exalted.strengthBonus ?? 0) * 100)}% damage\`} x \${Math.round(exaltedStrength * 100)}% Ability Strength)\`)
  }
  // Regulators' innate +150% / Neutralizer's x1.25: Ability Strength damage bonuses added in with Hornet Strike / Serration
  if (exalted?.strength === 'bonus') bonus.damage += (exalted.strengthBonus ?? 0) * exaltedStrength
  // Peacemaker's ramp-up multiplies final damage
  if (exalted?.finalMultiplier) {
    separateDamageMultiplier *= exalted.finalMultiplier.value
    requirements.push(exalted.finalMultiplier.requirement)
  }

  // Javlok's thrown spear: +20% per round in the magazine it dumps, so magazine mods raise it
  if (attack.damagePerMagazineRound && weapon.magazineSize) {
    const rounds = Math.max(1, Math.round(weapon.magazineSize * (1 + bonus.magazineCapacity) * magazineMultiplier))
    separateDamageMultiplier *= 1 + attack.damagePerMagazineRound * rounds
    requirements.push(\`\${attack.name}: +\${Math.round(attack.damagePerMagazineRound * 100)}% per round in a full \${rounds}-round magazine (x\${(1 + attack.damagePerMagazineRound * rounds).toFixed(1)})\`)
  }

  // Primary Plated Round (wiki): "Max Damage Bonus = 15 x sqrt(5 x Magazine Size)" in %, "additive to base damage sources
  // such as Serration", off the modded magazine (a 25-round magazine = +167.71%, "Matches ... Serration"). primaries only,
  // not battery magazines (no flag for those in the data) or Incarnon charges. it lasts 10 s, so it covers a whole magazine
  // only if you empty it in 10 s: the wiki's "Ideal Fire Rate" = magazine / 10
  if (platedRound > 0 && weapon.category === 'Primary' && weapon.magazineSize && !/incarnon/i.test(attack.name)) {
    const rounds = Math.max(1, Math.round(weapon.magazineSize * (1 + bonus.magazineCapacity) * magazineMultiplier))
    const plated = platedRound * Math.sqrt(5 * rounds)
    bonus.damage += plated
    requirements.push(\`Primary Plated Round: +\${(plated * 100).toFixed(1)}% damage from a \${rounds}-round magazine, needs \${(rounds / 10).toFixed(1)}+ shots/s to last the whole magazine\`)
  }

  // ---- Kuva / Tenet / Coda bonus element: an innate element worth X% of base damage ----
  if (bonusElement && bonusElement.value > 0 && hasBonusElement(weapon.name)) {
    const extra = sum(Object.values(attack.damage)) * bonusElement.value
    attack = { ...attack, damage: { ...attack.damage, [bonusElement.damageType]: (attack.damage[bonusElement.damageType] ?? 0) + extra } }
  }

  // ---- Incarnon evolution perks ----
  // base stats go onto the weapon before mods, mod-like lines go through applyEffect like any mod
  const isIncarnonAttack = /incarnon/i.test(attack.name)
  const perkBase = { damage: 0, critChance: 0, critMultiplier: 0, statusChance: 0, multishot: 0 }
  const perkFlat = { critChance: 0, statusChance: 0 }
  let nonCritChanceBonus = 0 // expected extra damage on non-crits (chance x bonus)
  let nonCritPeakBonus = 0 // the bonus itself, for the biggest possible hit
  let armorStripPerPuncture = 0
  const conversions: Extract<PerkEffect, { kind: 'convert' }>[] = []
  const perkBaseSet: Partial<Record<'critChance' | 'statusChance' | 'critMultiplier', number>> = {}
  const critGatedMultiplier: { below: number; value: number; perk: string }[] = []
  const lastShotBonuses: { value: number; burst: boolean; perk: string }[] = []
  let multishotCostsAmmo: { damage: number; perk: string } | null = null
  let incarnonChargeBonus = 0 // Incarnon Efficiency
  for (const { perk, stacks: perkStacks } of incarnonPerks) {
    for (const statement of perk.statements) {
      if (!statement.effect || !perkAppliesTo(statement.mode, isIncarnonAttack, weapon.category === 'Melee')) continue
      // Felarx's Mounting Momentum: "On Shell Reload: +10% Fire Rate; Stacks up to 99x". one stack per shell loaded, so a reload
      // gives at most the base form's (modded) magazine of stacks, not 99: a 6-shell Felarx gets +60%. the Incarnon form has
      // no shells of its own, its stacks come from the base form's reloads too
      const shellCap = statement.condition && /shell reload/i.test(statement.condition) && weapon.magazineSize
        ? Math.max(1, Math.round(weapon.magazineSize * (1 + bonus.magazineCapacity) * magazineMultiplier)) : Infinity
      const times = statement.condition ? Math.min(perkStacks, statement.maxStacks, shellCap) : 1
      if (Number.isFinite(shellCap) && times > 0) requirements.push(\`\${perk.name} (Incarnon): \${times} stacks, one per shell of the base form's \${shellCap}-round magazine\`)
      if (times <= 0) continue
      // status-triggered perks get the same check as mods (Latron's Riddled Target needs Puncture procs: a -100% Puncture
      // riven used to keep its +100% multishot)
      const perkTrigger = statement.condition ? statusTrigger(statement.condition) : null
      if (perkTrigger) {
        const triggerKey = \`\${perk.name}|\${statement.condition}\`
        if (offTriggers.includes(triggerKey)) {
          const line = \`\${perk.name} (Incarnon): off, this build never applies \${perkTrigger === 'any' ? 'a status effect' : \`\${perkTrigger[0].toUpperCase()}\${perkTrigger.slice(1)} procs\`} (its trigger)\`
          if (!requirements.includes(line)) requirements.push(line)
          continue
        }
        statusTriggers.push({ key: triggerKey, type: perkTrigger })
      }
      if (statement.condition) {
        const label = \`\${perk.name} (Incarnon): \${statement.condition.replace(/:$/, '')}\${statement.maxStacks > 1 ? \` (\${times}/\${statement.maxStacks} stacks)\` : ''}\`
        if (!requirements.includes(label)) requirements.push(label)
      }
      const effect = statement.effect
      // Prelude of Might (Furis): "When Critical Chance below 40%: +3 Base Critical Multiplier", checked against the build's
      // final crit chance once that's known (below)
      const critGate = statement.condition?.match(/Critical Chance below ([\\d.]+)%/i)
      if (critGate && effect.kind === 'base' && effect.stat === 'critMultiplier') {
        critGatedMultiplier.push({ below: Number(critGate[1]) / 100, value: effect.value * times, perk: perk.name })
        continue
      }
      if (effect.kind === 'base') perkBase[effect.stat] += effect.value * times
      else if (effect.kind === 'flat') perkFlat[effect.stat] += effect.value * times
      else if (effect.kind === 'mod') applyEffect(effect.effect, times)
      else if (effect.kind === 'mods') for (const part of effect.effects) applyEffect(part, times)
      else if (effect.kind === 'baseSet') perkBaseSet[effect.stat] = effect.value
      else if (effect.kind === 'lastShot') lastShotBonuses.push({ value: effect.value * times, burst: effect.burst, perk: perk.name })
      else if (effect.kind === 'chargeGain') incarnonChargeBonus += effect.value
      else if (effect.kind === 'multishotCostsAmmo') multishotCostsAmmo = { damage: effect.damage, perk: perk.name }
      else if (effect.kind === 'nonCritBonus') {
        nonCritChanceBonus += effect.chance * effect.value
        nonCritPeakBonus += effect.value
      }
      else if (effect.kind === 'convert') conversions.push(effect)
      else armorStripPerPuncture += effect.value
    }
    for (const statement of perk.statements) {
      if (!statement.effect && /Damage|Critical|Status|Multishot|Fire Rate|Attack Speed/.test(statement.text)) {
        unparsed.push(\`\${perk.name}: \${statement.text}\`)
      }
    }
  }
  // "+N Base Damage" grows every damage type by the same proportion, and every part of a multi-part shot together
  const unmoddedBase = attack.baseDamagePool ?? sum(Object.values(attack.damage))
  const baseDamageScale = unmoddedBase > 0 ? (unmoddedBase + perkBase.damage) / unmoddedBase : 1
  attack = {
    ...attack,
    damage: Object.fromEntries(Object.entries(attack.damage).map(([damageType, amount]) => [damageType, amount * baseDamageScale])),
    critChance: perkBaseSet.critChance ?? attack.critChance + perkBase.critChance + passiveBase.critChance,
    critMultiplier: perkBaseSet.critMultiplier ?? attack.critMultiplier + perkBase.critMultiplier,
    statusChance: perkBaseSet.statusChance ?? attack.statusChance + perkBase.statusChance + passiveBase.statusChance,
  }
  // magazine-based perks need the magazine: the Incarnon form's charges, or the modded magazine over each shot's ammo cost
  const charges = attack.incarnonCharges ?? null
  const magazineRounds = weapon.category === 'Melee' ? null
    : charges ?? (weapon.magazineSize ? Math.max(1, Math.round(weapon.magazineSize * (1 + bonus.magazineCapacity) * magazineMultiplier)) : null)
  // Final Fusillade: "+3 Multishot on last shot in magazine", Forceful Finality: "+5 Base Multishot" on the final burst. one shot
  // (or one burst of burstCount rounds) out of the magazine gets it, so the average shot gets value x shots-with-it / shots.
  // Plentiful Mayhem makes each shot cost its projectiles, so fewer shots per magazine and the last one is a bigger share
  let lastShotBase = 0
  for (const bonusLine of lastShotBonuses) {
    if (!magazineRounds) continue
    const shotsWithIt = bonusLine.burst ? Math.max(1, attack.burstCount ?? 1) : 1
    const shots = Math.max(shotsWithIt, magazineRounds / (attack.ammoCost ?? 1) / (multishotCostsAmmo ? Math.max(1, (attack.multishot ?? weapon.multishot) + perkBase.multishot) : 1))
    const average = bonusLine.value * shotsWithIt / shots
    lastShotBase += average
    requirements.push(\`\${bonusLine.perk} (Incarnon): +\${bonusLine.value} multishot on the last \${shotsWithIt > 1 ? \`\${shotsWithIt}-round burst\` : 'shot'} of \${Math.round(shots)} per magazine = +\${average.toFixed(2)} on average\`)
  }
  weapon = { ...weapon, multishot: (attack.multishot ?? weapon.multishot) + perkBase.multishot + lastShotBase }
  // Plentiful Mayhem (wiki Torid Incarnon Genesis): "Multishot consumes ammo directly from Capacity and increases Damage by +60%",
  // "multiplicative to base damage bonuses like Serration", "on applies to projectiles generated by multishot", and "In the
  // Incarnon Form, instead of increasing the damage of additional projectiles ... all multishot bonuses are increased by 60%".
  // the extra projectiles are (multishot - 1) of every multishot, so the average projectile gets 1 + 60% x (M - 1) / M
  const mayhem = multishotCostsAmmo as { damage: number; perk: string } | null // set in the perk loop, TS can't see it
  if (mayhem && mayhem.damage > 0 && weapon.category !== 'Melee') {
    if (isIncarnonAttack) bonus.multishot *= 1 + mayhem.damage
    else {
      const projectiles = weapon.multishot * (multishotLocked || attack.noMultishotMods ? 1 : 1 + bonus.multishot)
      if (projectiles > 1) separateDamageMultiplier *= 1 + mayhem.damage * (projectiles - 1) / projectiles
    }
  }

  // ---- 2. damage type proportions + quantization ----
  const baseDamage = sum(Object.values(attack.damage))
  const proportions: Record<string, number> = {}
  const typeParts: Record<string, TypePart[]> = {}
  const addProportion = (damageType: string, amount: number, ...parts: TypePart[]) => {
    proportions[damageType] = (proportions[damageType] ?? 0) + amount
    typeParts[damageType] = [...(typeParts[damageType] ?? []), ...parts]
  }

  for (const damageType of PHYSICAL_TYPES) {
    const base = attack.damage[damageType] ?? 0
    const mod = physicalBonus[damageType] ?? 0
    if (base > 0) addProportion(damageType, (base / baseDamage) * (1 + mod), { kind: 'physical', base: base / baseDamage, mod })
  }

  // element mods are a % of the full base damage. innate primary elements go to the
  // end of the combine queue, innate combined elements just pass through.
  const elementAmounts: Record<string, number> = {}
  const combineQueue = [...elementOrder]
  for (const damageType of elementOrder) elementAmounts[damageType] = elementBonus[damageType]
  for (const [damageType, base] of Object.entries(attack.damage)) {
    if (PHYSICAL_TYPES.includes(damageType)) continue
    if (!(damageType in elementAmounts)) combineQueue.push(damageType)
    elementAmounts[damageType] = (elementAmounts[damageType] ?? 0) + base / baseDamage
  }
  const primaryQueue = combineQueue.filter((damageType) => PRIMARY_ELEMENTS.includes(damageType))
  const elementPart = (element: string): TypePart => {
    const innate = (attack.damage[element] ?? 0) / baseDamage
    return { kind: 'element', element, mod: elementAmounts[element] - innate, innate }
  }
  for (const damageType of combineQueue) {
    if (!PRIMARY_ELEMENTS.includes(damageType)) addProportion(damageType, elementAmounts[damageType], elementPart(damageType))
  }
  for (let i = 0; i < primaryQueue.length; i += 2) {
    const first = primaryQueue[i]
    const second = primaryQueue[i + 1]
    if (!second) addProportion(first, elementAmounts[first], elementPart(first))
    else addProportion(COMBINED_ELEMENTS[[first, second].sort().join('+')], elementAmounts[first] + elementAmounts[second], elementPart(first), elementPart(second))
  }
  // passive elements that skip combining (Tonkkatt's heat stays heat)
  for (const [damageType, amount] of Object.entries(separateElements)) addProportion(damageType, amount, { kind: 'separate', source: 'passive', value: amount })
  // ability elements (Freeze Force, Electric Shield) also skip combining, but they do take their share of procs
  for (const [damageType, amount] of Object.entries(uncombinedElements)) addProportion(damageType, amount, { kind: 'separate', source: 'ability', value: amount })

  // which status types the target has, for CO / Galvanized. by default it's the build's own damage types
  // (base physical + modded elements), so a gun can't count statuses it never applies
  // the build's own status types, plus (in a whole shot) the ones the other parts put on the same enemy
  const ownStatusTypes = attack.statusChance > 0
    ? Object.entries(proportions).filter(([damageType, proportion]) => damageType !== 'true' && quantize(proportion) > 0 && !target.statusImmune?.includes(damageType)).map(([damageType]) => damageType)
    : []
  const buildStatusTypes = statusMode === 'immune' ? 0 : new Set([...ownStatusTypes, ...otherPartStatusTypes]).size
  const activeStatusTypes =
    (debuffs.statusTypeSource === 'debuffs' ? debuffStatusTypes : buildStatusTypes) + (debuffs.liftedOrKnockedDown ? 1 : 0)
  // Cedo: +60% per status type, in with the damage mods (not CO-style)
  bonus.damage += damagePerStatusTypePassive * activeStatusTypes

  // Condition Overload style bonuses (CO, Galvanized per-status, Secondary Shiver per Cold stack).
  // additive weapons: base x [(1 + mods) x other multipliers + CO]
  // multiplicative weapons: base x (1 + mods) x (1 + CO) x other multipliers
  const co = coBehavior ?? resolveCoBehavior(weapon, attack)
  // the adding kind ignores "Evolution base damage increases on Incarnon" (wiki CO page), so its share is worked out
  // on the base before the evolution's +N. the multiplying kind (Kunai Incarnon) does get it
  const coBaseShare = co.mode === 'add' ? 1 / baseDamageScale : 1
  const coBonus =
    co.mode === 'none'
      ? 0
      : (bonus.damagePerStatusType * activeStatusTypes + bonus.damagePerColdStack * Math.min(stacks('cold'), 10)) * co.scale * coBaseShare
  if (coBonus > 0 || (damagePerStatusTypePassive > 0 && activeStatusTypes > 0) || (critPerStatusType > 0 && activeStatusTypes > 0)) {
    requirements.push(\`Target already has \${activeStatusTypes} status type\${activeStatusTypes === 1 ? '' : 's'} on it (Condition Overload style bonuses)\`)
  }
  const damageScale =
    co.mode === 'multiply'
      ? (1 + bonus.damage) * (1 + coBonus) * separateDamageMultiplier
      : (1 + bonus.damage) * separateDamageMultiplier + coBonus

  // heavy: [base x (1 + damage mods) x elements] x heavy multiplier x combo. the heavy multiplier is already in the
  // Heavy Attack's base damage (build-data), the combo multiplies everything, CO included
  const moddedBaseDamage = baseDamage * damageScale * heavyComboFactor

  // each final type (sums included) is quantized on its own, then scaled by modded base damage
  const moddedByType: Record<string, number> = {}
  for (const [damageType, proportion] of Object.entries(proportions)) {
    const quantized = quantize(proportion) * moddedBaseDamage
    if (quantized > 0) moddedByType[damageType] = quantized
  }

  // ---- 3. crit, faction, multishot, fire rate ----
  // Puncture and Cold add flat after mods, and don't apply to AoE
  // AoE can't headshot. weak point crit chance (Primary Acuity, Cascadia Accuracy) only counts on headshots
  const isHeadshot = target.headshot && !attack.isAoE
  if (isHeadshot) requirements.push('Headshots on every hit')
  // null/undefined = follow the faction, so stale or missing settings can't silently turn headcrits off
  const headMultiplier = target.headshotMultiplier ?? headMultiplierFor(target.faction)
  const headcrit = target.headcrit ?? hasHeadcrits(target.faction)
  // area parts take a 1x headshot multiplier and can't trigger headshot conditions, but when the projectile lands on the
  // head they still get its weak point crit chance (Acuity: "+350% Weak Point Critical Chance")
  const weakpointCritBonus = target.headshot ? bonus.weakpointCritChance : 0
  // status chance after mods, as a function of base status (Wiseman's Regard changes the base after crit is known)
  const moddedStatus = (baseStatus: number) =>
    baseStatus * (1 + bonus.statusChance + statusFromCombo) + perkFlat.statusChance + passiveFlat.statusChance + modFlat.statusChance +
    tauStatusChanceBonus(stacks('tau'))
  // Decisive Stature: +25% of current status chance as base crit chance, capped
  for (const conversion of conversions.filter((candidate) => candidate.stat === 'critChance')) {
    attack = { ...attack, critChance: attack.critChance + Math.min(conversion.max, conversion.ratio * moddedStatus(attack.statusChance)) }
  }
  const critBeforeEnervate =
    attack.critChance * (1 + bonus.critChance + weakpointCritBonus + critFromCombo + (isHeavy || (isMelee && attack.heavyCrit) ? bonus.heavyCritChance : 0)) +
    perkFlat.critChance + passiveFlat.critChance + modFlat.critChance + frameArcaneFlatCrit + critPerStatusType * activeStatusTypes + abilityFlatCritChance +
    (attack.isAoE ? 0 : punctureCritChanceBonus(stacks('puncture')))
  // Enervate's stacks are flat on top of everything, taken as their average over a build-up-and-reset cycle
  const enervate = critPerHit as { value: number; resetsAfter: number } | null // set inside the effect loop, TS can't see it
  const critBeforeVigilante = enervate ? enervateAverageCrit(critBeforeEnervate, enervate.value, enervate.resetsAfter) : critBeforeEnervate
  if (enervate) requirements.push(\`Secondary Enervate: +\${Math.round(enervate.value * 100)}% crit per hit, reset after \${enervate.resetsAfter} big crits (averaged: +\${Math.round((critBeforeVigilante - critBeforeEnervate) * 100)}%)\`)
  // Vigilante set: "X% chance to enhance Critical Hits from Primary Weapons", a crit that gets enhanced goes up one tier, which
  // averages out the same as that much more crit chance on every hit that crits
  const vigilanteChance = weapon.category === 'Primary' ? VIGILANTE_ENHANCE_PER_PIECE * Math.min(6, setPieces.Vigilante ?? 0) : 0
  // King's Gambit (Sicarus Incarnon): "Bodyshots can't crit, weak point hits get +150% Critical Chance"
  const critChance = noBodyCrit && !target.headshot ? 0 : critBeforeVigilante + vigilanteChance * Math.min(1, Math.max(0, critBeforeVigilante))
  if (noBodyCrit) requirements.push(target.headshot ? "King's Gambit: weak point hits, +150% crit chance" : "King's Gambit: body shots can't crit")
  // headcrit doubles the weapon's *base* crit multiplier, so mods scale it but Cold's flat bonus doesn't
  // the wiki module's ExtraHeadshotDmg -2 (Alternox, Arca Plasmor, Nataruk's Perfect Shot): no headshot multiplier at all
  const noHeadMultiplier = attack.extraHeadshot === null
  const headcritFactor = isHeadshot && headcrit && !noHeadMultiplier ? HEADCRIT_MULTIPLIER : 1
  // Tenacious Bond (companion): "+1.2x Final Critical Damage Multiplier", a flat add the mods don't scale: 1 + tier x
  // (crit multi - 1 + final) per the wiki. the headcrit doubles it too: a Vadarya headcrit through Electric Shield only
  // matched in game (5,581,803 vs 5,589,989) with it inside the x2, and 12% off without
  const tenaciousBond = buffs.tenaciousBond ?? 0
  const gatedCritMultiplier = sum(critGatedMultiplier.map((gate) => {
    const on = critChance < gate.below
    requirements.push(\`\${gate.perk} (Incarnon): crit chance \${Math.round(critChance * 100)}% is \${on ? 'under' : 'not under'} \${Math.round(gate.below * 100)}%, so its +\${gate.value}x base crit multiplier is \${on ? 'on' : 'off'}\`)
    return on ? gate.value : 0
  }))
  const critMultiplier =
    (((attack.critMultiplier + gatedCritMultiplier) * (1 + bonus.critDamage) + tenaciousBond) * headcritFactor + finalCritMultiplierBonus) * abilityCritDamageScale +
    (attack.isAoE ? 0 : coldCritMultiplierBonus(stacks('cold')))
  // over 100% the lowest tier is the "normal" hit and the next tier up is the "crit" (Damage/Calculation 4.3)
  const normalCritMultiplier = 1 + Math.floor(critChance) * (critMultiplier - 1)
  const critHitMultiplier = 1 + Math.ceil(critChance) * (critMultiplier - 1)
  // status chance before Sagek's override, Gotva needs it here
  // Wiseman's Regard: +30% of current crit chance as base status chance, capped
  const convertedBaseStatus = conversions
    .filter((conversion) => conversion.stat === 'statusChance')
    .reduce((total, conversion) => total + Math.min(conversion.max, conversion.ratio * Math.max(0, critChance)), 0)
  const rawStatusChance = moddedStatus(attack.statusChance + convertedBaseStatus)
  // Gotva Prime: a hit after a status proc has a chance to roll at a fixed crit chance instead
  const superCritShare = critOverride ? Math.min(1, rawStatusChance) * critOverride.chance : 0
  const superCritMultiplier = critOverride ? 1 + critOverride.critChance * (critMultiplier - 1) : 1
  const averageCritMultiplier = (1 - superCritShare) * (1 + critChance * (critMultiplier - 1)) + superCritShare * superCritMultiplier
  // Devouring Attrition style: non-crit hits have a chance at a huge bonus. only matters below 100% crit
  const attritionBonus = Math.max(0, 1 - critChance) * nonCritChanceBonus

  const factionMultiplier = 1 + factionBonus
  // Acuity: multishot mods/arcanes don't apply, the weapon keeps its base (Incarnon base multishot perks still count)
  // hitscan explosions, beam blasts and speargun throws keep their innate multishot too (build-data noMultishotMods)
  const multishot = weapon.category === 'Melee' ? 1 : weapon.multishot * (multishotLocked || attack.noMultishotMods ? 1 : 1 + bonus.multishot)
  // beams (wiki Multishot): extra beams on one target "merge into a singular damage tick" with the summed damage and
  // status chance, so damaging procs come from a tick worth all the beams. "Damaging status effects (Slash, Heat,
  // Toxin, Electricity, Blast, Gas) are affected twice by multishot on all continuous weapons." forced procs land after
  // the merge, one per tick, so those don't get the second helping
  const beamMerge = attack.continuous ? Math.max(1, multishot) : 1
  // charged attacks (wiki Damage/Calculation): effective rate = 1 / (charge time + 1 / fire rate), and fire rate
  // mods also speed up the charge (modded charge time = base / (1 + speed bonuses))
  // pseudo-exalted speed comes from Casting Speed, attack speed mods do nothing
  const fireRateBonus = fireRateLocked || exalted?.noAttackSpeed ? 0 : bonus.fireRate
  const moddedFireRate = attack.fireRate * (1 + fireRateBonus) * fireRateMultiplier
  // heavy attacks: attack speed only speeds up the swing, wind-up only gets faster from Wind Up Speed mods
  // (wiki Attack_Speed). I treat one heavy as wind-up + one swing at the attack speed, an estimate since the
  // data doesn't have per-weapon swing lengths
  const windUp = isHeavy && attack.windUp ? attack.windUp / Math.max(0.01, 1 + bonus.heavyWindUpSpeed) : null
  const triggerRate = windUp !== null
    ? 1 / (windUp + 1 / moddedFireRate)
    : attack.chargeTime
      ? 1 / (attack.chargeTime / Math.max(0.01, 1 + fireRateBonus) + 1 / moddedFireRate)
      : moddedFireRate
  // burst weapons (wiki Burst Count / Burst Delay): a pull fires burstCount rounds burstDelay apart, the delay shrinks
  // with fire rate mods, and the next burst comes 1 / fire rate after the last round. so it's rounds per second from
  // here on (Vasto Incarnon: 6 rounds 0.04 s apart then 0.16 s at +150% fire rate, same timing as Underframe's log)
  const burstCount = attack.burstCount && attack.burstCount > 1 ? attack.burstCount : 1
  const fireRate = burstCount > 1
    ? burstCount / (1 / triggerRate + (burstCount - 1) * (attack.burstDelay ?? 0) / Math.max(0.01, (1 + fireRateBonus) * fireRateMultiplier))
    : triggerRate

  // ---- 4. target modifiers ----
  // Latron's Flensing Spikes: each Puncture stack strips another 20% of armor
  // Janus Captain Vor "is immune to armor reduction": Heat, Corrosive, auras and Flensing Spikes don't touch it
  const armorAfter = target.armorStripImmune ? armor : effectiveArmor(armor, debuffs) * Math.max(0, 1 - armorStripPerPuncture * Math.min(stacks('puncture'), 5))
  const armorMultiplier = armorDamageMultiplier(armorAfter)
  const factionWeakness = FACTION_DAMAGE_MODIFIERS[target.faction] ?? {}

  // per damage type multiplier vs the chosen layer. toxin skips shields and hits health.
  // slash DoT bypasses armor, true damage always does.
  // the three pieces of T: faction weakness, armor, and the Viral (health) / Magnetic (shields, overguard) debuff
  const typeFactors = (damageType: string, bypassArmor = false) => {
    const weakness = factionWeakness[damageType] ?? 1
    const layer = target.layer === 'shield' && damageType === 'toxin' ? 'health' : target.layer
    if (layer === 'overguard') return { weakness: overguardMultiplier, armor: 1, debuff: magneticMultiplier(stacks('magnetic')), debuffName: 'magnetic' }
    if (layer === 'shield') return { weakness, armor: 1, debuff: magneticMultiplier(stacks('magnetic')), debuffName: 'magnetic' }
    return { weakness, armor: bypassArmor || damageType === 'true' ? 1 : armorMultiplier, debuff: viralMultiplier(stacks('viral')), debuffName: 'viral' }
  }
  const typeMultiplier = (damageType: string, bypassArmor = false): number => {
    const factors = typeFactors(damageType, bypassArmor)
    return factors.weakness * factors.armor * factors.debuff
  }

  // Weak_Point: (head multiplier + 1.5 x weak point damage bonuses) x (1 + headshot multiplier bonuses)
  const weakPointMultiplier = headMultiplier + WEAK_POINT_BONUS_RATE_ON_HEAD * bonus.weakpointDamage
  // innate headshot bonuses (Kuva Chakkhurr, Cernos Prime +50%, Synapse +20%): "additive to other sources of +bonus damage on
  // headshot such as Primary Deadhead" (wiki Kuva Chakkhurr)
  bonus.headshotMultiplier += attack.extraHeadshot ?? 0
  const headshotFactor = isHeadshot && !noHeadMultiplier ? weakPointMultiplier * (1 + bonus.headshotMultiplier) : 1
  // Debuffs panel vulnerability + Petrify, added together
  const vulnerability = debuffs.damageVulnerability + abilityVulnerability
  // Meticulous Aim: "Bodyshot damage penalty is multiplicative to weapon overall damage", anything but the head
  const bodyShotFactor = isHeadshot ? 1 : bodyShotMultiplier
  const sharedMultiplier = (1 + vulnerability) * headshotFactor * bodyShotFactor

  // Xata's Whisper: X% of the weapon's total damage as a separate Void hit, faction applies to it twice
  // faction counts twice on these (Xata's Whisper wiki: "double dips on faction damage, and body part weaknesses"), so
  // Xata's own share gets the headshot part again too
  const moddedTotal = sum(Object.values(moddedByType))
  const extraHitNoCrit = sum(Object.entries(extraHits).map(([damageType, fraction]) => {
    const xataPart = damageType === 'void' ? Math.min(fraction, xataShare) : 0
    return (fraction + xataPart * (headshotFactor - 1)) * moddedTotal * typeMultiplier(damageType)
  })) * factionMultiplier
  const vsTargetNoCrit = (sum(
    Object.entries(moddedByType).map(([damageType, amount]) => amount * typeMultiplier(damageType)),
  ) + extraHitNoCrit) * factionMultiplier * sharedMultiplier

  // Melee Doughty (wiki Melee_Doughty): "round(Puncture Status Chance×0.1×Critical Multiplier Bonus)" as extra crit
  // multiplier, to 0.1, "Capped at +50x Critical Multiplier". Puncture status chance = status chance x Puncture's share of
  // the proc weighting, so elements lower it, and since Update 38.6 "the bonus no longer applies to the non-Puncture
  // portion of a weapon's attack": only the Puncture part of the hit gets the bigger crits. DoTs don't get it
  const procWeightOf = (damageType: string) => Math.max(0, (moddedByType[damageType] ?? 0) - quantize(separateElements[damageType] ?? 0) * moddedBaseDamage)
  const weightTotal = sum(Object.keys(moddedByType).map(procWeightOf))
  const punctureStatusChance = weightTotal > 0 ? Math.max(0, rawStatusChance) * procWeightOf('puncture') / weightTotal : 0
  const doughtyBonus = critPerPunctureStatus > 0 ? Math.min(50, Math.round(punctureStatusChance * 100 * 0.1 * critPerPunctureStatus * 10) / 10) : 0
  const puncturePart = doughtyBonus > 0 ? (moddedByType.puncture ?? 0) * typeMultiplier('puncture') * factionMultiplier * sharedMultiplier : 0
  if (critPerPunctureStatus > 0) {
    requirements.push(\`Melee Doughty: \${Math.round(punctureStatusChance * 1000) / 10}% Puncture status chance -> +\${doughtyBonus}x crit multiplier on the Puncture part of the hit only\`)
  }
  const hit = {
    normal: vsTargetNoCrit * normalCritMultiplier + puncturePart * Math.floor(Math.max(0, critChance)) * doughtyBonus,
    crit: vsTargetNoCrit * critHitMultiplier + puncturePart * Math.ceil(Math.max(0, critChance)) * doughtyBonus,
    average: vsTargetNoCrit * (averageCritMultiplier + attritionBonus) + puncturePart * Math.max(0, critChance) * (1 - superCritShare) * doughtyBonus,
  }
  // Melee Duplicate: "base (yellow) Critical Hits inflict a second instance of damage", the duplicate rerolls crit and
  // status (wiki). so a crit is worth one more hit and its procs. it's a separate instance, so hit.* stays one hit
  const strikes = isMelee ? 1 + Math.min(1, critChance) * duplicateOnCritChance : 1
  const hitsPerAttack = multishot * strikes
  const averageShot = hit.average * hitsPerAttack
  const burstDps = averageShot * fireRate

  // ---- 5. status procs + DoTs ----
  // Sagek Prime: a shot after a crit has a chance to roll at a fixed status chance instead
  const statusOverrideShare = statusOverride ? Math.min(1, critChance) * statusOverride.chance : 0
  const statusChance = statusOverride
    ? (1 - statusOverrideShare) * rawStatusChance + statusOverrideShare * statusOverride.statusChance
    : rawStatusChance
  const pelletsPerSecond = hitsPerAttack * fireRate
  const procsPerSecond = statusChance * pelletsPerSecond
  // proc weighting skips the separate elements (Melee Exposure etc.), they add damage but no proc share
  const procWeight: Record<string, number> = {}
  for (const [damageType, modded] of Object.entries(moddedByType)) {
    procWeight[damageType] = Math.max(0, modded - quantize(separateElements[damageType] ?? 0) * moddedBaseDamage)
  }
  const procWeightTotal = sum(Object.values(procWeight))
  const procShare = (damageType: string) => (procWeightTotal > 0 ? (procWeight[damageType] ?? 0) / procWeightTotal : 0)

  const procRates: Record<string, number> = {}
  for (const damageType of Object.keys(moddedByType)) procRates[damageType] = procsPerSecond * procShare(damageType)
  // Hunter Munitions: chance per crit, so it caps once every pellet crits
  // (on a beam that's per merged tick, not per beam)
  procRates.slash = (procRates.slash ?? 0) + Math.min(critChance, 1) * slashOnCritChance * pelletsPerSecond / beamMerge
  // Internal Bleeding: doubled when fire rate is below 2.5
  procRates.slash += (procRates.impact ?? 0) * slashOnImpactChance * (fireRate < 2.5 ? 2 : 1)
  // guaranteed procs ride on every pellet, on top of the status chance rolls (one per merged tick on a beam)
  for (const [damageType, perPellet] of Object.entries(forcedProcsPerPellet)) {
    procRates[damageType] = (procRates[damageType] ?? 0) + perPellet * pelletsPerSecond / beamMerge
  }

  // an immune target takes no procs at all, forced ones included
  if (statusMode === 'immune') for (const damageType of Object.keys(procRates)) procRates[damageType] = 0
  for (const damageType of target.statusImmune ?? []) if (damageType in procRates) procRates[damageType] = 0
  const procTypes = Object.keys(procRates).filter((damageType) => procRates[damageType] > 0)

  // procs inherit the crit of the hit that applied them, so I keep the normal/crit/average split.
  // modded base here is NOT quantized and uses the full base damage, not just that element's share.
  // procs carry the CO bonus from the hit that applied them (wiki: Blast/Electricity/Gas carry it into their radius)
  const statusBase = baseDamage * damageScale * heavyComboFactor * factionMultiplier
  const critSplit = (value: number): CritSplit => ({
    normal: value * normalCritMultiplier,
    crit: value * critHitMultiplier,
    average: value * averageCritMultiplier,
  })
  const scaleSplit = (split: CritSplit, factor: number): CritSplit => ({
    normal: split.normal * factor,
    crit: split.crit * factor,
    average: split.average * factor,
  })

  // Meticulous Aim on DoTs (wiki): "The -45% bodyshot damage is always applied twice to Slash, Heat, Toxin, and Blast, but will
  // not apply to Electricity or Gas if they are from a headshot"
  const dotBodyShot = (damageType: string) =>
    bodyShotMultiplier === 1 ? 1 : ['electricity', 'gas'].includes(damageType) && isHeadshot ? 1 : bodyShotMultiplier ** 2
  // Cascadia Empowered counts every proc that lands, before the stack caps below trim the DoTs
  const procsLanding = sum(Object.values(procRates))
  const procMix = Object.entries(procRates).filter(([, rate]) => rate > 0)
  const dots: DotRow[] = Object.entries(DOT_STATUSES)
    .filter(([damageType]) => (procRates[damageType] ?? 0) > 0)
    .map(([damageType, info]) => {
      const elementMultiplier = info.usesElementMods ? 1 + (elementBonus[damageType] ?? 0) + (statusElementBonus[damageType] ?? 0) : 1
      const headshotPart = !isHeadshot || noHeadMultiplier ? 1 : info.fullHeadshot ? headshotFactor : 1 + bonus.headshotMultiplier
      const merged = BEAM_MERGED_DOTS.includes(damageType) ? beamMerge : 1
      const beforeCrit =
        info.fraction * statusBase * elementMultiplier * factionMultiplier * (1 + bonus.statusDamage + (statusDamageByType[damageType] ?? 0)) *
        (1 + vulnerability) * headshotPart * merged * dotBodyShot(damageType)
      // Xata's Whisper also goes off on each Blast detonation: 26% x detonation x faction again x (1 + elemental mods),
      // "the Elemental Damage Bonus is applied even though Blast detonations don't scale off Elemental Damage Bonuses" (wiki)
      const xataOnBlast = damageType === 'blast' && xataShare > 0
        ? xataShare * beforeCrit * factionMultiplier * (1 + sum(Object.values(elementBonus))) * typeMultiplier('void')
        : 0
      const tick = critSplit(beforeCrit * typeMultiplier(damageType, info.bypassesArmor) + xataOnBlast)
      // Status Duration stretches the DoT, at one tick per second that's more ticks (wiki Status_Duration).
      // Blast is a single hit so it doesn't care
      const durationScale = 1 + bonus.statusDuration + (statusDurationByType['*'] ?? 0) + (statusDurationByType[damageType] ?? 0)
      const ticks = info.ticks > 1 ? Math.max(1, Math.floor(info.ticks * durationScale + 1e-9)) : info.ticks
      const perProc = scaleSplit(tick, ticks)
      // a status-capped target only holds 4 stacks: past procs/s x duration = 4, extra procs replace running ones, so
      // the DoT can't go above 4 running at once
      if (statusMode === 'capped' && ticks > 1) procRates[damageType] = Math.min(procRates[damageType], CAPPED_STATUS_STACKS / ticks)
      // Gas: "Up to 10 instances of the effect can stack on the same target, with each instance having its own timer. Any
      // instances after the 10th will replace the oldest instance" (wiki Gas). so at most 10 clouds tick at once, and procs past
      // 10 per cloud lifetime only cut older clouds short. high-status Gas builds hit this fast (Boar Incarnon, 30+ procs/s)
      if (damageType === 'gas' && ticks > 1) procRates[damageType] = Math.min(procRates[damageType], GAS_MAX_INSTANCES / ticks)

      let aoe: DotRow['aoe'] = null
      if (damageType === 'blast') {
        // the explosion hits *other* enemies, so the target's armor/viral/vulnerability don't apply,
        // just the faction weakness (assuming they're the same faction)
        const detonationBase = (beforeCrit / (1 + vulnerability)) * (BLAST_DETONATION_MULTIPLIER / info.fraction)
        aoe = { label: '10-stack AoE', damage: critSplit(detonationBase * (factionWeakness.blast ?? 1)) }
      }
      return {
        damageType,
        procsPerSecond: procRates[damageType],
        tick,
        ticks,
        perProc,
        dps: perProc.average * procRates[damageType],
        aoe,
        note: info.note,
        factors: {
          fraction: info.fraction, statusBase, element: elementMultiplier, faction: factionMultiplier,
          statusDamage: bonus.statusDamage + (statusDamageByType[damageType] ?? 0), vulnerability, headshot: headshotPart, merged,
          type: typeMultiplier(damageType, info.bypassesArmor),
        },
      }
    })
  // Nightwatch Napalm (wiki Nightwatch_Napalm): each rocket's explosion leaves fire that deals "30% of the weapon's
  // modified base damage as Heat damage ... over 6 seconds". "Damage output can only be increased by base damage mods"
  // and faction mods (Kuva bonus element too, it's already in the base here), "Napalm cannot deal critical damage via any
  // means", Status Damage mods don't touch it. so: base x (1 + damage mods) x faction, no CO, no elements, no crit.
  // the fire also procs Heat at a fixed 68% chance, "ticking for 50% of napalm's damage per second for 3 seconds", and
  // those procs do get Heat mods. I assume 1 tick/s, the target stays in the fire, and each rocket's patch burns on its own
  // (the cast: TS can't see the assignment inside applyEffect's closure)
  const napalmEffect = napalm as Extract<ModEffect, { kind: 'napalm' }> | null
  if (napalmEffect && attack.isAoE) {
    const napalm = napalmEffect
    const flat = (value: number): CritSplit => ({ normal: value, crit: value, average: value })
    const fireTick = (napalm.fraction / napalm.seconds) * baseDamage * (1 + bonus.damage) * heavyComboFactor * factionMultiplier * (1 + vulnerability)
    const ticks = Math.max(1, Math.round(napalm.seconds))
    const fireFactors = { fraction: napalm.fraction / napalm.seconds, statusBase: baseDamage * (1 + bonus.damage), element: 1, faction: factionMultiplier, statusDamage: 0, vulnerability, headshot: 1, merged: 1, type: typeMultiplier('heat') }
    const fire = flat(fireTick * typeMultiplier('heat'))
    dots.push({
      damageType: 'napalm', procsPerSecond: pelletsPerSecond, tick: fire, ticks, perProc: scaleSplit(fire, ticks), dps: fire.average * ticks * pelletsPerSecond, aoe: null,
      note: \`Nightwatch Napalm: \${Math.round(napalm.fraction * 100)}% of the rocket's base damage (base damage and faction mods only) as Heat over \${napalm.seconds} s. No crits. Assumes the target stays in the fire and every rocket's patch burns separately.\`,
      factors: fireFactors,
    })
    if (statusMode !== 'immune') {
      const heatScale = 1 + (elementBonus.heat ?? 0)
      const durationScale = 1 + bonus.statusDuration + (statusDurationByType['*'] ?? 0) + (statusDurationByType.heat ?? 0)
      const procTicks = Math.max(1, Math.floor(3 * durationScale + 1e-9))
      const procTick = flat(0.5 * fireTick * heatScale * typeMultiplier('heat'))
      const procsPerSecond = pelletsPerSecond * ticks * napalm.procChance
      dots.push({
        damageType: 'napalm-heat', procsPerSecond, tick: procTick, ticks: procTicks, perProc: scaleSplit(procTick, procTicks), dps: procTick.average * procTicks * procsPerSecond, aoe: null,
        note: \`Heat procs from the napalm: \${Math.round(napalm.procChance * 100)}% per fire tick (mods don't change it), each ticking for 50% of a fire tick x (1 + Heat mods) for 3 s (longer with Status Duration). Counted from the moment the rocket lands.\`,
        factors: { ...fireFactors, fraction: 0.5 * fireFactors.fraction, element: heatScale },
      })
    }
    const line = 'Nightwatch Napalm: target stays in the fire for the full burn'
    if (!requirements.includes(line)) requirements.push(line)
  }
  // Cascadia Empowered (wiki): "Creates an extra instance of damage when proccing a status effect" worth 750 of the proc's
  // damage type. "Not affected by damage, element, physical ... or critical mods", "Affected by faction mods and bonuses once",
  // "Affected by Damage Vulnerability", "Not affected by weakspots", but the target's armor and weakness to that type do count.
  // so per proc: 750 x faction x (1 + vulnerability) x type multiplier, averaged over the build's proc mix
  if (flatPerProc > 0 && procsLanding > 0) {
    const perProc = sum(procMix.map(([damageType, rate]) => rate * typeMultiplier(damageType))) / procsLanding * flatPerProc * factionMultiplier * (1 + vulnerability)
    const flat: CritSplit = { normal: perProc, crit: perProc, average: perProc }
    dots.push({
      damageType: 'cascadia', procsPerSecond: procsLanding, tick: flat, ticks: 1, perProc: flat, dps: perProc * procsLanding, aoe: null,
      note: \`Cascadia Empowered: +\${flatPerProc} per status proc in the proc's own damage type, faction and vulnerability only (no mods, crits or headshots).\`,
      factors: { fraction: 0, statusBase: flatPerProc, element: 1, faction: factionMultiplier, statusDamage: 0, vulnerability, headshot: 1, merged: 1, type: perProc / (flatPerProc * factionMultiplier * (1 + vulnerability)) },
    })
  }
  const dotDps = sum(dots.map((dot) => dot.dps))

  // ---- biggest single instance (damage cap tab) ----
  // any crit chance means the top tier can roll. a non-crit can only happen below 100%, Gotva's override rolls its own tiers
  const peakMultiplier = Math.max(
    critChance > 0 ? critHitMultiplier : normalCritMultiplier,
    critChance < 1 && nonCritPeakBonus > 0 ? 1 + nonCritPeakBonus : 0,
    critOverride ? 1 + Math.ceil(critOverride.critChance) * (critMultiplier - 1) : 0,
  )
  // Ballistic Battery adds to the base after damage mods, then elements/crit/faction/head scale it like the rest
  const batteryScale = moddedBaseDamage > 0 && oneShotFlat > 0 ? (moddedBaseDamage + oneShotFlat) / moddedBaseDamage : 1
  const peakHit = vsTargetNoCrit * peakMultiplier * beamMerge * batteryScale + (critChance > 0 ? puncturePart * Math.ceil(critChance) * doughtyBonus * beamMerge : 0)
  const peakDot = dots.filter((dot) => dot.damageType !== 'blast').sort((a, b) => b.tick.crit - a.tick.crit)[0]
  const peakDotTick = peakDot ? { damageType: peakDot.damageType, value: peakDot.tick.crit } : null

  // ---- 6. magazine + reload (wiki Damage/Calculation, Reload_Speed) ----
  // melee has no magazine. Incarnon forms run on their "Incarnon Charges" (wiki): spent charges count as a magazine with
  // the weapon's reload, like Underframe does (in game the form ends and you charge it back up). forms the wiki has no
  // charge count for still don't reload
  const incarnonCharges = isIncarnonAttack ? attack.incarnonCharges ?? null : null
  const reloads = weapon.category !== 'Melee' && (!isIncarnonAttack || Boolean(incarnonCharges)) && Boolean(incarnonCharges ?? weapon.magazineSize) && Boolean(weapon.reloadTime)
  // magazine mods don't touch the charges (Underframe: Vasto Prime's 24 stay 24 with Slip Magazine)
  const magazineSize = !reloads ? null : incarnonCharges ?? Math.max(1, Math.round(weapon.magazineSize! * (1 + bonus.magazineCapacity) * magazineMultiplier))
  // shell-by-shell weapons (Felarx, Strun, Corinth...): (start/end delay + per shell x magazine) / (1 + reload speed),
  // so magazine mods make the reload longer. the Incarnon form's refill reloads are base form reloads too, shell by shell
  // with the base form's magazine (they used to be the flat listed reload whatever the magazine). the form swap stays on the
  // listed reload stat, the wiki only says it's "equal to the weapon's reload speed"
  const shellReload = SHELL_BY_SHELL_RELOAD[weapon.name]
  const baseFormMagazine = weapon.magazineSize ? Math.max(1, Math.round(weapon.magazineSize * (1 + bonus.magazineCapacity) * magazineMultiplier)) : null
  // unmodded reload speed (the form swap) or the build's (normal-form reloads)
  const baseFormReload = (speedScale: number) =>
    (shellReload && baseFormMagazine ? shellReload.delay + shellReload.perShell * baseFormMagazine : weapon.reloadTime ?? 0) / speedScale
  const reloadSpeedScale = Math.max(0.01, 1 + bonus.reloadSpeed)
  const normalReload = !reloads
    ? null
    : reloadOverride ?? baseFormReload(reloadSpeedScale)
  // the Incarnon form's "reload" is filling the gauge again with the normal form (wiki: "Incarnon Form is charged by filling
  // the Incarnon Transmutation gauge ... by achieving weakpoint hits", "each charge producing 3 rounds to a maximum of 24" on
  // Vasto, "Individual Multishot bullets can build charges"). so a full form takes charges / rounds-per-hit weak point hits,
  // landed at the normal form's own rate: its fire rate (same fire rate mods) x its projectiles, reloads included. every
  // normal-form bullet is assumed to land on a weak point (Torid / Angstrum count direct hits instead), so this is the best case
  const refill = incarnonCharges && attack.incarnonRefill ? (() => {
    const normal = weapon.attacks.find((candidate) => !/incarnon/i.test(candidate.name) && !candidate.parts && !candidate.heavy)
    if (!normal) return null
    const pullRate = normal.fireRate * Math.max(0.01, 1 + fireRateBonus) * fireRateMultiplier
    const projectiles = (normal.multishot ?? 1) * (1 + bonus.multishot)
    const normalMagazine = baseFormMagazine
    const normalReloadTime = baseFormReload(reloadSpeedScale)
    const pullsPerSecond = normalMagazine ? normalMagazine / (normalMagazine / pullRate + normalReloadTime) : pullRate
    const hits = incarnonCharges / attack.incarnonRefill.roundsPerHit / (1 + incarnonChargeBonus)
    const filling = hits / (pullsPerSecond * projectiles)
    // switching takes a reload both ways: "Mode switching is not instantaneous and has an animation equal to the weapon's
    // reload speed" (every Genesis page), and "When Incarnon Form ends, the weapon's magazine will be refilled ... as if it were
    // reloaded" (wiki Incarnon). reload mods don't shorten it: Phenmor's reload perk "Does not affect transition from Incarnon
    // back to base form" and only reaches the way in "with a well-timed manual reload". in game the swap runs longer than a
    // plain reload (my call, no source gives a timing), so each swap is 2x the base reload, in and out
    const switching = 2 * INCARNON_SWAP_RELOADS * (weapon.reloadTime ?? 0)
    const seconds = filling + switching
    requirements.push(\`Incarnon form refill: \${Math.round(hits)} \${attack.incarnonRefill.directHits ? 'direct' : 'weak point'} hits with the normal form (\${(pullsPerSecond * projectiles).toFixed(1)}/s, every normal shot assumed to count) = \${filling.toFixed(1)} s, plus \${switching.toFixed(1)} s switching in and out = \${seconds.toFixed(1)} s per \${incarnonCharges}-round form\`)
    return seconds
  })() : null
  const reloadTime = refill ?? normalReload
  // Ammo Efficiency: that share of shots is free, so a magazine fires magazine / (1 - efficiency) shots. capped at 75% in
  // total since Hotfix 44.1.3 ("only 1 in 4 shots uses ammo"); what used to be 100% is now "Infinite Ammo", which ignores it
  // ...but never on an Incarnon form: its charges aren't ammo, so no source of Ammo Efficiency (mods, arcanes, evolutions like
  // Felarx's Ruptured Plentitude) stretches them
  const ammoEfficiency = incarnonCharges ? 0 : (infiniteAmmo as boolean) ? 0.99 : Math.min(AMMO_EFFICIENCY_CAP, bonus.ammoEfficiency)
  if (incarnonCharges && (bonus.ammoEfficiency > 0 || (infiniteAmmo as boolean))) requirements.push('Ammo Efficiency: does nothing on the Incarnon form (charges aren\\'t ammo)')
  // rounds per magazine: ammo per round from the wiki (Tenet Tetra's grenade "consumes all ammo", 80 of 80), at least 1
  // a cost of the whole base magazine means it always takes everything that's left, so bigger magazines still give one
  // (against the Incarnon charges for a form: Onos's 57-round cycle isn't "the whole magazine" of a 350-round form)
  const baseMagazine = incarnonCharges ?? weapon.magazineSize
  const takesWholeMagazine = Boolean(attack.ammoCost && baseMagazine && attack.ammoCost >= baseMagazine)
  // Plentiful Mayhem: every projectile costs a round, so a shot of M projectiles uses M x the shot's cost (the average M, a
  // 2.4 multishot fires 2 or 3). no floor then, it's an average over many magazines
  const ammoPerShot = (attack.ammoCost ?? 1) * (mayhem ? Math.max(1, multishot) : 1)
  const roundsPerMagazine = magazineSize
    ? (takesWholeMagazine || attack.reloadsAfterShot ? 1 : Math.max(1, mayhem ? magazineSize / ammoPerShot : Math.floor(magazineSize / ammoPerShot + 1e-9)))
    : null
  if (mayhem && magazineSize) requirements.push(\`\${mayhem.perk} (Incarnon): each shot uses \${ammoPerShot.toFixed(2)} rounds (its multishot), \${roundsPerMagazine!.toFixed(1)} shots per \${magazineSize}-round magazine\`)
  const shotsPerMagazine = roundsPerMagazine ? roundsPerMagazine / Math.max(0.01, 1 - ammoEfficiency) : null
  const uptime = shotsPerMagazine && reloadTime ? shotsPerMagazine / (fireRate * reloadTime + shotsPerMagazine) : 1
  const steadyStateDps = (burstDps + dotDps) * uptime

  // shots over time with procs on their own clocks (src/calc/simulate.ts)
  const pelletsPerSecondForModel = hitsPerAttack * fireRate
  const shotModel: ShotModel = {
    firstShotAt: attack.firstShotAfterCharge ? 1 / fireRate : 0,
    fireRate,
    multishot: hitsPerAttack,
    magazineSize: shotsPerMagazine,
    reloadTime,
    hit,
    critChance,
    instantDots: detonatesDots,
    dots: dots.map((dot) => ({
      damageType: dot.damageType,
      procsPerPellet: pelletsPerSecondForModel > 0 ? dot.procsPerSecond / pelletsPerSecondForModel : 0,
      tick: dot.damageType === 'blast' ? dot.perProc : dot.tick,
      ticks: dot.damageType === 'blast' ? 1 : dot.ticks,
      // merged attacks label their parts' rows "heat (Explosion)", so go by the type before the label
      firstTickAt: firstTickFor(dot.damageType.split(' (')[0]),
      refreshes: dot.damageType === 'heat' && statusMode !== 'capped', // capped Heat can't pile past 4
    })),
  }
  const damageInWindow = (seconds: number) => expectedDamage(shotModel, seconds)
  const simulateWindows = (windows: number[], runs?: number) => simulateDamage(shotModel, windows, runs)
  const sustainedDps = damageInWindow(SUSTAINED_FIGHT_SECONDS) / SUSTAINED_FIGHT_SECONDS

  // Harmony: the heavy's own procs land all their ticks at once, plus every Slash/Heat/Toxin/Electricity/Gas stack
  // already on the target (from the Debuffs panel). those were put there by normal swings, so I scale the heavy's
  // proc damage back down by the heavy multiplier and combo
  let detonation: CalcResult['detonation'] = null
  if (detonatesDots) {
    const normalSwingScale = 1 / ((attack.heavyMultiplier ?? 1) * heavyComboFactor)
    let ownProcs = 0
    let existingStacks = 0
    for (const dot of dots) {
      if (dot.damageType === 'blast') continue
      ownProcs += (dot.procsPerSecond / fireRate) * dot.perProc.average
      existingStacks += stacks(dot.damageType) * dot.perProc.average * normalSwingScale
    }
    // stacks of types this heavy doesn't proc itself still detonate, using the same per-proc math
    for (const damageType of ['slash', 'heat', 'toxin', 'electricity', 'gas']) {
      if (stacks(damageType) <= 0 || dots.some((dot) => dot.damageType === damageType)) continue
      const info = DOT_STATUSES[damageType]
      const elementMultiplier = info.usesElementMods ? 1 + (elementBonus[damageType] ?? 0) + (statusElementBonus[damageType] ?? 0) : 1
      const durationScale = 1 + bonus.statusDuration + (statusDurationByType['*'] ?? 0) + (statusDurationByType[damageType] ?? 0)
      const perProc =
        info.fraction * statusBase * elementMultiplier * factionMultiplier * (1 + bonus.statusDamage + (statusDamageByType[damageType] ?? 0)) * (1 + vulnerability) *
        typeMultiplier(damageType, info.bypassesArmor) * averageCritMultiplier * Math.floor(info.ticks * durationScale + 1e-9)
      existingStacks += stacks(damageType) * perProc * normalSwingScale
    }
    detonation = { ownProcs, existingStacks }
  }

  // everything one attack does: every pellet/duplicate plus the full DoT of each proc it lands (glaive detonations live on
  // their forced Slash, heavy Harmony on its procs). ticks that land later still count, unlike the single-hit score
  const attackTotal = averageShot + sum(dots.map((dot) => (fireRate > 0 ? dot.procsPerSecond / fireRate : 0) * dot.perProc.average))

  const damageTypes = Object.entries(moddedByType)
    .map(([damageType, modded]) => ({
      damageType,
      modded,
      vsTarget: modded * typeMultiplier(damageType) * factionMultiplier * sharedMultiplier * (averageCritMultiplier + attritionBonus),
      procShare: procShare(damageType),
    }))
    .sort((a, b) => b.modded - a.modded)

  return {
    damageTypes,
    moddedBaseDamage,
    critChance,
    critMultiplier,
    critTier: Math.ceil(critChance),
    statusChance,
    multishot,
    multishotLocked,
    peakHit,
    peakDotTick,
    beam: Boolean(attack.continuous),
    beamMerge,
    multishotModsIgnored: Boolean(attack.noMultishotMods),
    fireRate,
    factionMultiplier,
    activeStatusTypes,
    conditionOverload: { mode: co.mode, bonus: coBonus, source: co.source, note: co.note },
    headshot: {
      applied: isHeadshot,
      factor: headshotFactor,
      weakPointMultiplier,
      headshotBonus: bonus.headshotMultiplier,
      headcrit: isHeadshot && headcrit,
    },
    armor: { before: armor, after: armorAfter, damageMultiplier: armorMultiplier },
    hit,
    averageShot,
    attackTotal,
    battery: incarnonCharges && shotsPerMagazine ? {
      rounds: incarnonCharges, shots: shotsPerMagazine, seconds: shotsPerMagazine / fireRate,
      damage: attackTotal * shotsPerMagazine, refillSeconds: reloadTime,
    } : null,
    duplicateStrikes: strikes,
    burstDps,
    procsPerSecond,
    dots,
    dotDps,
    totalDps: burstDps + dotDps,
    magazineSize,
    reloadTime,
    uptime,
    sustainedDps,
    steadyStateDps,
    timeToKill: null,
    shellByShell: Boolean(shellReload) && reloads && !incarnonCharges,
    damageInWindow,
    simulateWindows,
    shotModel,
    fireRateLocked,
    passives: activePassives,
    abilities: activeAbilities,
    requirements,
    statusTriggers,
    procTypes,
    setBonuses: setSummary(setPieces),
    heavyCombo,
    detonation,
    melee: isMelee
      ? {
          combo,
          heavy: isHeavy,
          critFromCombo,
          statusFromCombo,
          windUp,
          comboAfterHeavy: isHeavy ? comboAfterSpending(weapon.name, combo, bonus.heavyEfficiency) : null,
        }
      : null,
    statusTypeSource: debuffs.statusTypeSource === 'debuffs' ? 'debuffs' : 'build',
    unparsed,
    breakdown: {
      baseDamage, damageBonus: bonus.damage, separateMultiplier: separateDamageMultiplier, coMode: co.mode, coBonus,
      heavyCombo: heavyComboFactor, damageScale,
      types: Object.entries(moddedByType).map(([damageType, modded]) => ({
        damageType, share: moddedBaseDamage > 0 ? modded / moddedBaseDamage : 0, modded, type: typeMultiplier(damageType), ...typeFactors(damageType),
      })).sort((a, b) => b.modded - a.modded),
      typeParts: Object.entries(proportions).filter(([, raw]) => raw > 0)
        .map(([damageType, raw]) => ({ damageType, raw, parts: typeParts[damageType] ?? [] })).sort((a, b) => b.raw - a.raw),
      extraHit: extraHitNoCrit, faction: factionMultiplier, vulnerability, headshot: headshotFactor,
      critChance, critMultiplier, critAverage: averageCritMultiplier, critNormal: normalCritMultiplier, critHit: critHitMultiplier,
      attrition: attritionBonus,
    },
  }
}

// Heavy Attack Efficiency keeps that share of the combo *count* (not the multiplier), capped at 90%.
// wiki example: 40% at 160 hits (9x) leaves 64 hits (4x)
function comboAfterSpending(weaponName: string, combo: number, efficiency: number) {
  const perTier = hitsPerComboTier(weaponName)
  const hits = (combo - 1) * perTier
  const kept = Math.floor(hits * Math.min(MAX_HEAVY_EFFICIENCY, Math.max(0, efficiency)))
  return Math.min(maxComboFor(weaponName), 1 + Math.floor(kept / perTier))
}
`,ne=`// the 32-bit damage limit. damage isn't capped there: anything past it shows on screen as -2,147,483,648 (the float
// doesn't fit in an int, so it lands on the bottom value instead of wrapping), and the game log writes the real
// value under a "number too large" error. so I show both
export const INT_LIMIT = 2_147_483_647
export const INT_MIN = -2_147_483_648

// what the damage number on screen reads
export function onScreen(value: number): number {
  const rounded = Math.round(value)
  return rounded <= INT_LIMIT ? rounded : INT_MIN
}
`,re=`// Incarnon evolutions change the weapon itself (the form's base damage, crit, status, fire rate...), so anywhere I talk
// about a weapon's "base stats" (Compare Weapons, the Rivens page) it's the evolved numbers, not the raw data. a weapon
// with an Incarnon form opens on that form, since that's how it's actually played
import { calculate } from './damage'
import { getIncarnonTiers, type SelectedPerk } from './incarnon'
import { attackMetrics, buildPool, damageSplit, groupMembers, isIncarnonAttack, metricsFromResult, type AttackMetrics, type Pool } from './weaponProfile'
import { SCENARIO_DEBUFFS, SCENARIO_TARGET } from '../optimizer/scenario'
import type { Leaderboard } from '../optimizer/leaderboardTypes'
import type { Attack, Weapon } from '../types'

export type Picks = Record<string, string> // evolution tier -> perk name

// the Incarnon form if there is one (Braton Prime, Boar...), else the first attack. melee Incarnons have no separate
// form (their evolutions apply to every swing), so they stay on the normal attack and get evolved there
export const defaultAttackIndex = (weapon: Weapon) => {
  if (!getIncarnonTiers(weapon.name)) return 0
  const index = weapon.attacks.findIndex(isIncarnonAttack)
  return index >= 0 ? index : 0
}

export function selectedPerks(weapon: Weapon, picks: Picks): SelectedPerk[] {
  return (getIncarnonTiers(weapon.name) ?? []).flatMap(({ tier, perks }) => {
    const perk = perks.find((option) => option.name === picks[tier])
    return perk ? [{ perk, stacks: 0 }] : []
  })
}

export interface Evolved {
  attack: Attack // same attack with the evolved numbers in it (damage per type, crit, status, fire rate)
  metrics: AttackMetrics
  shares: { type: string; share: number }[] // damage split, biggest first
  evolved: boolean // any evolution actually applied
}

// the attack with these evolutions on and no mods: what the arsenal shows with those perks picked. conditional parts of
// perks stay off, same as the leaderboard. no evolutions = straight from the data
export function evolve(weapon: Weapon, attack: Attack, picks: Picks): Evolved {
  const perks = selectedPerks(weapon, picks)
  if (!perks.length) return { attack, metrics: attackMetrics(weapon, attack), shares: damageSplit(attack).shares, evolved: false }
  const result = calculate({
    weapon, attack, mods: [], incarnonPerks: perks, target: SCENARIO_TARGET, armor: 0,
    debuffs: { ...SCENARIO_DEBUFFS, statusTypeSource: 'debuffs' }, buffs: { roar: 0, combo: 1 },
  })
  const damage = Object.fromEntries(result.damageTypes.filter((row) => row.modded > 0).map((row) => [row.damageType, row.modded]))
  const total = Object.values(damage).reduce((sum, amount) => sum + amount, 0)
  const shares = Object.entries(damage).map(([type, amount]) => ({ type, share: total > 0 ? amount / total : 0 })).sort((a, b) => b.share - a.share)
  return {
    attack: { ...attack, damage, critChance: result.critChance, critMultiplier: result.critMultiplier, statusChance: result.statusChance, fireRate: result.fireRate },
    metrics: metricsFromResult(weapon, attack, result),
    shares,
    evolved: true,
  }
}

// the leaderboard's evolutions for this attack on a board, the starting point when nobody's picked any
export function leaderboardPicks(leaderboard: Leaderboard | null, weapon: Weapon, attack: Attack, board = 'sustained'): Picks | null {
  const entry = (leaderboard?.boards[board] ?? leaderboard?.boards.sustained)?.find((candidate) => candidate.weaponId === weapon.uniqueName && candidate.attack === attack.name)
  return entry ? Object.fromEntries(entry.perks.map((perk) => [perk.tier, perk.name])) : null
}

// the Incarnon pool with every form evolved the leaderboard's way, so an evolved form isn't ranked against bare ones.
// one per ranking group (Incarnon rifles, Incarnon pistols...), cached per leaderboard
const pools = new WeakMap<Leaderboard, Map<string, Pool | undefined>>()
export function incarnonPool(leaderboard: Leaderboard | null, group: string): Pool | undefined {
  if (!leaderboard) return undefined
  let cache = pools.get(leaderboard)
  if (!cache) pools.set(leaderboard, (cache = new Map()))
  if (cache.has(group)) return cache.get(group)
  const list = groupMembers(group).flatMap((weapon) => {
    const attack = weapon.attacks.find(isIncarnonAttack)
    if (weapon.exalted || !attack) return []
    const { metrics } = evolve(weapon, attack, leaderboardPicks(leaderboard, weapon, attack) ?? {})
    return metrics.damage > 0 ? [metrics] : []
  })
  const pool = list.length > 1 ? buildPool(list) : undefined
  cache.set(group, pool)
  return pool
}
`,ie=`// turns the hand-collected Incarnon perk text (src/data/incarnon.ts) into effects the calc understands
import { INCARNON_FAMILIES } from '../data/incarnon'
import { parseStatLine, triggerUptime, type ModEffect, type TriggerContext } from './parseMod'

export type PerkMode = 'both' | 'normal' | 'incarnon'
export type BaseStat = 'damage' | 'critChance' | 'critMultiplier' | 'statusChance' | 'multishot'

export type PerkEffect =
  | { kind: 'base'; stat: BaseStat; value: number } // added to the weapon's base stats before mods
  | { kind: 'flat'; stat: 'critChance' | 'statusChance'; value: number } // native Incarnons: added after mods
  | { kind: 'mod'; effect: ModEffect } // works like a mod line (+% Damage, +% Multishot, ...)
  | { kind: 'mods'; effects: ModEffect[] } // a line that's more than one mod effect (King's Gambit)
  | { kind: 'nonCritBonus'; chance: number; value: number } // Devouring/Devastating Attrition
  | { kind: 'armorStripPerPuncture'; value: number } // Latron's Flensing Spikes
  // Wiseman's Regard / Decisive Stature: base chance goes up by a share of the other modded chance, capped
  | { kind: 'convert'; stat: 'critChance' | 'statusChance'; from: 'critChance' | 'statusChance'; ratio: number; max: number }
  // Final Fusillade (Torid) / Forceful Finality (Burston): a base bonus on the last shot / burst of each magazine only
  | { kind: 'lastShot'; stat: 'multishot'; value: number; burst: boolean }
  // Plentiful Mayhem (Torid, Miter): every extra projectile from multishot uses a round of the magazine, and on Torid the
  // extra projectiles hit harder (or, in the Incarnon form, multishot bonuses are 60% bigger)
  | { kind: 'multishotCostsAmmo'; damage: number }
  // Incarnon Efficiency / Catalyst: "+50% Incarnon charge" per weak point hit, so the form refills in fewer hits
  | { kind: 'chargeGain'; value: number }
  // Survivor's Edge: "Base Status Chance set to 12%", replaces the base instead of adding to it
  | { kind: 'baseSet'; stat: 'critChance' | 'statusChance' | 'critMultiplier'; value: number }

export interface PerkStatement {
  text: string
  effect: PerkEffect | null // null = not modeled (ammo, recoil, combo...)
  mode: PerkMode
  condition: string | null
  maxStacks: number
}

export interface IncarnonPerk {
  tier: string
  name: string
  statements: PerkStatement[]
  maxStacks: number // 0 = no conditional part, 1 = on/off, more = stacks
}

export interface IncarnonTier {
  tier: string
  perks: IncarnonPerk[]
}

const TIER_ORDER = ['II', 'III', 'IV', 'V']
const percent = (text: string) => Number(text) / 100

function parsePerkBody(body: string, native: boolean): PerkEffect | null {
  // Attrition perks (Devouring on Laetum/Phenmor, Devastating on Felarx): the hit deals its normal damage plus 2000% on
  // top, so x21 total. wiki Phenmor's Evolution V section words it "+2000% damage" (the overview table drops the plus).
  // Underframe uses x20, I'm going with x21
  const nonCrit = body.match(/^([\\d.]+)% chance (?:to deal|for) \\+?([\\d.]+)% Damage$/)
  if (nonCrit) return { kind: 'nonCritBonus', chance: percent(nonCrit[1]), value: percent(nonCrit[2]) }

  const armorStrip = body.match(/^Remove ([\\d.]+)% Armor per Puncture stack$/)
  if (armorStrip) return { kind: 'armorStripPerPuncture', value: percent(armorStrip[1]) }

  // King's Gambit (Sicarus): "Bodyshots can't crit, weak point hits get +150% Critical Chance" -> two mod-like lines, the
  // second only counts on heads like Acuity's weak point crit
  const kingsGambit = body.match(/^Bodyshots can't crit, weak point hits get \\+([\\d.]+)% Critical Chance$/)
  if (kingsGambit) return { kind: 'mods', effects: [{ kind: 'noBodyCrit' }, { kind: 'stat', stat: 'weakpointCritChance', value: percent(kingsGambit[1]) }] }
  const baseSet = body.match(/^Base (Critical Chance|Status Chance|Critical Multiplier) set to ([\\d.]+)(%|x)$/)
  if (baseSet) {
    const stat = baseSet[1] === 'Critical Chance' ? 'critChance' : baseSet[1] === 'Status Chance' ? 'statusChance' : 'critMultiplier'
    return { kind: 'baseSet', stat, value: baseSet[3] === '%' ? percent(baseSet[2]) : Number(baseSet[2]) }
  }
  // High Ground / Wiseman's Regard written the other way: "Converts 25% of current Status Chance to Base Critical Chance, max 35%"
  const converts = body.match(/^Converts ([\\d.]+)% of current (Critical|Status) Chance to Base (Critical|Status) Chance, max ([\\d.]+)%$/)
  const convert = converts ?? body.match(/^\\+([\\d.]+)% of current (Critical|Status) Chance as Base (Critical|Status) Chance, up to ([\\d.]+)%$/)
  if (convert) {
    const statOf = (word: string) => (word === 'Critical' ? 'critChance' : 'statusChance')
    return { kind: 'convert', stat: statOf(convert[3]), from: statOf(convert[2]), ratio: percent(convert[1]), max: percent(convert[4]) }
  }
  // timed genesis buffs whose wiki text has no "Base" (Prolific Perforation, Piercing Stature): I read them as flat after mods
  const flatChance = body.match(/^([+-][\\d.]+)% Flat (Critical|Status) Chance$/)
  if (flatChance) return { kind: 'flat', stat: flatChance[2] === 'Critical' ? 'critChance' : 'statusChance', value: percent(flatChance[1]) }

  const baseDamage = body.match(/^\\+?(-?[\\d.]+) Base Damage$/)
  if (baseDamage) return { kind: 'base', stat: 'damage', value: Number(baseDamage[1]) }
  const baseCrit = body.match(/^([+-][\\d.]+)% Base Critical Chance$/)
  if (baseCrit) return { kind: 'base', stat: 'critChance', value: percent(baseCrit[1]) }
  const baseCritMultiplier = body.match(/^([+-][\\d.]+)x? Base Critical Multiplier$/)
  if (baseCritMultiplier) return { kind: 'base', stat: 'critMultiplier', value: Number(baseCritMultiplier[1]) }
  const baseStatus = body.match(/^([+-][\\d.]+)% Base Status Chance$/)
  if (baseStatus) return { kind: 'base', stat: 'statusChance', value: percent(baseStatus[1]) }
  const baseMultishot = body.match(/^([+-][\\d.]+) Base Multishot$/)
  if (baseMultishot) return { kind: 'base', stat: 'multishot', value: Number(baseMultishot[1]) }

  // plain crit/status chance: the native Incarnons add these flat after mods. on genesis weapons the
  // wiki text is "Base" (my notes dropped the word in a couple of spots), so treat it as base there
  const plainChance = body.match(/^([+-][\\d.]+)% (Critical|Status) Chance$/)
  if (plainChance) {
    const stat = plainChance[2] === 'Critical' ? 'critChance' : 'statusChance'
    return native ? { kind: 'flat', stat, value: percent(plainChance[1]) } : { kind: 'base', stat, value: percent(plainChance[1]) }
  }

  const modEffect = parseStatLine(body)
  return modEffect ? { kind: 'mod', effect: modEffect } : null
}

function parsePerkLine(effects: string, native: boolean): PerkStatement[] {
  const statements: PerkStatement[] = []
  let condition: string | null = null

  for (const rawStatement of effects.split(/;\\s*/).map((part) => part.trim()).filter(Boolean)) {
    const stackCap = rawStatement.match(/^Stacks up to (\\d+)x\\.?$/)
    if (stackCap) {
      // the cap belongs to whatever condition is running
      for (const statement of statements) if (statement.condition === condition && condition) statement.maxStacks = Number(stackCap[1])
      continue
    }

    let text = rawStatement
    let mode: PerkMode = 'both'
    const modeTag = text.match(/\\s*\\[(Incarnon Form only|Normal only)\\]$/)
    if (modeTag) {
      mode = modeTag[1] === 'Normal only' ? 'normal' : 'incarnon'
      text = text.slice(0, modeTag.index).trim()
    }

    // "On last shot in magazine: +3 Base Multishot" isn't a buff you keep up, it's one shot (or one burst) per magazine.
    // damage.ts spreads it over the magazine as an average
    const lastShot = text.match(/^On (last shot in magazine|final magazine burst):\\s*\\+([\\d.]+) Base Multishot$/i)
    if (lastShot) {
      statements.push({ text: rawStatement, effect: { kind: 'lastShot', stat: 'multishot', value: Number(lastShot[2]), burst: /burst/i.test(lastShot[1]) }, mode, condition: null, maxStacks: 1 })
      continue
    }
    // the refill already assumes weak point hits, so "On Weakpoint Hit: +50% Incarnon charge" is just always on
    const chargeGain = text.match(/^On (?:Weakpoint Hit|Headshot):\\s*\\+([\\d.]+)% Incarnon charge$/i)
    if (chargeGain) {
      statements.push({ text: rawStatement, effect: { kind: 'chargeGain', value: percent(chargeGain[1]) }, mode: 'both', condition: null, maxStacks: 1 })
      continue
    }
    const costsAmmo = text.match(/^Multishot consumes ammo from Capacity(?: and increases Damage by \\+([\\d.]+)%)?$/i)
    if (costsAmmo) {
      statements.push({ text: rawStatement, effect: { kind: 'multishotCostsAmmo', damage: costsAmmo[1] ? percent(costsAmmo[1]) : 0 }, mode, condition: null, maxStacks: 1 })
      continue
    }

    // "On Non-Critical Hit: 50% chance to deal 2000% Damage" is a chance roll, not something you toggle
    const nonCrit = text.match(/^On Non-Critical Hit:\\s*(.+)$/)
    if (nonCrit) {
      statements.push({ text: rawStatement, effect: parsePerkBody(nonCrit[1], native), mode, condition: null, maxStacks: 1 })
      continue
    }

    // "When ...:" / "On ...:" starts a condition that sticks for the rest of the line
    const conditional = text.match(/^((?:When|On|While|With)\\b[^:]*):\\s*(.+)$/)
    if (conditional) {
      condition = conditional[1]
      text = conditional[2]
    }

    // "+10 Base Damage and +10% Fire Rate" -> two statements
    for (const part of text.split(/\\s+and\\s+(?=[+-]?\\d)/)) {
      statements.push({ text: rawStatement, effect: parsePerkBody(part.trim(), native), mode, condition, maxStacks: 1 })
    }
  }
  return statements
}

// tiers + perks for one weapon. VARIANT lines win over ALL lines, and if neither matches I fall back to
// the family's first variant so the picker still shows something
export function getIncarnonTiers(weaponName: string): IncarnonTier[] | null {
  const family = INCARNON_FAMILIES.find((candidate) => candidate.variants.includes(weaponName))
  if (!family) return null

  const rows = family.lines
    .trim()
    .split('\\n')
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length === 4)
    .map(([tier, name, variant, effects]) => ({ tier, name, variant, effects }))

  const tiers: IncarnonTier[] = []
  for (const tier of TIER_ORDER) {
    const perkNames = [...new Set(rows.filter((row) => row.tier === tier).map((row) => row.name))]
    if (!perkNames.length) continue
    const perks = perkNames.map((name) => {
      const candidates = rows.filter((row) => row.tier === tier && row.name === name)
      const row =
        candidates.find((candidate) => candidate.variant === weaponName) ??
        candidates.find((candidate) => candidate.variant === 'ALL') ??
        candidates[0]
      const statements = parsePerkLine(row.effects, Boolean(family.native))
      const conditionalStacks = statements.filter((statement) => statement.condition && statement.effect).map((statement) => statement.maxStacks)
      return { tier, name, statements, maxStacks: conditionalStacks.length ? Math.max(...conditionalStacks) : 0 }
    })
    tiers.push({ tier, perks })
  }
  return tiers
}

export interface SelectedPerk {
  perk: IncarnonPerk
  stacks: number // how many stacks of the conditional part are up (0 = off)
}

// how much of a perk's conditional part the usual fight assumes (the leaderboard, Compare, and a freshly picked perk in the
// calculator). same rules as mod conditionals (parseMod triggerUptime: max stacks, headshot hits off on body shots, kills
// off on the boss board), and on top of that the ones that need something the scenario doesn't have:
//  - another specific weapon equipped (Stalker's Vendetta / Resentment need Dread + Hate / Despair)
//  - a crowd or a position (enemies within 6 m, none within 5 m, impaling 5) or a hurt / fresh target (below half health,
//    undamaged, fewer than 3 statuses): the scenario is one full-health target with the build's own statuses on it
// status triggers ("On Puncture Status Effect", "On hitting Electricity-affected enemies") start at max like mods do, and the
// calc turns them back off when the build never applies that status (damage.ts statusTrigger). Prelude of Might's "When
// Critical Chance below 40%" is checked against the build's real crit chance there too
const NOT_IN_SCENARIO = /equipped(?!:)|Dread and|Hate and|within \\d+ ?m|impaling|below half Health|undamaged|Undamaged|fewer than \\d+ Status/i
export function perkConditionUptime(condition: string, context: TriggerContext): number {
  if (NOT_IN_SCENARIO.test(condition) && !/Melee Weapon equipped|No Primary equipped|equip from Primary/i.test(condition)) return 0
  return triggerUptime(condition, context)
}
export function scenarioPerkStacks(perk: IncarnonPerk, context: TriggerContext): number {
  if (!perk.maxStacks) return 0
  const uptimes = perk.statements.filter((statement) => statement.condition && statement.effect).map((statement) => perkConditionUptime(statement.condition!, context))
  return uptimes.length ? Math.floor(perk.maxStacks * Math.max(...uptimes)) : 0
}

// melee Incarnon form is a state, not a separate attack in the data, so mode tags don't filter melee
export const perkAppliesTo = (mode: PerkMode, isIncarnonAttack: boolean, isMelee: boolean) =>
  mode === 'both' || isMelee || (mode === 'incarnon') === isIncarnonAttack

// how a perk line stacks with mods, for the hover text (the game never says)
export function stackingNote(effect: PerkEffect | null): string | null {
  if (!effect) return null
  switch (effect.kind) {
    case 'base':
      return {
        damage: 'Added to the weapon\\'s base damage before mods, so Serration-type mods, elements and CO all multiply it.',
        critChance: 'Added to the base crit chance, so Point Strike-type mods multiply it (+20% base with +200% mods = +60%).',
        critMultiplier: 'Added to the base crit multiplier, so Vital Sense-type mods multiply it.',
        statusChance: 'Added to the base status chance, so status chance mods multiply it.',
        multishot: 'Added to the base multishot, so multishot mods multiply it.',
      }[effect.stat]
    case 'flat':
      return \`Flat \${effect.stat === 'critChance' ? 'crit' : 'status'} chance added after mods: mods don't multiply it, it just adds on at the end.\`
    case 'lastShot':
      return \`Only the last \${effect.burst ? 'burst' : 'shot'} of each magazine gets it, so over a magazine it's +\${effect.value} spread across every shot (more with a small magazine).\`
    case 'chargeGain':
      return \`Each weak point hit fills \${Math.round(effect.value * 100)}% more of the gauge, so the Incarnon form comes back in fewer normal-form hits.\`
    case 'multishotCostsAmmo':
      return 'Every extra projectile multishot adds uses a round, so a magazine lasts magazine / multishot trigger pulls.' +
        (effect.damage ? \` The extra projectiles get +\${Math.round(effect.damage * 100)}% damage, multiplying with Serration (Incarnon form: multishot bonuses are 60% bigger instead).\` : '')
    case 'baseSet':
      return \`Replaces the base \${effect.stat === 'critMultiplier' ? 'crit multiplier' : effect.stat === 'critChance' ? 'crit chance' : 'status chance'} (other base bonuses don't add on top), then mods multiply it.\`
    case 'mods':
      return 'Body shots never crit with it on. Weak point hits get the crit chance like Primary Acuity: in with crit mods, heads only.'
    case 'mod':
      return 'Works like one more mod line: it adds in with mods of the same stat (a +% Damage line adds to Serration, +% Multishot to Split Chamber).'
    case 'nonCritBonus':
      return \`Multiplicative: a non-crit hit that rolls it does x\${1 + effect.value} (the perk's "\${Math.round((1 + effect.value) * 100)}% damage") on top of everything else, \` +
        'base damage mods like Serration, elements, faction and CO included, it doesn\\'t add to Serration. ' +
        \`\${Math.round(effect.chance * 100)}% of non-crits roll it, and crits never do, so it fades out as crit chance goes up and does nothing at 100%+.\`
    case 'armorStripPerPuncture':
      return 'Multiplies the armor that\\'s left after Corrosive / Heat / other strips (it doesn\\'t add to them). 5 Puncture stacks max.'
    case 'convert':
      return \`Takes \${Math.round(effect.ratio * 100)}% of your \${effect.from === 'critChance' ? 'crit' : 'status'} chance after mods and adds it to the base \` +
        \`\${effect.stat === 'critChance' ? 'crit' : 'status'} chance (max \${Math.round(effect.max * 100)}%), so \${effect.stat === 'critChance' ? 'crit' : 'status'} mods then multiply it.\`
  }
}
`,ae=`// shots / time to kill vs a scaled enemy. this works off average damage (crits averaged in), so a lucky
// or unlucky string of crits will land on either side of it.
import type { CalcResult } from './damage'
import { timeToDeal } from './simulate'

export interface KillEstimate {
  shieldDamagePerShot: number
  healthDamagePerShot: number
  shotsToStripShields: number
  shotsToKill: number // Infinity if this build can't get through
  directTimeToKill: number // seconds, first shot at t = 0, reloads included
  sustainedTimeToKill: number // seconds, direct + DoT ticks as they land (ramp-up, Heat stacking and reloads included)
  oneShot: boolean
}

// I don't carry overflow damage from shields into health, so shots to kill is a little pessimistic
export function estimateKill(health: number, shield: number, vsHealth: CalcResult, vsShield: CalcResult): KillEstimate {
  // toxin skips shields, so while shields are up it still chips health
  const toxinPerShot = (vsHealth.damageTypes.find((row) => row.damageType === 'toxin')?.vsTarget ?? 0) * vsHealth.multishot
  const shieldDamagePerShot =
    vsShield.damageTypes.filter((row) => row.damageType !== 'toxin').reduce((total, row) => total + row.vsTarget, 0) * vsShield.multishot
  const healthDamagePerShot = vsHealth.averageShot

  let shotsToStripShields = 0
  let shotsToKill: number
  if (shield > 0 && shieldDamagePerShot <= 0) {
    shotsToKill = toxinPerShot > 0 ? Math.ceil(health / toxinPerShot) : Infinity
  } else {
    shotsToStripShields = shield > 0 ? Math.ceil(shield / shieldDamagePerShot) : 0
    const healthLeft = health - toxinPerShot * shotsToStripShields
    if (healthLeft <= 0) shotsToKill = Math.ceil(health / toxinPerShot)
    else shotsToKill = healthDamagePerShot > 0 ? shotsToStripShields + Math.ceil(healthLeft / healthDamagePerShot) : Infinity
  }

  const fireRate = vsHealth.fireRate
  // reloads: every full magazine adds a reload before the next shot
  const reloadsBefore = (shots: number) =>
    vsHealth.magazineSize && vsHealth.reloadTime ? Math.floor((shots - 1) / vsHealth.magazineSize) * vsHealth.reloadTime : 0
  const shieldDps = (shieldDamagePerShot * fireRate + vsShield.dotDps) * vsShield.uptime
  const sustainedTimeToKill =
    (shield > 0 ? (shieldDps > 0 ? shield / shieldDps : Infinity) : 0) + timeToDeal(vsHealth.shotModel, health)

  return {
    shieldDamagePerShot,
    healthDamagePerShot,
    shotsToStripShields,
    shotsToKill,
    directTimeToKill: Number.isFinite(shotsToKill) ? Math.max(0, shotsToKill - 1) / fireRate + reloadsBefore(shotsToKill) : Infinity,
    sustainedTimeToKill,
    oneShot: shotsToKill === 1,
  }
}
`,d=`// tags for the niche mechanics an attack has that the game doesn't spell out (beam multishot, multiplicative CO...).
// everything here comes from flags the calc already uses, so a tag means the calc is treating it that way
import { resolveCoBehavior } from './conditionOverload'
import type { Attack, Weapon } from '../types'

export interface MechanicTag {
  label: string
  explanation: string // hover text
  tone?: 'good' | 'bad' // multiplicative CO is a buff, no CO / no multishot mods is a loss
}

const pct = (fraction: number) => \`\${Math.round(fraction * 100)}%\`

export function mechanicTags(weapon: Weapon, attack: Attack): MechanicTag[] {
  const tags: MechanicTag[] = []
  const isMelee = weapon.category === 'Melee'
  const isIncarnon = /incarnon/i.test(attack.name)

  // Vinquibus: a rifle and a bayonet in one, each half modded on its own (the melee half is its own entry here)
  if (/^Vinquibus/.test(weapon.name)) {
    tags.push({
      label: isMelee ? 'Bayonet half' : 'Rifle half',
      explanation:
        'Vinquibus sits in both the primary and the melee slot at once, with a separate mod setup and riven for each half (polarities are shared). ' +
        \`Here the halves are two entries: "Vinquibus" for the rifle and "Vinquibus (Melee)" for the bayonet. This is the \${isMelee ? 'bayonet' : 'rifle'}.\`,
    })
  }

  if (attack.continuous) {
    tags.push({
      label: 'Beam',
      explanation:
        'Continuous weapon. Multishot doesn\\'t add separate hits here: the extra beams on one enemy merge into a single damage tick ' +
        'worth all of them, with their status chance added together (wiki Multishot: "additional beams that hit the same target ' +
        'instead merge into a singular damage tick"). So one tick shows the full multishot damage.\\n\\n' +
        'Damaging statuses (Slash, Heat, Toxin, Electricity, Blast, Gas) get multishot twice on beams, once from the bigger tick and once ' +
        'from the extra procs, which is why Heat beams scale so hard with multishot. Forced procs still land once per tick.\\n\\n' +
        'Not modeled: damage ramps from 20% to 100% over 0.6 s of firing (wiki, Catabolyst page).',
    })
  }

  const co = resolveCoBehavior(weapon, attack)
  if (co.mode === 'multiply') {
    tags.push({
      label: 'Multiplicative CO',
      tone: 'good',
      explanation:
        'Condition Overload / Galvanized / Secondary Shiver multiply on this attack instead of adding to the base damage mods: ' +
        'base x (1 + Serration etc.) x (1 + CO) instead of base x (1 + Serration etc. + CO). With a big damage mod stack that\\'s ' +
        \`a lot more damage per status type on the enemy (wiki Condition Overload (Mechanic), \${co.source === 'sheet' ? 'GunCO sheet' : 'wiki table'}). \` +
        'The game doesn\\'t mean it to work this way, so it can get fixed.' + (co.note ? \`\\n\\n\${co.note}\` : ''),
    })
  } else if (co.mode === 'none') {
    tags.push({ label: 'No CO', tone: 'bad', explanation: \`Condition Overload / Galvanized bonuses don't apply to this attack. \${co.note ?? ''}\`.trim() })
  } else if (co.note) {
    tags.push({ label: co.scale !== 1 ? \`CO at \${pct(co.scale)}\` : 'CO: direct hit only', explanation: co.note })
  } else if (co.scale !== 1) {
    tags.push({ label: \`CO at \${pct(co.scale)}\`, explanation: \`Condition Overload / Galvanized scale off \${pct(co.scale)} of this attack's damage.\` })
  }

  if (attack.noMultishotMods && !attack.continuous && !isMelee) {
    tags.push({
      label: 'Ignores multishot mods',
      tone: 'bad',
      explanation:
        'Multishot mods and arcanes do nothing on this attack. It keeps its innate multishot: hitscan explosions (one per hit), ' +
        'beam blasts, speargun throws and some Incarnon forms work this way (GunCO sheet: "no MS, but gets CO").',
    })
  }

  if (isIncarnon && !isMelee && weapon.multishot > 1) {
    tags.push({
      label: 'Single projectile',
      explanation: \`The Incarnon form fires one projectile, the normal form's \${weapon.multishot} pellets don't carry over. Multishot mods still add more.\`,
    })
  }

  if (attack.baseDamagePool) {
    tags.push({
      label: 'Part of one shot',
      explanation:
        \`This attack is one part of a shot worth \${attack.baseDamagePool} base damage in total. "+N Base Damage" Incarnon perks grow every part \` +
        \`by (\${attack.baseDamagePool} + N) / \${attack.baseDamagePool}, they don't add N to each part.\`,
    })
  }

  if (attack.forcedProcs?.length) {
    tags.push({
      label: \`Forced \${attack.forcedProcs.join(' + ')}\`,
      explanation: \`Every hit forces \${attack.forcedProcs.join(' and ')} proc\${attack.forcedProcs.length > 1 ? 's' : ''} on top of its normal status rolls.\`,
    })
  }

  if (attack.hitscanAoE && co.mode !== 'none' && !co.note) {
    tags.push({ label: 'Hitscan explosion', explanation: 'The explosion of a hitscan shot: only the enemy the shot hit directly gets CO, the rest of the radius doesn\\'t.' })
  }

  return tags
}
`,f=`// which mods can't be equipped together. the export has no incompatibility field, so it's three checks:
//  1. same name (the game doesn't allow duplicates)
//  2. same internal mod: Primed / Galvanized / Spectral copies reuse the base mod's path with a suffix
//     (Hell's Chamber = .../Shotgun/WeaponFireIterationsMod, Galvanized Hell = .../Shotgun/WeaponFireIterationsSPMod)
//  3. INCOMPATIBLE_GROUPS: the "Incompatible Mods" infobox on each mod's wiki page, for pairs the paths don't reveal
import type { Mod } from '../types'

// each group is mutually exclusive. from wiki.warframe.com infoboxes ("Flawed" versions left out, they're not in the data)
export const INCOMPATIBLE_GROUPS: string[][] = [
  ['Serration', 'Spectral Serration', 'Amalgam Serration', 'Higasa Serration'],
  ['Split Chamber', 'Galvanized Chamber', 'Split Flights'],
  ["Hell's Chamber", 'Galvanized Hell'],
  ['Barrel Diffusion', 'Galvanized Diffusion', 'Amalgam Barrel Diffusion'],
  ['Sure Shot', 'Galvanized Shot'],
  ['Rifle Aptitude', 'Galvanized Aptitude'],
  ['Shotgun Savvy', 'Galvanized Savvy'],
  ['Melee Elementalist', 'Galvanized Elementalist'],
  ['True Steel', 'Sacrificial Steel', 'Galvanized Steel', 'Amalgam Ripkas True Steel'],
  ['Reflex Coil', 'Galvanized Reflex'],
  ['Argon Scope', 'Galvanized Scope'],
  ['Hydraulic Crosshairs', 'Galvanized Crosshairs'],
  ['Fatal Acceleration', 'Galvanized Acceleration'],
  ['Pressure Point', 'Primed Pressure Point', 'Sacrificial Pressure', 'Amanata Pressure'],
  ['Fury', 'Primed Fury', 'Berserker Fury'],
  // corrupted crit mods vs their normal version
  ['Point Strike', 'Critical Delay'],
  ['Pistol Gambit', 'Primed Pistol Gambit', 'Creeping Bullseye'],
  ['Blunderbuss', 'Primed Blunderbuss', 'Critical Deceleration'],
  // Amalgam mods vs the mod they're built from
  ['Organ Shatter', 'Amalgam Organ Shatter'],
  ['Shotgun Barrage', 'Amalgam Shotgun Barrage'],
  ['Magazine Warp', 'Primed Magazine Warp', 'Amalgam Javlok Magazine Warp'],
  ['Body Count', 'Amalgam Furax Body Count'],
  ['Metal Auger', 'Amalgam Argonak Metal Auger'],
]

const groupsByName = new Map<string, number[]>()
INCOMPATIBLE_GROUPS.forEach((group, index) => {
  for (const name of group) groupsByName.set(name, [...(groupsByName.get(name) ?? []), index])
})

// ".../Rifle/WeaponFireIterationsSPMod" -> "Primary Mod|WeaponFireIterationsMod". the type keeps rifle/pistol
// mods that share a path name apart (they never go on the same weapon anyway)
const internalKey = (mod: Mod) => {
  const last = mod.uniqueName.split('/').at(-1) ?? ''
  const base = last.replace(/Expert$/, '').replace(/Beginner$/, '').replace(/(SP|Invisible)Mod$/, 'Mod')
  return \`\${mod.type}|\${base}\`
}

export type ConflictReason = 'same mod' | 'variant' | 'wiki'

export function modConflict(a: Mod, b: Mod): ConflictReason | null {
  if (a.uniqueName === b.uniqueName || a.name === b.name) return 'same mod'
  if (internalKey(a) === internalKey(b)) return 'variant'
  // "Primed X" vs "X" when the paths differ (Primed Shred, Primed Target Cracker, Primed Banes...)
  if (a.name === \`Primed \${b.name}\` || b.name === \`Primed \${a.name}\`) return 'variant'
  const groupsA = groupsByName.get(a.name)
  if (groupsA && groupsByName.get(b.name)?.some((index) => groupsA.includes(index))) return 'wiki'
  return null
}

// remembered per pair: the optimizer asks the same pairs millions of times and the check runs regexes on the paths
const conflictMemo = new WeakMap<Mod, WeakMap<Mod, boolean>>()
export const modsConflict = (a: Mod, b: Mod) => {
  let row = conflictMemo.get(a)
  if (!row) conflictMemo.set(a, (row = new WeakMap()))
  let known = row.get(b)
  if (known === undefined) {
    known = modConflict(a, b) !== null
    row.set(b, known)
  }
  return known
}

// the first equipped mod that blocks \`candidate\`, for the "incompatible with X" label
export const blockingMod = (candidate: Mod, equipped: Mod[]) => equipped.find((mod) => modsConflict(candidate, mod)) ?? null
`,p=`// mod set bonuses. sets count every equipped piece across the Warframe and the weapon being calculated (companion and other
// weapons aren't modeled), the set text per piece count comes from the export (src/data/modSets.json).
// what does something here:
//  - Umbra / Sacrificial: "Enhance mods in this set". Umbral Fiber/Vitality +30% / +80% of their values with 2 / 3 pieces,
//    Umbral Intensify only +25% / +75% (Umbral Fiber wiki), Sacrificial +25% of all stats with both (Sacrificial Steel wiki)
//  - Gladiator: +10% melee crit chance per combo multiplier per piece (already in the combo math)
//  - Vigilante: 5% per piece "chance to enhance Critical Hits from Primary Weapons", read as +1 crit tier
//  - Nira's: +150% slam damage per piece, "additive to" Seismic Wave (Nira's Set wiki), melee slams only
// the rest (Augur shields, Boreal airborne DR, companion sets...) are listed but not in the numbers
import modSetsJson from '../data/modSets.json'
import type { Mod } from '../types'

export interface ModSetInfo {
  name: string
  pieces: number
  stats: string[] // text with 1, 2, ... pieces
  members: string[]
}
export const MOD_SETS = modSetsJson as Record<string, ModSetInfo>

export type SetPieces = Record<string, number>

export const countSets = (mods: Pick<Mod, 'modSet'>[]): SetPieces => {
  const pieces: SetPieces = {}
  for (const mod of mods) if (mod.modSet) pieces[mod.modSet] = (pieces[mod.modSet] ?? 0) + 1
  return pieces
}
export const addPieces = (a: SetPieces, b: SetPieces | undefined): SetPieces => {
  const total = { ...a }
  for (const [set, count] of Object.entries(b ?? {})) total[set] = (total[set] ?? 0) + count
  return total
}

// how much a set-member mod's own stats are multiplied by ("Enhance mods in this set")
export function setEnhancement(mod: Pick<Mod, 'name' | 'modSet'>, pieces: SetPieces) {
  const count = mod.modSet ? Math.min(pieces[mod.modSet] ?? 0, MOD_SETS[mod.modSet]?.pieces ?? 0) : 0
  if (mod.modSet === 'Umbra') {
    const steps = mod.name === 'Umbral Intensify' ? [1, 1, 1.25, 1.75] : [1, 1, 1.3, 1.8]
    return steps[count] ?? 1
  }
  if (mod.modSet === 'Sacrifice') return count >= 2 ? 1.25 : 1
  return 1
}

export const VIGILANTE_ENHANCE_PER_PIECE = 0.05
export const NIRA_SLAM_PER_PIECE = 1.5

// one line per set with at least one piece: "Umbral 3/3: Enhance mods in this set."
export const setSummary = (pieces: SetPieces) =>
  Object.entries(pieces)
    .filter(([set, count]) => count > 0 && MOD_SETS[set])
    .map(([set, count]) => {
      const info = MOD_SETS[set]
      const capped = Math.min(count, info.pieces)
      return { set, name: info.name, count: capped, pieces: info.pieces, text: info.stats[capped - 1] ?? '' }
    })
`,m=`// which of two mods that do the same wins: the one without a catch. Serration over Heavy Caliber (same +165%, but
// -55% accuracy), Vital Sense over Bladed Rounds (same +120% crit damage, but only after kills while aiming). the calc
// counts conditionals at full stacks, so on paper they tie and list order would decide
import { nicheNote } from './nicheMods'
import { parseUpgrade } from './parseMod'
import type { Mod } from '../types'

const cache = new WeakMap<Mod, number>()
// 0 = always on, 1 = needs a condition (on kill, on headshot...), 2 = Niche tag (accuracy, reload-only...)
export function modCatch(mod: Mod): number {
  const cached = cache.get(mod)
  if (cached !== undefined) return cached
  const value = nicheNote(mod.levelStats, mod.fusionLimit) ? 2 : parseUpgrade(mod.levelStats, mod.fusionLimit).conditionals.length ? 1 : 0
  cache.set(mod, value)
  return value
}
`,h=`// mods the calc models at full strength that are hard to keep fully on in a real fight. I don't change their numbers
// (that's a judgement call per weapon), they just get a "Niche" tag with the catch on hover
const SPAM_TIP = 'The calc counts it the whole time.'

export function nicheNote(levelStats: string[][], rank = levelStats.length - 1): string | null {
  const text = (levelStats[rank] ?? levelStats[levelStats.length - 1] ?? []).join(' ').replace(/\\\\n/g, ' ')
  // Heavy Caliber, Magnum Force, Vicious Spread, Split Flights
  const accuracy = text.match(/-(\\d+)% Accuracy/)
  if (accuracy && Number(accuracy[1]) >= 50) {
    return \`-\${accuracy[1]}% Accuracy. The calc assumes every pellet hits, so it's fine up close or on weapons with no spread (snipers, beams, \` +
      'AoE), but on an automatic at range a lot of shots will miss and the damage shown won\\'t be real.'
  }
  // Spring-Loaded Chamber, Pressurized Magazine, Repeater Clip: "On Reload: +X% Fire Rate when Aiming for 9s"
  if (/On Reload:/.test(text) && /when Aiming/i.test(text)) {
    return 'Only on after a reload, only while aiming, and only for a few seconds. So the first magazine after you swap in is ' +
      \`without it, and hip fire never gets it. \${SPAM_TIP}\`
  }
  // Clip Delegation: the next magazine's bonus depends on the hits of the last one
  if (/On Reload:/.test(text)) return \`Builds up over one magazine and pays off on the next, so it's off for the first magazine. \${SPAM_TIP}\`
  return null
}
`,g=`import { DAMAGE_TYPES } from './constants'
import { specialLine, type SpecialLine } from './specialLines'

export type StatKey =
  | 'damage'
  | 'damagePerStatusType' // Condition Overload, Galvanized Aptitude/Savvy/Shot
  | 'damagePerColdStack' // Secondary Shiver
  | 'critChance'
  | 'weakpointCritChance' // only on headshots: Primary Acuity, Cascadia Accuracy
  | 'critDamage'
  | 'multishot'
  | 'fireRate'
  | 'statusChance'
  | 'statusDamage'
  | 'headshotMultiplier'
  | 'weakpointDamage' // Primary/Secondary Acuity, added to the weak point multiplier (x1.5 on heads)
  | 'magazineCapacity'
  | 'reloadSpeed'
  | 'ammoEfficiency' // riven splice stat: share of shots that don't use ammo, so a magazine lasts longer
  | 'critChancePerCombo' // Blood Rush, x (combo multiplier - 1)
  | 'statusChancePerCombo' // Weeping Wounds, x (combo multiplier - 1)
  | 'heavyCritChance' // crit chance that only counts on heavy attacks (Melee Animosity, the 2nd half of "x2 for Heavy Attacks")
  | 'heavyDamage' // Killing Blow: "+120% Melee Damage on Heavy Attack"
  | 'heavyWindUpSpeed'
  | 'heavyEfficiency' // how much combo a heavy attack keeps
  | 'statusDuration' // longer DoTs = more ticks
  | 'slamDamage' // Seismic Wave, its own multiplier on slams ("multiplicative to base damage")
  | 'throwDamage' // Power Throw, its own multiplier on glaive throws ("multiplicative to ... Pressure Point")
  | 'finisherDamage' // Finishing Touch, Covert Lethality: their own multiplier on finisher attacks (Blade Storm)

export type ModEffect =
  | { kind: 'stat'; stat: StatKey; value: number }
  | { kind: 'damageType'; damageType: string; value: number }
  | { kind: 'faction'; faction: string; value: number } // value is the bonus part, x1.3 -> 0.3
  | { kind: 'slashOnCrit'; value: number } // Hunter Munitions
  | { kind: 'slashOnImpact'; value: number } // Internal Bleeding
  | { kind: 'overguardMultiplier'; value: number } // Secondary Fortifier
  | { kind: 'damageMultiplier'; value: number } // separate multiplier, e.g. Longbow Sharpshot's next shot bonus
  | { kind: 'lockMultishot' } // Primary/Pistol Acuity: multishot mods stop working
  | { kind: 'heavyScaledCritChance'; value: number; heavyFactor: number } // "(x2 for Heavy Attacks)"
  | { kind: 'duplicateOnCrit'; value: number } // Melee Duplicate: crits strike a second time
  | { kind: 'frameStat'; stat: FrameStat; value: number } // Warframe stats (mods and Warframe arcanes), see warframeStats.ts
  | { kind: 'flatStat'; stat: 'critChance' | 'statusChance'; value: number } // "+20 Final Status Chance", added after mods
  | { kind: 'critPerHit'; value: number; resetsAfter: number } // Secondary Enervate: flat crit per hit, gone after N big crits
  | { kind: 'forcedProcChance'; damageType: string; value: number } // extra proc chance on every hit, outside the damage split
  | { kind: 'napalm'; fraction: number; seconds: number; procChance: number } // Nightwatch Napalm: a burning patch per rocket, see damage.ts
  | { kind: 'critPerPunctureStatus'; value: number } // Melee Doughty: +Nx crit multiplier per 10% Puncture status chance, see damage.ts
  | { kind: 'damagePerMagazine'; coefficient: number } // Primary Plated Round: +coefficient x sqrt(5 x magazine) damage, see damage.ts
  | { kind: 'flatPerProc'; value: number } // Cascadia Empowered: a separate flat hit per status proc, see damage.ts
  | { kind: 'bodyShotMultiplier'; value: number } // Meticulous Aim: "-45% Bodyshot Damage", see damage.ts
  | { kind: 'noBodyCrit' } // King's Gambit (Sicarus Incarnon): "Bodyshots can't crit"

// armor/health are flat ("+900 Armor"), the *Percent ones % of base, damageResistance is one multiplicative DR source
export type FrameStat = 'armor' | 'armorPercent' | 'health' | 'healthPercent' | 'shieldPercent' | 'energyPercent' | 'strength' | 'duration' | 'range' | 'efficiency'
  | 'sprintSpeed' | 'castingSpeed' | 'parkourVelocity' | 'shieldRecharge' | 'damageResistance'

// Warframe arcanes that buff one weapon type ("+180% Melee Damage to Melee Weapons", "+120% Fire Rate to Pistols")
export type WeaponScope = 'melee' | 'primary' | 'primaryNoShotgun' | 'secondary' | 'shotgun' | 'sniper' | 'guns'

export interface ConditionalEffect {
  trigger: string // "On Kill:", "On Toxin Status Effect:", "While Overshields Active:" ...
  effect: ModEffect
  maxStacks: number
  scope?: WeaponScope // only on that weapon type (Warframe arcanes)
}

// the scope phrases Warframe arcanes use, checked on the raw text before it gets cleaned
const SCOPES: [RegExp, WeaponScope][] = [
  [/ to Primary Weapons \\(Excludes Shotguns\\)/i, 'primaryNoShotgun'],
  [/ to Primary and Secondary weapons/i, 'guns'],
  [/ to Primary Weapons| Primary Weapon(?= Damage)/i, 'primary'],
  [/ to Melee Weapons/i, 'melee'],
  [/ to Pistols| on Secondary Weapon/i, 'secondary'],
  [/ to Shotguns/i, 'shotgun'],
  [/ to Sniper Rifles/i, 'sniper'],
]
export function scopeApplies(scope: WeaponScope | undefined, weapon: { category: string; type: string }) {
  switch (scope) {
    case undefined: return true
    case 'melee': return weapon.category === 'Melee'
    case 'primary': return weapon.category === 'Primary'
    case 'primaryNoShotgun': return weapon.category === 'Primary' && weapon.type !== 'Shotgun'
    case 'secondary': return weapon.category === 'Secondary'
    case 'shotgun': return weapon.type === 'Shotgun'
    case 'sniper': return weapon.type === 'Sniper'
    case 'guns': return weapon.category !== 'Melee'
  }
}

const FRAME_STAT_PATTERNS: [RegExp, FrameStat][] = [
  [/^\\+([\\d,.]+) Armor$/, 'armor'],
  [/^([+-][\\d.]+)% Armor$/, 'armorPercent'],
  [/^\\+([\\d,.]+) Max Health$/, 'health'],
  [/^([+-][\\d.]+)% Health$/, 'healthPercent'],
  [/^([+-][\\d.]+)% Shield Capacity$/, 'shieldPercent'],
  [/^([+-][\\d.]+)% Energy Max$/, 'energyPercent'], // Flow, Primed Flow, Archon Flow
  [/^([+-][\\d.]+)% Ability Strength$/, 'strength'],
  [/^([+-][\\d.]+)% Ability Duration$/, 'duration'],
  // the rest don't touch weapon damage, they're for the panel's stat block (Stretch, Streamline, Rush, Natural Talent...)
  [/^([+-][\\d.]+)% Ability Range$/, 'range'],
  [/^([+-][\\d.]+)% Ability Efficiency$/, 'efficiency'],
  [/^([+-][\\d.]+)% Sprint Speed$/, 'sprintSpeed'],
  [/^([+-][\\d.]+)% Casting Speed$/, 'castingSpeed'],
  [/^([+-][\\d.]+)% (?:to )?Parkour Velocity$/, 'parkourVelocity'],
  [/^([+-][\\d.]+)% Shield Recharge$/, 'shieldRecharge'],
  // Adaptation is per damage type, against one kind of enemy that's all of it
  [/^([+-][\\d.]+)% (?:[Dd]amage [Rr]esistance|Resistance to that Damage Type)$/, 'damageResistance'],
]

export interface ParsedUpgrade {
  effects: ModEffect[]
  conditionals: ConditionalEffect[]
  unparsed: string[] // lines I don't model yet, shown in the UI so nothing fails silently
}

const percent = (text: string) => Number(text) / 100

// anchored on purpose so stuff like "+40% Critical Chance stacks with Combo Multiplier" doesn't match
const STAT_PATTERNS: [RegExp, StatKey][] = [
  [/^([+-][\\d.]+)% (?:Melee |Direct )?Damage (?:per|for each) Status Type affecting (?:the )?target$/i, 'damagePerStatusType'],
  [/^([+-][\\d.]+)% (?:Melee )?[Dd]amage$/, 'damage'],
  [/^Enemies take ([+-][\\d.]+)% damage per Cold Status$/i, 'damagePerColdStack'],
  [/^([+-][\\d.]+)% (?:Weak Point Critical Chance|Critical Chance on Weakpoint Hits)\\b/, 'weakpointCritChance'],
  [/^([+-][\\d.]+)% Critical Chance$/, 'critChance'],
  [/^([+-][\\d.]+)% Critical Chance stacks with Combo Multiplier$/, 'critChancePerCombo'],
  [/^([+-][\\d.]+)% Status Chance per Combo Multiplier$/, 'statusChancePerCombo'],
  [/^([+-][\\d.]+)% Critical Chance on (?:your )?next Heavy Attack\\b/, 'heavyCritChance'],
  [/^([+-][\\d.]+)% (?:Melee )?Damage on Heavy Attacks?\\b/, 'heavyDamage'],
  [/^([+-][\\d.]+)% Heavy Attack Wind Up Speed$/, 'heavyWindUpSpeed'],
  [/^([+-][\\d.]+)% Heavy Attack Efficiency$/, 'heavyEfficiency'],
  [/^([+-][\\d.]+)% Status Duration$/, 'statusDuration'],
  [/^([+-][\\d.]+)% Slam Attack Damage$/, 'slamDamage'],
  [/^([+-][\\d.]+)% Throw Damage$/, 'throwDamage'],
  [/^([+-][\\d.]+)% Finisher Damage$/, 'finisherDamage'],
  [/^([+-][\\d.]+)% Critical Damage$/, 'critDamage'],
  [/^([+-][\\d.]+)% Multishot$/, 'multishot'],
  [/^([+-][\\d.]+)% (?:Fire Rate|Attack Speed)(?: \\(x[\\d.]+ for Bows\\))?$/, 'fireRate'],
  [/^([+-][\\d.]+)% Status Chance$/, 'statusChance'],
  [/^([+-][\\d.]+)% Status Damage$/, 'statusDamage'],
  [/^([+-][\\d.]+)% (?:to Headshot Multiplier|Headshot Damage)$/, 'headshotMultiplier'],
  [/^([+-][\\d.]+)% Weak Point Damage$/, 'weakpointDamage'],
  [/^([+-][\\d.]+)% Magazine Capacity$/, 'magazineCapacity'],
  [/^([+-][\\d.]+)% Reload Speed$/, 'reloadSpeed'],
  [/^([+-][\\d.]+)% Ammo Efficiency$/, 'ammoEfficiency'],
]

export function parseStatLine(line: string): ModEffect | null {
  // True Steel family: "+120% Critical Chance (x2 for Heavy Attacks)". per the Galvanized Steel hotfix, heavies get
  // the doubled value instead of the normal one (+240% total, not +360%)
  const heavyScaled = line.match(/^([+-][\\d.]+)% Critical Chance \\(x([\\d.]+) for Heavy Attacks\\)$/)
  if (heavyScaled) return { kind: 'heavyScaledCritChance', value: percent(heavyScaled[1]), heavyFactor: Number(heavyScaled[2]) }

  for (const [pattern, stat] of STAT_PATTERNS) {
    const match = line.match(pattern)
    if (match) return { kind: 'stat', stat, value: percent(match[1]) }
  }

  // "+90% Heat", also "+60% Corrosive Damage" (Melee Exposure)
  const damageTypeMatch = line.match(/^([+-][\\d.]+)% (\\w+)(?: Damage)?$/)
  if (damageTypeMatch && DAMAGE_TYPES.includes(damageTypeMatch[2].toLowerCase())) {
    return { kind: 'damageType', damageType: damageTypeMatch[2].toLowerCase(), value: percent(damageTypeMatch[1]) }
  }

  const factionMatch = line.match(/^x([\\d.]+) Damage to (?:the )?(\\w+)$/)
  if (factionMatch) return { kind: 'faction', faction: factionMatch[2], value: Number(factionMatch[1]) - 1 }

  const slashOnCritMatch = line.match(/^\\+?([\\d.]+)% chance to apply Slash on Critical$/)
  if (slashOnCritMatch) return { kind: 'slashOnCrit', value: percent(slashOnCritMatch[1]) }

  const slashOnImpactMatch = line.match(/^Impact Status Effects have ([\\d.]+)% chance to apply a Slash Status Effect/)
  if (slashOnImpactMatch) return { kind: 'slashOnImpact', value: percent(slashOnImpactMatch[1]) }

  const duplicateMatch = line.match(/^\\+?([\\d.]+)% chance for your attack to strike a second time$/)
  if (duplicateMatch) return { kind: 'duplicateOnCrit', value: percent(duplicateMatch[1]) }

  for (const [pattern, stat] of FRAME_STAT_PATTERNS) {
    const match = line.match(pattern)
    if (match) {
      const number = Number(match[1].replace(/,/g, ''))
      return { kind: 'frameStat', stat, value: stat === 'armor' || stat === 'health' ? number : number / 100 }
    }
  }

  const overguardMatch = line.match(/^Deals x([\\d.]+) Extra Damage to Overguard\\.?$/)
  if (overguardMatch) return { kind: 'overguardMultiplier', value: Number(overguardMatch[1]) }

  return null
}

// strips the duration/stack tails and filler words so the stat part parses like a normal mod line
const cleanConditionalBody = (body: string) => {
  const cleaned = body
    .replace(/^Gain\\s+/i, '')
    .replace(/\\s+when Aiming.*$/, '')
    .replace(/\\s+on (?:your )?next shot\\.?$/i, '')
    .replace(/\\s+on Melee strikes/i, '')
    .replace(/\\s+for [\\d.]+s\\.?.*$/, '')
    .replace(/\\.?\\s*Stacks up to .*$/i, '') // Molt Augmented / Arcane Blessing: "+24 Max Health. Stacks up to 50x."
    .replace(/^[\\d.]+% chance (?:for|to) (?=[+-]?\\d)/i, '') // Warframe arcanes: "21% chance for +45% Critical Chance", the stack toggle is the proc
    .replace(/\\.$/, '')
    .trim()
  return /^\\d/.test(cleaned) ? \`+\${cleaned}\` : cleaned // "60% Corrosive" -> "+60% Corrosive"
}

// parsing is regex-heavy and the optimizer calls the calc millions of times, so results are cached
// per levelStats array (each mod/arcane has its own) and rank
const parseCache = new WeakMap<string[][], Map<number, ParsedUpgrade>>()

export function parseUpgrade(levelStats: string[][], rank: number): ParsedUpgrade {
  let byRank = parseCache.get(levelStats)
  if (!byRank) parseCache.set(levelStats, (byRank = new Map()))
  let parsed = byRank.get(rank)
  if (!parsed) byRank.set(rank, (parsed = parseUpgradeUncached(levelStats, rank)))
  return parsed
}

// works for mods and arcanes, both use the same levelStats text format
function parseUpgradeUncached(levelStats: string[][], rank: number): ParsedUpgrade {
  const parsed: ParsedUpgrade = { effects: [], conditionals: [], unparsed: [] }
  const lines = levelStats[Math.min(Math.max(rank, 0), levelStats.length - 1)] ?? []
  // arcanes repeat their passive lines: once inside the full description and once on their own.
  // the export uses a literal backslash-n between segments, not a real newline
  const splitSegments = (line: string) => line.split(/\\\\n|\\n/).map((segment) => segment.trim()).filter(Boolean)
  const standaloneLines = new Set(lines.filter((line) => splitSegments(line).length === 1).map((line) => line.trim()))

  const addSpecial = (special: SpecialLine, fallbackTrigger: string | null) => {
    if ('ignore' in special) return
    const trigger = special.trigger ?? fallbackTrigger
    for (const effect of special.effects) {
      if (trigger) parsed.conditionals.push({ trigger, effect, maxStacks: special.maxStacks ?? 1 })
      else parsed.effects.push(effect)
    }
  }
  const addConditional = (trigger: string, rawBody: string) => {
    // whole bodies the normal patterns can't read (Clip Delegation, Biotic Rounds...), src/calc/specialLines.ts
    const special = specialLine(rawBody) ?? specialLine(cleanConditionalBody(rawBody))
    if (special && !('ignore' in special)) return addSpecial(special, trigger)
    // "+180% Melee Damage to Melee Weapons" -> melee only, and the phrase goes so the stat parses
    const scopeMatch = SCOPES.find(([pattern]) => pattern.test(rawBody))
    // Arcane Blade Charger just says "+300% Melee Damage"
    const scope = scopeMatch?.[1] ?? (/\\bMelee Damage\\b/.test(rawBody) ? 'melee' : undefined)
    const body = scopeMatch ? rawBody.replace(scopeMatch[0], '') : rawBody
    // "Stacks up to 3x", or Power Throw's "On Consecutive throw (Max stacks 3):"
    const stackCount = body.match(/Stacks up to (\\d+)x/) ?? trigger.match(/Max stacks (\\d+)/i)
    // Cascadia Flare: "+12% ... Stacks up to 480%", Melee Animosity: "42% Critical Chance on your next Heavy Attack, up to 420%"
    const stackPercentCap = body.match(/(?:Stacks|,) up to ([\\d.]+)%/)
    const parts = cleanConditionalBody(body).split(/\\s+and\\s+(?=[+-]?\\d)/)
    for (const part of parts) {
      if (!part) continue
      const effect = parseStatLine(/^\\d/.test(part) ? \`+\${part}\` : part)
      if (!effect) {
        // utility parts ("+6% Ammo Efficiency") are dropped, odd damage ones get their rule
        const partSpecial = specialLine(part)
        if (partSpecial) addSpecial(partSpecial, trigger)
        else parsed.unparsed.push(\`\${trigger} \${part}\`)
        continue
      }
      // "next shot" bonuses (Longbow Sharpshot) are their own multiplier, the CO wiki page lists them
      // with range falloff as multipliers that additive CO ignores
      if (/next shot/i.test(body) && effect.kind === 'stat' && effect.stat === 'damage') {
        parsed.conditionals.push({ trigger, effect: { kind: 'damageMultiplier', value: effect.value }, maxStacks: 1 })
        continue
      }
      let maxStacks = stackCount ? Number(stackCount[1]) : 1
      if (stackPercentCap && 'value' in effect && effect.value > 0) {
        maxStacks = Math.round(percent(stackPercentCap[1]) / effect.value)
      }
      parsed.conditionals.push({ trigger, effect, maxStacks, ...(scope ? { scope } : {}) })
    }
  }

  for (const line of lines) {
    const segments = splitSegments(line)
    let trigger: string | null = null

    for (const segment of segments) {
      if (segments.length > 1 && standaloneLines.has(segment)) continue // it gets parsed on its own line
      if (/^\\+1 Arcane Revive$/.test(segment)) continue
      // Arcane Double Back: "Gain +25% damage resistance for 4s per Dodge, Double Jump and Bullet Jump. Stacks up to 3x."
      const movementDr = segment.match(/^Gain \\+?([\\d.]+)% damage resistance for [\\d.]+s per (.+?)\\. Stacks up to (\\d+)x/i)
      if (movementDr) {
        parsed.conditionals.push({
          trigger: \`Per \${movementDr[2]}:\`, effect: { kind: 'frameStat', stat: 'damageResistance', value: percent(movementDr[1]) }, maxStacks: Number(movementDr[3]),
        })
        continue
      }
      if (segment.endsWith(':')) {
        trigger = segment
        continue
      }
      const inlineTrigger = segment.match(/^((?:On|While|After) [^:]+):\\s*(.+)$/)
      if (inlineTrigger) {
        addConditional(\`\${inlineTrigger[1]}:\`, inlineTrigger[2])
        continue
      }
      if (trigger) {
        addConditional(trigger, segment)
        continue
      }
      // Primary Bulwark: "Gain +1% damage for each unit of armor past 1,000, up to a max of +500%". one stack = one armor
      // point past the threshold, so the stepper reads as "armor over 1,000"
      const armorScaling = segment.match(/^Gain \\+?([\\d.]+)% damage for each unit of armor past ([\\d,]+), up to a max of \\+?([\\d.]+)%/i)
      if (armorScaling) {
        const perArmor = percent(armorScaling[1])
        parsed.conditionals.push({
          trigger: \`Warframe armor past \${armorScaling[2]} (1 stack = 1 armor):\`,
          effect: { kind: 'stat', stat: 'damage', value: perArmor },
          maxStacks: Math.round(percent(armorScaling[3]) / perArmor),
        })
        continue
      }
      const effect = parseStatLine(segment)
      const special = effect ? null : specialLine(segment)
      if (effect) parsed.effects.push(effect)
      else if (special) addSpecial(special, null)
      else parsed.unparsed.push(segment)
      // Acuity tacks its drawback onto the crit line: "+350% Weak Point Critical Chance. Multishot cannot be modified."
      if (/Multishot cannot be modified/i.test(segment)) parsed.effects.push({ kind: 'lockMultishot' })
    }
  }
  return parsed
}

export const maxConditionalStacks = (levelStats: string[][], rank: number, includeTrigger: (trigger: string) => boolean = () => true) =>
  Math.max(
    0,
    ...parseUpgrade(levelStats, rank)
      .conditionals.filter((conditional) => includeTrigger(conditional.trigger))
      .map((conditional) => conditional.maxStacks),
  )

// fire rate / attack speed mods (positive only, so Critical Delay's -fire rate doesn't count), for the "FR" tag and the
// leaderboard's "no fire rate mods" rankings
export const raisesFireRate = (levelStats: string[][], rank = levelStats.length - 1) => {
  const parsed = parseUpgrade(levelStats, rank)
  return [...parsed.effects, ...parsed.conditionals.map((conditional) => conditional.effect)].some(
    (effect) => effect.kind === 'stat' && effect.stat === 'fireRate' && effect.value > 0,
  )
}

export const isHeadshotTrigger = (trigger: string) => /headshot|weak ?point/i.test(trigger)

// how much of a conditional the "usual fight" assumes (leaderboard scenario, and the default when you equip something).
// most triggers are easy to keep up, so they sit at max stacks. the exceptions:
//  - headshot / weak point *hit* triggers (Primary Crux, Longbow Sharpshot): off when the scenario is body shots.
//    headshot *kill* triggers (Deadhead) stay on, the buff then works on every shot
//  - melee kills on a gun (Primary/Secondary Dexterity): you have to swap and kill with melee, so half the stacks
//  - armor thresholds (Primary Bulwark): needs a tank frame, half of the max (+250%)
//  - noKills (the boss board): one target that doesn't die, so every kill trigger is off (Deadhead, Galvanized stacks,
//    Merciless, Bladed Rounds...)
export interface TriggerContext { isMelee: boolean; bodyShots: boolean; noKills?: boolean }
export function triggerUptime(trigger: string, { isMelee, bodyShots, noKills }: TriggerContext): number {
  if (noKills && /kill/i.test(trigger)) return 0
  if (isHeadshotTrigger(trigger) && !/kill/i.test(trigger)) return bodyShots ? 0 : 1
  // melee-kill buffs on a gun (Dexterity) need you to keep meleeing between shots: half. Secondary Outburst stays at the full
  // 12x: it goes on Crescendo-style builds that sit at max combo anyway, and that's the only place it's used
  if (/melee kill/i.test(trigger) && !isMelee) return 0.5
  if (/armor past/i.test(trigger)) return 0.5
  return 1
}

export const defaultConditionalStacks = (levelStats: string[][], rank: number, context: TriggerContext) =>
  Math.max(
    0,
    ...parseUpgrade(levelStats, rank).conditionals.map((conditional) =>
      Math.floor(conditional.maxStacks * triggerUptime(conditional.trigger, context)),
    ),
  )

// stuff that doesn't show up in a body-shot damage score but is still worth having when two picks tie
// (Deadhead's headshot multiplier, Merciless's reload speed)
// reload counts half when the ranking is a single hit (no reloads in it), so Deadhead beats Merciless there
export const utilityValue = (levelStats: string[][], rank: number, singleHit = false) => {
  const parsed = parseUpgrade(levelStats, rank)
  const weights: Record<string, number> = {
    headshotMultiplier: 1, weakpointDamage: 1, weakpointCritChance: 1, reloadSpeed: singleHit ? 0.5 : 1,
  }
  return [...parsed.effects, ...parsed.conditionals.map((conditional) => conditional.effect)].reduce(
    (total, effect) => (effect.kind === 'stat' && effect.stat in weights ? total + Math.max(0, effect.value) * weights[effect.stat] : total),
    0,
  )
}
`,_=`// riven mods (wiki Riven_Mods, Riven_Splicer). the user types in their riven's stats, I turn it into a normal Mod so
// the calc treats it like anything else. never offered to the optimizer or leaderboard since rolls are pure RNG.
//
// value at max rank = base x disposition x layout weight x roll, roll is 90%..110% ("randomly chosen between 90% and 110%
// of the base value, multiplied by the weapon's Riven Disposition"). base comes from the export (scripts/build-data.mjs)
// splicing (Update 44.1): two traits are consumed, the spliced trait "inherits the higher random value out of the
// consumed stats", a random trait fills the freed slot (negative if a negative was consumed), the spliced trait is
// always positive and there's only one per riven
import rivensJson from '../data/rivens.json'
import type { Mod, Weapon } from '../types'

export type RivenType = 'Rifle' | 'Shotgun' | 'Pistol' | 'Melee'

export interface RivenStatDef {
  tag: string
  text: string // "% Critical Chance", " Damage to Corpus", "s Combo Duration"
  base: number // max rank base before disposition/weight (0.9 = 90%)
  reversed?: boolean // shown with the opposite sign (Ammo Efficiency)
}

export interface RivenStat {
  tag: string
  value: number // as shown in game at rank 8, in the stat's units (percent for % stats)
  negative: boolean
}

export interface RivenConfig {
  stats: RivenStat[]
  polarity: 'madurai' | 'naramon' | 'vazarin'
  drain: number // at rank 8, 10..18
}

export const RIVEN_MOD_ID = 'riven'
// Hotfix 44.1.3 (2026-10-22, wiki Riven_Mods/Patch_History): "Removed Riven Dispositions. All Rivens now use the same
// multiplier for their possible value ranges, the equivalent of 1.2 Disposition in the old system."
export const RIVEN_DISPOSITION = 1.2
export const RIVEN_MAX_RANK = 8
export const emptyRiven = (): RivenConfig => ({ stats: [], polarity: 'madurai', drain: 18 })

const POOLS = rivensJson as Record<RivenType, RivenStatDef[]>

export const rivenTypeFor = (weapon: Weapon): RivenType | null => {
  if (!weapon.rivenDisposition) return null
  if (weapon.category === 'Melee') return 'Melee'
  if (weapon.category === 'Secondary') return 'Pistol'
  return weapon.type === 'Shotgun' ? 'Shotgun' : 'Rifle'
}
export const rivenPool = (type: RivenType) => POOLS[type]

// wiki Riven_Splicer recipes. the spliced traits only come from splicing, never from a normal roll
const RANGED_RECIPES: [string, string, string][] = [
  ['WeaponWeakpointDamage', 'WeaponDamageAmountMod', 'WeaponZoomFovMod'],
  ['WeaponWeakpointDamage', 'WeaponDamageAmountMod', 'WeaponFireIterationsMod'],
  ['WeaponWeakpointCriticalChance', 'WeaponCritChanceMod', 'WeaponZoomFovMod'],
  ['WeaponWeakpointCriticalChance', 'WeaponCritChanceMod', 'WeaponFireIterationsMod'],
  ['WeaponAmmoEfficiency', 'WeaponClipMaxMod', 'WeaponReloadSpeedMod'],
  ['WeaponAmmoEfficiency', 'WeaponRecoilReductionMod', 'WeaponAmmoMaxMod'],
  ['WeaponMagazineReloadHolstered', 'WeaponAmmoMaxMod', 'WeaponReloadSpeedMod'],
  ['WeaponMagazineReloadHolstered', 'WeaponAmmoMaxMod', 'WeaponClipMaxMod'],
  ['WeaponStatusDamage', 'WeaponDamageAmountMod', 'WeaponStunChanceMod'],
  ['WeaponFactionDamageOrokin', 'WeaponFactionDamageCorpus', 'WeaponFactionDamageGrineer'],
  ['WeaponFactionDamageTechrot', 'WeaponFactionDamageCorpus', 'WeaponFactionDamageInfested'],
  ['WeaponFactionDamageScaldra', 'WeaponFactionDamageInfested', 'WeaponFactionDamageGrineer'],
]
const MELEE_RECIPES: [string, string, string][] = [
  ['WeaponMeleeHeavyAttackDamageMod', 'WeaponMeleeComboEfficiencyMod', 'WeaponMeleeComboBonusOnHitMod'],
  ['WeaponMeleeHeavyAttackChargeMod', 'WeaponMeleeComboEfficiencyMod', 'ComboDurationMod'],
  ['WeaponMeleeParryAngleMod', 'WeaponFireRateMod', 'WeaponMeleeRangeIncMod'],
  ['WeaponMeleeSlamDamageMod', 'WeaponMeleeDamageMod', 'WeaponFireRateMod'],
  ['WeaponStatusDamage', 'WeaponMeleeDamageMod', 'WeaponStunChanceMod'],
  ['WeaponFactionDamageOrokin', 'WeaponMeleeFactionDamageCorpus', 'WeaponMeleeFactionDamageGrineer'],
  ['WeaponFactionDamageTechrot', 'WeaponMeleeFactionDamageCorpus', 'WeaponMeleeFactionDamageInfested'],
  ['WeaponFactionDamageScaldra', 'WeaponMeleeFactionDamageInfested', 'WeaponMeleeFactionDamageGrineer'],
]
const ELEMENT_RECIPES: [string, string, string][] = [
  ['WeaponGasDamageMod', 'WeaponToxinDamageMod', 'WeaponFireDamageMod'],
  ['WeaponCorrosiveDamageMod', 'WeaponToxinDamageMod', 'WeaponElectricityDamageMod'],
  ['WeaponViralDamageMod', 'WeaponToxinDamageMod', 'WeaponFreezeDamageMod'],
  ['WeaponRadiationDamageMod', 'WeaponFireDamageMod', 'WeaponElectricityDamageMod'],
  ['WeaponBlastDamageMod', 'WeaponFireDamageMod', 'WeaponFreezeDamageMod'],
  ['WeaponMagneticDamageMod', 'WeaponElectricityDamageMod', 'WeaponFreezeDamageMod'],
]
export const spliceRecipes = (type: RivenType) => [...(type === 'Melee' ? MELEE_RECIPES : RANGED_RECIPES), ...ELEMENT_RECIPES]
const splicedTags = (type: RivenType) => new Set(spliceRecipes(type).map(([result]) => result))
export const isSpliced = (type: RivenType, tag: string) => splicedTags(type).has(tag)

// wiki Riven_Mods base values notes: "Positive values only (i.e. these attributes will never be a negative trait)" and
// "Negative values only (i.e. these attributes will never be a positive trait)". spliced stats are always positive too
const POSITIVE_ONLY = new Set([
  'WeaponDamageAmountMod', 'WeaponMeleeDamageMod', 'WeaponFreezeDamageMod', 'WeaponElectricityDamageMod', 'WeaponFireDamageMod',
  'WeaponToxinDamageMod', 'WeaponPunctureDepthMod', 'WeaponMeleeComboBonusOnHitMod',
])
const NEGATIVE_ONLY = new Set(['WeaponMeleeComboPointsOnHitMod'])
export const canBeNegative = (type: RivenType, tag: string) => !POSITIVE_ONLY.has(tag) && !isSpliced(type, tag)
export const canBePositive = (tag: string) => !NEGATIVE_ONLY.has(tag)

// "% Critical Chance (x2 for Heavy Attacks)" -> "Critical Chance (x2 for Heavy Attacks)", for dropdowns
export const statName = (def: RivenStatDef) => def.text.replace(/^(%|s)?\\s*/, '')
const statDef = (type: RivenType, tag: string) => POOLS[type].find((def) => def.tag === tag)

// wiki "Attribute Value Formula" weights
export function layoutWeight(positives: number, negatives: number, negative: boolean) {
  if (negative) return positives === 3 ? -0.75 : -0.495
  if (positives === 3) return negatives ? 0.9375 : 0.75
  return negatives ? 1.2375 : 0.99
}

// the stat as it shows in game: Ammo Efficiency's export value is negative but displays as a bonus
const displayBase = (def: RivenStatDef) => (def.reversed ? -def.base : def.base) * (def.text.startsWith('%') || def.text.includes('Damage to') ? 100 : 1)
// rows without a stat yet (the random trait after a splice) still hold a slot in the layout
const layoutOf = (stats: RivenStat[]) => ({ positives: stats.filter((stat) => !stat.negative).length, negatives: stats.filter((stat) => stat.negative).length })

// [low, high] at rank 8 in display units, for this stat in this riven's layout
export function rivenRange(type: RivenType, disposition: number, stats: RivenStat[], stat: Pick<RivenStat, 'tag' | 'negative'>): [number, number] | null {
  const def = statDef(type, stat.tag)
  if (!def) return null
  const { positives, negatives } = layoutOf(stats)
  const center = displayBase(def) * disposition * layoutWeight(Math.max(2, positives), negatives, stat.negative)
  const [a, b] = [center * 0.9, center * 1.1]
  return a < b ? [a, b] : [b, a]
}
// where the value sits in the 90-110% roll window, 1 = perfectly average
export function rivenRoll(type: RivenType, disposition: number, stats: RivenStat[], stat: RivenStat) {
  const range = rivenRange(type, disposition, stats, stat)
  if (!range) return null
  const center = (range[0] + range[1]) / 2
  return center === 0 ? null : stat.value / center
}

// splice two of the riven's stats: the spliced trait takes the better roll, the freed slot gets an empty row of the
// same sign for the user to fill with whatever the game rolled
export function applySplice(type: RivenType, disposition: number, config: RivenConfig, recipe: [string, string, string]): RivenConfig {
  const [result, first, second] = recipe
  const consumed = config.stats.filter((stat) => stat.tag === first || stat.tag === second)
  const rolls = consumed.map((stat) => rivenRoll(type, disposition, config.stats, stat) ?? 1)
  const kept = config.stats.filter((stat) => !consumed.includes(stat))
  const anyNegative = consumed.some((stat) => stat.negative)
  const next = [...kept, { tag: result, value: 0, negative: false }, { tag: '', value: 0, negative: anyNegative }]
  const range = rivenRange(type, disposition, next, { tag: result, negative: false })!
  const value = ((range[0] + range[1]) / 2) * Math.max(...rolls)
  return { ...config, stats: next.map((stat) => (stat.tag === result ? { ...stat, value: Math.round(value * 10) / 10 } : stat)) }
}
export const availableSplices = (type: RivenType, config: RivenConfig) =>
  config.stats.some((stat) => isSpliced(type, stat.tag))
    ? [] // "only one spliced trait can be on a Riven at a time"
    : spliceRecipes(type).filter(([, first, second]) => config.stats.some((stat) => stat.tag === first) && config.stats.some((stat) => stat.tag === second))

export function rivenIssues(type: RivenType, disposition: number, config: RivenConfig): string[] {
  const issues: string[] = []
  const filled = config.stats.filter((stat) => stat.tag)
  const { positives, negatives } = layoutOf(config.stats)
  if (positives < 2 || positives > 3) issues.push('A riven has 2 or 3 positive stats')
  if (negatives > 1) issues.push('A riven has at most 1 negative stat')
  if (new Set(filled.map((stat) => stat.tag)).size !== filled.length) issues.push('The same stat can\\'t roll twice')
  const spliced = filled.filter((stat) => isSpliced(type, stat.tag))
  if (spliced.length > 1) issues.push('Only one spliced stat per riven')
  if (spliced.some((stat) => stat.negative)) issues.push('Spliced stats are always positive')
  for (const stat of filled) {
    const name = statDef(type, stat.tag) ? statName(statDef(type, stat.tag)!) : stat.tag
    if (stat.negative && !isSpliced(type, stat.tag) && !canBeNegative(type, stat.tag)) issues.push(\`\${name} never rolls as a negative\`)
    if (!stat.negative && !canBePositive(stat.tag)) issues.push(\`\${name} only rolls as a negative\`)
  }
  if (config.stats.some((stat) => !stat.tag)) issues.push('Pick the stat the game rolled into the freed slot')
  for (const stat of filled) {
    const range = rivenRange(type, disposition, config.stats, stat)
    if (range && (stat.value < range[0] - 0.05 || stat.value > range[1] + 0.05)) {
      issues.push(\`\${statName(statDef(type, stat.tag)!)} is outside \${fmt(range[0])} to \${fmt(range[1])} for this layout\`)
    }
  }
  return issues
}
export const fmt = (value: number) => (Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2)).replace(/\\.?0+$/, '')

// one stat line the way the mod parser reads it, at a given rank (values scale with rank: rank 0 is 1/9 of max)
function statLine(def: RivenStatDef, value: number, isBow: boolean): string {
  const text = def.text.replace(/^(%|s)?\\s*/, '')
  if (text.startsWith('Damage to ')) return \`x\${fmt(1 + value / 100)} \${text}\` // like the Expel/Bane mods
  // "x2 for Bows" is how the game shows it, the effect on a bow really is doubled
  if (text === 'Fire Rate (x2 for Bows)') return \`\${value >= 0 ? '+' : ''}\${fmt(isBow ? value * 2 : value)}% Fire Rate\`
  const unit = def.text.startsWith('%') ? '%' : def.text.startsWith('s') ? 's' : ''
  return \`\${value >= 0 ? '+' : ''}\${fmt(value)}\${unit} \${text}\`
}

// the riven as a normal Mod, levelStats for ranks 0..8
export function rivenMod(weapon: Weapon, config: RivenConfig): Mod | null {
  const type = rivenTypeFor(weapon)
  if (!type) return null
  const stats = config.stats.filter((stat) => stat.tag && statDef(type, stat.tag))
  return {
    uniqueName: RIVEN_MOD_ID,
    name: \`\${weapon.name} Riven\`,
    type: weapon.category === 'Melee' ? 'Melee Mod' : weapon.category === 'Secondary' ? 'Secondary Mod' : weapon.type === 'Shotgun' ? 'Shotgun Mod' : 'Primary Mod',
    compatName: weapon.name,
    polarity: config.polarity,
    rarity: 'Riven',
    baseDrain: config.drain - RIVEN_MAX_RANK,
    fusionLimit: RIVEN_MAX_RANK,
    imageName: null,
    isExilus: false,
    levelStats: Array.from({ length: RIVEN_MAX_RANK + 1 }, (_, rank) =>
      stats.map((stat) => statLine(statDef(type, stat.tag)!, (stat.value * (rank + 1)) / (RIVEN_MAX_RANK + 1), Boolean(weapon.isBow)))),
  }
}
`,v=`// the "why" next to the god-roll search: what about this weapon's base stats makes some riven stats better than others.
// these are rules of thumb from the base numbers, the search underneath is what actually measures it
import { resolveCoBehavior } from './conditionOverload'
import { rivenPool, type RivenType } from './riven'
import { attackMetrics, categoryWord, damageSplit, rankGroup, standing, type AttackMetrics, type Pool, type PoolKind } from './weaponProfile'
import type { Attack, Weapon } from '../types'

// the attack as evolved (src/calc/evolved.ts): an Incarnon form's numbers with its evolutions on, ranked among other
// evolved forms. without it the hints read the raw data
export interface HintBasis { attack: Attack; metrics: AttackMetrics; kind: PoolKind; pool?: Pool }

export interface RivenHint { title: string; text: string; tone: 'good' | 'bad' | 'neutral' }

const pct = (value: number) => \`\${Math.round(value * 100)}%\`
const baseOf = (type: RivenType, pattern: RegExp) => rivenPool(type).find((def) => pattern.test(def.tag))?.base ?? 0

export function rivenHints(weapon: Weapon, rawAttack: Attack, type: RivenType, basis?: HintBasis): RivenHint[] {
  const hints: RivenHint[] = []
  const attack = basis?.attack ?? rawAttack // numbers come from the evolved attack, identity checks from the raw one
  const metrics = basis?.metrics ?? attackMetrics(weapon, rawAttack)
  const kind = basis?.kind ?? 'normal'
  const rankIn = rankGroup(weapon, kind, rawAttack)
  const group = kind === 'incarnon' ? \`Incarnon forms of \${categoryWord(rankIn)}\` : categoryWord(rankIn)
  const crit = standing(rankIn, 'critChance', attack.critChance, kind, basis?.pool)
  const status = standing(rankIn, 'statusChance', attack.statusChance, kind, basis?.pool)
  const split = damageSplit(attack)

  // crit: crit chance and crit damage both scale off the base, so a high base makes both worth a lot more
  if (attack.critChance >= 0.25 || (crit && crit.percentile >= 0.7)) {
    hints.push({ title: 'Crit stats', tone: 'good', text: \`\${pct(attack.critChance)} base crit (\${crit?.label ?? 'high'} for \${group}). Crit Chance on a riven is a % of the base, so a high base turns it into a lot of real crit, and Crit Damage pays off on every hit.\` })
  } else if (attack.critChance <= 0.1) {
    hints.push({ title: 'Crit stats', tone: 'bad', text: \`Only \${pct(attack.critChance)} base crit. Crit Chance on a riven multiplies a small number, so it barely moves, and Crit Damage needs crits to land. Status or elements usually do more.\` })
  }

  // status: more status chance makes every element's procs land more often
  if (attack.statusChance >= 0.3 || (status && status.percentile >= 0.7)) {
    hints.push({ title: 'Elements and status', tone: 'good', text: \`\${pct(attack.statusChance)} base status (\${status?.label ?? 'high'} for \${group}). Elements on a riven add damage and procs, and Status Damage (spliced) multiplies every DoT.\` })
  } else if (attack.statusChance <= 0.1) {
    hints.push({ title: 'Status', tone: 'neutral', text: \`Low status (\${pct(attack.statusChance)}). Elements still add raw damage (they're a % of the whole base), but their procs won't do much.\` })
  }

  // Condition Overload that multiplies: each status type on the enemy is a separate multiplier
  const co = resolveCoBehavior(weapon, rawAttack)
  if (co.mode === 'multiply') {
    hints.push({ title: 'Multiplicative CO', tone: 'good', text: 'Galvanized / Condition Overload multiply on this attack, so every extra status type on the enemy is worth more than usual. A riven element that brings a new status type (one the build doesn\\'t already make) is extra strong.' })
  }

  // IPS: a riven's Impact/Puncture/Slash only scales that part of the base, an element scales all of it
  const elementBase = baseOf(type, /FireDamageMod$/)
  const physicalBase = baseOf(type, /ImpactDamageMod$/)
  if (elementBase > 0 && physicalBase > 0) {
    const ratio = physicalBase / elementBase
    const breakEven = 1 / ratio
    const top = split.physical[0]
    if (top) {
      const relative = top.share * ratio
      hints.push({
        title: \`\${top.type[0].toUpperCase()}\${top.type.slice(1)} stat\`,
        tone: relative >= 1 ? 'good' : 'neutral',
        text: \`\${top.type[0].toUpperCase()}\${top.type.slice(1)} is \${pct(top.share)} of the damage. Its riven stat rolls \${ratio.toFixed(2)}x an element's, but only scales that part, so it adds \${relative.toFixed(2)}x what an element would. \` +
          \`It needs more than \${pct(breakEven)} of the damage to beat an element on raw damage\${top.type === 'slash' ? ' (Slash also gets armor-ignoring bleeds, so it gets there a bit sooner)' : ''}.\`,
      })
    }
  }

  // innate elements combine with modded ones in the mod order, so the riven's element decides what it turns into
  if (split.elements.length) {
    hints.push({ title: 'Innate element', tone: 'neutral', text: \`It already deals \${split.elements.map((row) => row.type).join(' / ')}. Innate elements combine last, so a riven element can turn it into a combined element (good if you want that status, bad if you wanted the innate one's).\` })
  }

  // beams: multishot is stronger than it looks (bigger merged ticks + more procs, DoTs get it twice)
  if (attack.continuous) {
    hints.push({ title: 'Beam', tone: 'good', text: 'Beam: Multishot makes each tick bigger and adds procs, so damaging statuses (Heat, Toxin, Slash...) get it twice. Multishot rivens are better here than on a normal gun.' })
  } else if (attack.noMultishotMods && weapon.category !== 'Melee') {
    hints.push({ title: 'Multishot', tone: 'bad', text: 'Multishot mods do nothing on this attack, so a Multishot riven stat is wasted on it.' })
  }

  // magazine / reload matter for sustained DPS when the magazine runs dry fast
  if (metrics.magazine && metrics.reload && metrics.fireRate > 0) {
    const emptiesIn = metrics.magazine / metrics.fireRate
    if (emptiesIn < metrics.reload * 1.5) {
      hints.push({ title: 'Magazine', tone: 'neutral', text: \`Empties its \${metrics.magazine}-round magazine in \${emptiesIn.toFixed(1)} s and reloads for \${metrics.reload} s, so it spends a lot of time reloading. Magazine or Reload Speed can be worth a slot for sustained DPS.\` })
    }
  }

  if (weapon.category === 'Melee') {
    hints.push({ title: 'Melee', tone: 'neutral', text: 'Melee crit chance is often pushed by Blood Rush with combo, so a Crit Chance riven is usually worth less than Crit Damage or an element.' })
  }
  return hints
}
`,y=`// damage over a stretch of time: shots on the fire rate, magazine + reload, and status procs ticking on their own
// clocks. two versions share one shot model:
//  - expectedDamage: the average, deterministic and fast (the optimizer calls it thousands of times per attack)
//  - simulateDamage: Monte Carlo, rolls crits and procs per pellet, so the UI can show a bad-luck / good-luck range
// DoT ticks only count if they land inside the window, so long Status Duration tails past the end of a fight
// don't count. Heat refreshes every Heat stack on a new Heat proc (wiki Heat_Damage), so stacks keep ticking
// as long as Heat procs keep coming

export interface DotModel {
  damageType: string
  procsPerPellet: number // expected procs of this type per pellet
  tick: { normal: number; crit: number; average: number } // per tick, by the crit tier of the hit that applied it
  ticks: number // ticks per proc (6, more with status duration). Blast = 1
  firstTickAt: number // seconds after the proc: 1 for Slash/Heat/Toxin, 0 for Electricity/Gas, 1.5 for Blast's fuse
  refreshes: boolean // Heat
}

export interface ShotModel {
  fireRate: number
  multishot: number
  magazineSize: number | null
  reloadTime: number | null
  hit: { normal: number; crit: number; average: number } // per pellet, "crit" = next crit tier up
  critChance: number
  dots: DotModel[]
  instantDots: boolean // Harmony heavies detonate their procs on the spot
  firstShotAt?: number // seconds before the first shot (a charge that has to finish first)
}

// shot times from t = 0 until the window closes: a full magazine, then a reload, and so on
export function shotTimes(model: ShotModel, seconds: number): number[] {
  const times: number[] = []
  const interval = 1 / model.fireRate
  let time = model.firstShotAt ?? 0
  let roundsLeft = model.magazineSize ?? Infinity
  while (time < seconds && times.length < 200000) {
    times.push(time)
    time += interval
    if (--roundsLeft <= 0 && model.reloadTime) {
      time += model.reloadTime
      roundsLeft = model.magazineSize!
    }
  }
  return times
}

// ticks of one proc applied at \`start\` that land before \`windowEnd\` and before \`expiry\`
function ticksInside(start: number, firstTickAt: number, ticks: number, windowEnd: number, expiry: number) {
  if (ticks <= 1) return start + firstTickAt < windowEnd ? 1 : 0 // Blast: one hit after the fuse
  // ticks at start + firstTickAt + k, k = 0, 1, ...
  const beforeWindow = Math.ceil(windowEnd - start - firstTickAt - 1e-9)
  const beforeExpiry = Math.floor(expiry - start - firstTickAt + 1e-9) + 1
  return Math.max(0, Math.min(ticks, beforeWindow, beforeExpiry))
}

// heat stacks die together when no new Heat proc lands within one duration of the last one
function heatExpiries(procTimes: number[], duration: number) {
  const expiries = new Array<number>(procTimes.length)
  let chainStart = 0
  for (let i = 1; i <= procTimes.length; i++) {
    if (i === procTimes.length || procTimes[i] - procTimes[i - 1] > duration) {
      for (let j = chainStart; j < i; j++) expiries[j] = procTimes[i - 1] + duration
      chainStart = i
    }
  }
  return expiries
}

export function expectedDamage(model: ShotModel, seconds: number): number {
  const times = shotTimes(model, seconds)
  const pelletsPerShot = model.multishot
  let total = times.length * model.hit.average * pelletsPerShot
  for (const dot of model.dots) {
    const perShot = dot.procsPerPellet * pelletsPerShot * dot.tick.average
    if (perShot <= 0) continue
    if (model.instantDots) {
      total += perShot * dot.ticks * times.length
      continue
    }
    // expected Heat procs come every 1 / (procs per shot x fire rate) seconds. if that's within one duration the
    // stacks keep refreshing, otherwise each proc runs its own 6 ticks
    const refreshes = dot.refreshes && 1 / (dot.procsPerPellet * pelletsPerShot * model.fireRate) <= dot.ticks
    const expiries = refreshes ? heatExpiries(times, dot.ticks) : null
    for (let i = 0; i < times.length; i++) {
      const expiry = expiries ? expiries[i] : times[i] + dot.firstTickAt + dot.ticks - 1
      total += perShot * ticksInside(times[i], dot.firstTickAt, expiries ? Infinity : dot.ticks, seconds, expiry)
    }
  }
  return total
}

// small seeded RNG (mulberry32) so the range doesn't jump around on every re-render
function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface DamageRange {
  expected: number
  low: number // 10th percentile
  median: number
  high: number // 90th percentile
}

// one pass covers several windows (3 / 10 / 30 s), each run's shots and procs are scored against every window
export function simulateDamage(model: ShotModel, windows: number[], requestedRuns?: number, seed = 12345): DamageRange[] {
  const random = rng(seed)
  const longest = Math.max(...windows)
  const times = shotTimes(model, longest)
  // keep it to ~400k pellet rolls so the UI stays snappy on high fire rate / multishot builds (60-300 runs)
  const runs = requestedRuns ?? Math.max(60, Math.min(300, Math.ceil(400000 / Math.max(1, times.length * model.multishot))))
  const critFloor = Math.floor(model.critChance)
  const critUpChance = model.critChance - critFloor // chance a pellet rolls the next tier up
  // Gotva/Devouring Attrition style bonuses only exist in the average, so rescale the tiers to keep the mean right
  const tierMean = (1 - critUpChance) * model.hit.normal + critUpChance * model.hit.crit
  const hitScale = tierMean > 0 ? model.hit.average / tierMean : 1
  const procsPerPellet = model.dots.reduce((total, dot) => total + dot.procsPerPellet, 0)
  const procFloor = Math.floor(procsPerPellet)
  const procUpChance = procsPerPellet - procFloor
  const weights = model.dots.map((dot) => dot.procsPerPellet / (procsPerPellet || 1))
  const tickScale = model.dots.map((dot) => {
    const mean = (1 - critUpChance) * dot.tick.normal + critUpChance * dot.tick.crit
    return mean > 0 ? dot.tick.average / mean : 1
  })
  const pelletFloor = Math.floor(model.multishot)
  const pelletUpChance = model.multishot - pelletFloor

  const results = windows.map(() => [] as number[])
  const totals = new Array<number>(windows.length)
  for (let run = 0; run < runs; run++) {
    totals.fill(0)
    // heat procs get settled at the end, since a later proc can extend earlier stacks
    const heat: { time: number; tick: number; dot: DotModel }[] = []
    for (const time of times) {
      const pellets = pelletFloor + (random() < pelletUpChance ? 1 : 0)
      for (let pellet = 0; pellet < pellets; pellet++) {
        const crit = random() < critUpChance
        const direct = (crit ? model.hit.crit : model.hit.normal) * hitScale
        for (let w = 0; w < windows.length; w++) if (time < windows[w]) totals[w] += direct
        const procs = procFloor + (random() < procUpChance ? 1 : 0)
        for (let proc = 0; proc < procs; proc++) {
          // pick the proc's damage type by its share
          let pick = random()
          let index = 0
          while (index < weights.length - 1 && pick >= weights[index]) pick -= weights[index++]
          const dot = model.dots[index]
          const tick = (crit ? dot.tick.crit : dot.tick.normal) * tickScale[index]
          if (dot.refreshes && !model.instantDots) {
            heat.push({ time, tick, dot })
            continue
          }
          for (let w = 0; w < windows.length; w++) {
            if (time >= windows[w]) continue
            totals[w] += model.instantDots
              ? tick * dot.ticks
              : tick * ticksInside(time, dot.firstTickAt, dot.ticks, windows[w], time + dot.firstTickAt + dot.ticks - 1)
          }
        }
      }
    }
    if (heat.length) {
      const expiries = heatExpiries(heat.map((proc) => proc.time), heat[0].dot.ticks)
      heat.forEach((proc, i) => {
        for (let w = 0; w < windows.length; w++) totals[w] += proc.tick * ticksInside(proc.time, proc.dot.firstTickAt, Infinity, windows[w], expiries[i])
      })
    }
    totals.forEach((total, w) => results[w].push(total))
  }
  return results.map((values) => {
    values.sort((a, b) => a - b)
    const at = (quantile: number) => values[Math.min(values.length - 1, Math.floor(quantile * values.length))]
    return { expected: values.reduce((a, b) => a + b, 0) / values.length, low: at(0.1), median: at(0.5), high: at(0.9) }
  })
}

// how long until \`amount\` damage is dealt (expected), for time-to-kill. damage only goes up with time, so binary search
export function timeToDeal(model: ShotModel, amount: number, maxSeconds = 600): number {
  if (amount <= 0) return 0
  if (expectedDamage(model, maxSeconds) < amount) return Infinity
  let low = 0
  let high = maxSeconds
  for (let step = 0; step < 40 && high - low > 0.01; step++) {
    const middle = (low + high) / 2
    if (expectedDamage(model, middle) >= amount) high = middle
    else low = middle
  }
  return high
}

// ---- damage attenuation (bosses) ----
// the wiki's model (Necramite / Archon "Damage Resistance Logic", Hemocyte's numbers): two layers on top of normal damage
//  1. per trigger, Reinhard tone mapping: out = MDPT x DPT / (DPT + MDPT), DPT = the shot's damage x multishot (Hemocyte:
//     "Attenuated Damage = Incoming Damage x Max Damage Per Hit / (Incoming Damage x Multishot + Max Damage Per Hit)" per pellet)
//  2. a bucket B that follows Q, the mapped damage of the last 1 s: when Q > B, B = Q, otherwise B decays toward Q as a damped
//     system with lambda = 2/3 ("B'' + 2 lambda B' + lambda^2 B = lambda^2 Q"). damage is multiplied by MDPS / B whenever B > MDPS
// I step it in 0.05 s bins with the expected damage per shot (crits averaged), DoT ticks go into the bucket but skip layer 1
// (they're far under the per-hit cap anyway)
export interface Attenuation { mdpt: number; mdps: number }
const BIN = 0.05
const LAMBDA = 2 / 3
const decay = (dt: number) => 1 / (0.235 * (LAMBDA * dt) ** 2 + 0.48 * LAMBDA * dt + 1) // the wiki's e^(-lambda dt) stand-in

// mapped damage per bin for one layer, out to \`seconds\`
function attenuationBins(model: ShotModel, seconds: number, mdpt: number): Float64Array {
  const bins = new Float64Array(Math.ceil(seconds / BIN) + 1)
  const trigger = model.hit.average * model.multishot
  const mapped = mdpt > 0 ? (mdpt * trigger) / (trigger + mdpt) : trigger
  for (const time of shotTimes(model, seconds)) {
    bins[Math.floor(time / BIN)] += mapped
    for (const dot of model.dots) {
      const tick = dot.procsPerPellet * model.multishot * dot.tick.average
      if (!(tick > 0)) continue
      for (let k = 0; k < Math.max(1, dot.ticks); k++) {
        const at = time + dot.firstTickAt + k
        if (at >= seconds) break
        bins[Math.floor(at / BIN)] += tick
      }
    }
  }
  return bins
}

// seconds to strip \`shield\` (with shieldModel's damage) and then \`health\` (healthModel), attenuated. Infinity if it can't in maxSeconds
// a merged attack (Onos's beam + blast) passes each part's own model, so every part's hits are mapped as the hits they are
export function attenuatedTimeToKill(shieldModels: ShotModel[] | null, shield: number, healthModels: ShotModel[], health: number, attenuation: Attenuation, maxSeconds = 600): number {
  const binsFor = (models: ShotModel[], seconds: number) => {
    const total = attenuationBins(models[0], seconds, attenuation.mdpt)
    for (const model of models.slice(1)) {
      const more = attenuationBins(model, seconds, attenuation.mdpt)
      for (let index = 0; index < total.length; index++) total[index] += more[index]
    }
    return total
  }
  let horizon = 8
  while (true) {
    const seconds = Math.min(horizon, maxSeconds)
    const shieldBins = shieldModels && shield > 0 ? binsFor(shieldModels, seconds) : null
    const healthBins = binsFor(healthModels, seconds)
    const window = Math.round(1 / BIN)
    const recent = new Float64Array(window) // the 1 s queue, as a ring of bins
    let queue = 0, bucket = 0, slope = 0, shieldLeft = shieldBins ? shield : 0, healthLeft = health
    for (let index = 0; index < healthBins.length; index++) {
      const onShield = shieldLeft > 0 && shieldBins
      const incoming = onShield ? shieldBins![index] : healthBins[index]
      // the queue: last 1 s of mapped damage
      queue += incoming - recent[index % window]
      recent[index % window] = incoming
      if (queue >= bucket) { bucket = queue; slope = 0 }
      else {
        const e = decay(BIN)
        const gamma = ((bucket - queue) * LAMBDA + slope) * BIN * e
        bucket = gamma + (bucket - queue) * e + queue
        slope = -LAMBDA * gamma + slope * e
      }
      const dealt = incoming * (bucket > attenuation.mdps ? attenuation.mdps / bucket : 1)
      if (onShield) {
        shieldLeft -= dealt
        if (shieldLeft <= 0) shieldLeft = 0
      } else {
        healthLeft -= dealt
        if (healthLeft <= 0) return (index + 1) * BIN
      }
    }
    if (seconds >= maxSeconds) {
      // past the limit, extrapolate at the average rate so weak builds still give the optimizer a slope
      const dealtTotal = (shieldBins ? shield - shieldLeft : 0) + (health - healthLeft)
      return dealtTotal > 0 ? (seconds * (shield + health)) / dealtTotal : Infinity
    }
    horizon *= 2
  }
}
`,b=`// weapon augment lines too odd for the normal stat patterns, one rule each. values come from the line itself so lower
// ranks still scale. the trigger text ends up in the results' "This build assumes" list, so it says what has to happen.
// lines that don't change damage at all (ammo, accuracy, projectile speed...) are dropped instead of listed as "not modeled"
import type { ModEffect } from './parseMod'

export type SpecialLine = { ignore: true } | { trigger?: string; maxStacks?: number; effects: ModEffect[] }

const pct = (text: string) => Number(text.replace(/,/g, '')) / 100
const stat = (key: Extract<ModEffect, { kind: 'stat' }>['stat'], value: number): ModEffect => ({ kind: 'stat', stat: key, value })
const element = (name: string, value: number): ModEffect => ({ kind: 'damageType', damageType: name.toLowerCase() === 'electric' ? 'electricity' : name.toLowerCase(), value })

const RULES: [RegExp, (match: RegExpMatchArray) => SpecialLine][] = [
  // Secondary Enervate: "On Hit: Increase Critical Chance by 10%. Resets after 6 Big Critical Hit". the calc averages it
  // over a whole build-up-and-reset cycle (damage.ts enervateAverageCrit)
  [/^Increase Critical Chance by ([\\d.]+)%\\.? Resets after (\\d+) Big Critical Hits?/i, (m) => ({
    trigger: 'On Hit (stacks until big crits reset it):', effects: [{ kind: 'critPerHit', value: pct(m[1]), resetsAfter: Number(m[2]) }],
  })],
  // Biotic Rounds: "+150% Viral and Magnetic Damage and Status Chance", Leaded Gas: "+300% Gas Damage and Status Chance"
  [/^\\+?([\\d.]+)% (\\w+)(?: and (\\w+))? Damage and Status Chance$/i, (m) => ({
    effects: [element(m[2], pct(m[1])), ...(m[3] ? [element(m[3], pct(m[1]))] : []), stat('statusChance', pct(m[1]))],
  })],
  // Burning Hate
  [/become vulnerable to ([\\d.]+)% more Status Damage/i, (m) => ({ trigger: 'Target has a Heat status:', effects: [stat('statusDamage', pct(m[1]))] })],
  // Clip Delegation: "Next Magazine has Status Chance and Multishot increased by 15% per shot landed ... Max 15 stacks"
  [/Status Chance and Multishot increased by ([\\d.]+)% per shot landed.*Max (\\d+) stacks/i, (m) => ({
    trigger: 'Shots landed with the last magazine:', maxStacks: Number(m[2]), effects: [stat('statusChance', pct(m[1])), stat('multishot', pct(m[1]))],
  })],
  // Combat Reload
  [/^If (\\d+) pellets are headshots, increase reload speed by \\+?([\\d.]+)%/i, (m) => ({ trigger: \`\${m[1]} pellets hit the head (headshots):\`, effects: [stat('reloadSpeed', pct(m[2]))] })],
  // Critical Mutation: "Each kill increases Critical Chance and Critical Damage by 30% up to 300%"
  [/^Each kill increases Critical Chance and Critical Damage by ([\\d.]+)% up to ([\\d.]+)%/i, (m) => ({
    trigger: 'On Kill:', maxStacks: Math.round(Number(m[2]) / Number(m[1])), effects: [stat('critChance', pct(m[1])), stat('critDamage', pct(m[1]))],
  })],
  // Critical Precision: "Burst Fire Only: Headshots increase Critical Chance by 10% up to 500%"
  [/Headshots increase Critical Chance by ([\\d.]+)% up to ([\\d.]+)%/i, (m) => ({
    trigger: 'On Headshot (burst fire):', maxStacks: Math.round(Number(m[2]) / Number(m[1])), effects: [stat('critChance', pct(m[1]))],
  })],
  // Deadly Maneuvers
  [/^On Dodge, gain ([\\d.]+)% Headshot Critical Chance for your next (\\d+) shots/i, (m) => ({ trigger: \`After a dodge (next \${m[2]} shots, headshots):\`, effects: [stat('weakpointCritChance', pct(m[1]))] })],
  // Double Tap: "ON HIT: +20% Bonus Damage on next Shot"
  // Double Tap: "ON HIT: 20% Bonus Damage on next Shot for 2s. Stacks up to 20x outside of Conclave."
  [/^(?:ON HIT: )?\\+?([\\d.]+)% Bonus Damage on next Shot/i, (m) => ({ trigger: 'On Hit (consecutive hits, next shot):', maxStacks: 20, effects: [{ kind: 'damageMultiplier', value: pct(m[1]) }] })],
  [/^ON HIT:\\s*$|^Stacks up to \\d+x/i, () => ({ ignore: true })],
  // Dreadful Killshot: "+20% for every 75 Warframe Health. Capped at 360%" (stacks come from the Warframe panel's health)
  [/^Increased Damage and Status Chance by \\+?([\\d.]+)% for every ([\\d,]+) Warframe Health\\. Capped at ([\\d.]+)%/i, (m) => ({
    trigger: \`Warframe health per \${m[2]}:\`, maxStacks: Math.round(Number(m[3]) / Number(m[1])), effects: [stat('damage', pct(m[1])), stat('statusChance', pct(m[1]))],
  })],
  // Primary Plated Round: "On Reload: Deal increased damage per round loaded based on max magazine size". wiki
  // Primary_Plated_Round: "Max Damage Bonus = 15 x sqrt(5 x Magazine Size)" (%), "additive to base damage sources such as
  // Serration". rank only changes how long it lasts (3-10 s), so the number is the same at every rank
  [/^Deal increased damage per round loaded based on max magazine size/i, () => ({
    trigger: 'On Reload (an empty magazine, buff lasts 10 s):', effects: [{ kind: 'damagePerMagazine', coefficient: 0.15 }],
  })],
  // Secondary Outburst: "consume all Combo Multipliers to increase Secondary Weapon Critical Chance and Critical Damage by 20%
  // per Combo consumed for 30s". wiki: "+240%" at 12x, "additive with mods like Pistol Gambit". stacks = the combo multiplier
  [/consume all Combo Multipliers to increase Secondary Weapon Critical Chance and Critical Damage by ([\\d.]+)% per Combo consumed/i, (m) => ({
    trigger: 'Swapped from melee at a combo multiplier of (stacks):', maxStacks: 12, effects: [stat('critChance', pct(m[1])), stat('critDamage', pct(m[1]))],
  })],
  // Cascadia Empowered: "Deals +750 Damage matching the Damage Type of the Status Effect", wiki: "an extra instance of damage
  // when proccing a status effect", "Not affected by damage, element, physical ... or critical mods", "Affected by faction mods
  // and bonuses once", "Affected by Damage Vulnerability", "Not affected by weakspots"
  [/^Deals \\+?([\\d,]+) Damage matching the Damage Type of the Status Effect/i, (m) => ({ effects: [{ kind: 'flatPerProc', value: Number(m[1].replace(/,/g, '')) }] })],
  // Meticulous Aim: "-45% Bodyshot Damage", wiki: "Bodyshot damage penalty is multiplicative to weapon overall damage"
  [/^-([\\d.]+)% Bodyshot Damage$/i, (m) => ({ effects: [{ kind: 'bodyShotMultiplier', value: -pct(m[1]) }] })],
  // Melee Doughty: "Gain 1.0x Critical Damage for every 10% Puncture Status chance on your Melee Weapon."
  [/^Gain ([\\d.]+)x Critical Damage for every 10% Puncture Status chance/i, (m) => ({ effects: [{ kind: 'critPerPunctureStatus', value: Number(m[1]) }] })],
  // Nightwatch Napalm (Ogris): "Rockets disperse napalm, inflicting 30% damage over 6s across 90% of the explosion area."
  // the wiki: "The fire will deal 30% of the weapon's modified base damage as Heat damage with 68% chance to proc over 6
  // seconds". the 68% isn't in the mod text and "Status chance is not affected by mods", so it's fixed here
  [/^Rockets disperse napalm, inflicting ([\\d.]+)% damage over ([\\d.]+)s/i, (m) => ({
    effects: [{ kind: 'napalm', fraction: pct(m[1]), seconds: Number(m[2]), procChance: 0.68 }],
  })],
  // Entropy Burst / Napalm Grenades: "+20 Final Status Chance"
  [/^\\+([\\d.]+) Final Status Chance$/i, (m) => ({ effects: [{ kind: 'flatStat', stat: 'statusChance', value: pct(m[1]) }] })],
  // Exposing Harpoon
  [/^Pulling an enemy will give \\+?([\\d.]+)% Critical Chance/i, (m) => ({ trigger: 'After pulling an enemy:', effects: [stat('critChance', pct(m[1]))] })],
  // Eximus Advantage
  [/^Headshots on Eximus enemies increase Secondary Damage by \\+?([\\d.]+)%/i, (m) => ({ trigger: 'On Headshot on an Eximus:', effects: [stat('damage', pct(m[1]))] })],
  // Flux Overdrive: swings between the two, so the middle
  [/^Status Chance fluctuates between \\+?([\\d.]+)% and \\+?([\\d.]+)%/i, (m) => ({ effects: [stat('statusChance', (pct(m[1]) + pct(m[2])) / 2)] })],
  // Hata-Satya: grows each hit until the reload, half a 200-round Soma Prime magazine on average
  [/^Each hit increases Critical Chance by ([\\d.]+)%\\. Resets upon reloading/i, (m) => ({
    trigger: 'Hits since the last reload (100 = half a magazine):', maxStacks: 100, effects: [stat('critChance', pct(m[1]))],
  })],
  // Necrophagic Vigor: "+20% for every 20 Health drained. Capped at 360%"
  [/Critical Chance and Critical Damage by \\+?([\\d.]+)% for every ([\\d,]+) Health drained\\. Capped at ([\\d.]+)%/i, (m) => ({
    trigger: \`Health drained on reload (per \${m[2]}):\`, maxStacks: Math.round(Number(m[3]) / Number(m[1])), effects: [stat('critChance', pct(m[1])), stat('critDamage', pct(m[1]))],
  })],
  // Range Advantage
  [/^\\+?([\\d.]+)% damage if no enemies are within (\\d+)m/i, (m) => ({ trigger: \`No enemies within \${m[2]}m:\`, effects: [stat('damage', pct(m[1]))] })],
  // Sentient Surge (3 Tendrils assumed max)
  [/Status Chance and Critical Chance are increased by ([\\d.]+)% for each Tendril active/i, (m) => ({
    trigger: 'Per active Tendril (3 max assumed):', maxStacks: 3, effects: [stat('statusChance', pct(m[1])), stat('critChance', pct(m[1]))],
  })],
  // Spring-Loaded Broadhead, split over two lines
  [/^Increase damage by \\+?([\\d.]+)%$/i, (m) => ({ trigger: 'Target over 15m away:', effects: [stat('damage', pct(m[1]))] })],
  [/^if the target is over \\d+m away\\.?$/i, () => ({ ignore: true })],
  // Unseen Dread
  [/Deal ([\\d.]+)% more Critical Damage with \\w+ while invisible/i, (m) => ({ trigger: 'While invisible:', effects: [stat('critDamage', pct(m[1]))] })],
  // Prototype Shock Coils: "+90% Electric damage, and shots have a 20% base chance to apply extra Electric status"
  [/^Adds \\+?([\\d.]+)% Electric damage, and shots have a ([\\d.]+)% base chance to apply extra Electric status/i, (m) => ({
    effects: [element('electricity', pct(m[1])), { kind: 'forcedProcChance', damageType: 'electricity', value: pct(m[2]) }],
  })],
  // Lasting Purity
  [/^\\+?([\\d.]+)% Damage when Aiming$/i, (m) => ({ trigger: 'When Aiming:', effects: [stat('damage', pct(m[1]))] })],
  // Volatile Variant: "Barbs that strike enemies directly have +4m radius and +50% Status Chance"
  [/strike enemies directly have .*\\+([\\d.]+)% Status Chance/i, (m) => ({ effects: [stat('statusChance', pct(m[1]))] })],
  // Precision Strike
  [/^Hitting an enemy directly with the grenade increases Reload Speed by ([\\d.]+)%/i, (m) => ({ trigger: 'After a direct grenade hit:', effects: [stat('reloadSpeed', pct(m[1]))] })],
  // no damage in these: ammo, aim, travel, utility
  [/Ammo Efficiency|Accuracy|Projectile Speed|Zoom|Punch Through|^\\+1 '|Life Steal|Gore Chance|Combo Duration|Combo Count Chance|Ammo Maximum|Beam Range|Blast Radius|Falloff Distance|Shield Recharge|Universal Orb|Energy Orb|Health Orbs|Chance to Explode|bounce up to|chance to pickup|disarm|Nullifier|tether|stick to surfaces|open them to finishers|Hacking/i, () => ({ ignore: true })],
]

export function specialLine(text: string): SpecialLine | null {
  for (const [pattern, build] of RULES) {
    const match = text.match(pattern)
    if (match) return build(match)
  }
  return null
}
`,x=`import { CORROSIVE_PROJECTION_PER_AURA, corrosiveArmorReduction } from './constants'
import type { Debuffs } from '../types'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// Enemy_Level_Scaling: blend of a low and high curve with a smoothstep between 70-80 levels over base
export function scaleArmor(baseArmor: number, levelsAboveBase: number): number {
  if (baseArmor <= 0) return 0
  const q = Math.max(0, levelsAboveBase)
  const lowCurve = 1 + 0.005 * q ** 1.75
  const highCurve = 1 + 0.4 * q ** 0.75
  const t = clamp((q - 70) / (80 - 70), 0, 1)
  const blend = t * t * (3 - 2 * t)
  const scaled = baseArmor * (lowCurve + (highCurve - lowCurve) * blend)
  return clamp(scaled, 200, 2700) // initial armor is clamped to 200-2700
}

// every armor reduction source multiplies: (1 - heat) x (1 - corrosive) x (1 - 18% x CP) x (1 - other)
export function effectiveArmor(armor: number, debuffs: Debuffs): number {
  return (
    armor *
    (1 - debuffs.heatArmorStrip) *
    (1 - corrosiveArmorReduction(debuffs.stacks.corrosive ?? 0)) *
    Math.max(0, 1 - CORROSIVE_PROJECTION_PER_AURA * debuffs.corrosiveProjections) *
    (1 - debuffs.otherArmorReduction)
  )
}

// DM = 1 - 0.9 * sqrt(AR / 2700). above 2700 the wiki says the AR / (AR + 300) form takes over
export function armorDamageMultiplier(armor: number): number {
  if (armor <= 0) return 1
  if (armor <= 2700) return 1 - 0.9 * Math.sqrt(armor / 2700)
  return 1 - armor / (armor + 300)
}

// ---- enemy level scaling (wiki Enemy_Level_Scaling) ----
// each stat blends a low-level curve f1 and high-level curve f2 with a smoothstep between levels 70-80 above base:
//   f(q) = 1 + C * q^E, q = level - base level, multiplier = f1 + (f2 - f1) * smoothstep
interface Curve { c: number; e: number }
interface ScalingCurves { low: Curve; high: Curve }

const HEALTH_CURVES: Record<string, ScalingCurves> = {
  grineer: { low: { c: 0.015, e: 2.12 }, high: { c: 10.7332, e: 0.72 } }, // also Scaldra
  corpus: { low: { c: 0.015, e: 2.12 }, high: { c: 13.4165, e: 0.55 } },
  infested: { low: { c: 0.0225, e: 2.12 }, high: { c: 16.0998, e: 0.72 } },
  corrupted: { low: { c: 0.015, e: 2.1 }, high: { c: 10.7332, e: 0.685 } },
  techrot: { low: { c: 0.02, e: 2.12 }, high: { c: 15.0998, e: 0.7 } },
  standard: { low: { c: 0.015, e: 2 }, high: { c: 10.7332, e: 0.5 } }, // Murmur, Sentient, Anarchs, unaffiliated
}
const SHIELD_CURVES: Record<string, ScalingCurves> = {
  corpus: { low: { c: 0.02, e: 1.76 }, high: { c: 2, e: 0.76 } },
  corrupted: { low: { c: 0.02, e: 1.75 }, high: { c: 2, e: 0.75 } },
  techrot: { low: { c: 0.02, e: 1.76 }, high: { c: 3.5, e: 0.76 } },
  standard: { low: { c: 0.02, e: 1.75 }, high: { c: 1.6, e: 0.75 } }, // Grineer and Sentient
}

// which curve set the (U36) faction dropdown uses
const SCALING_GROUP: Record<string, string> = {
  Grineer: 'grineer', 'Kuva Grineer': 'grineer', Scaldra: 'grineer',
  Corpus: 'corpus', 'Corpus Amalgam': 'corpus',
  Infested: 'infested', 'Infested Deimos': 'infested',
  Orokin: 'corrupted', Techrot: 'techrot',
}

function scalingMultiplier(curves: ScalingCurves, levelsAboveBase: number): number {
  const q = Math.max(0, levelsAboveBase)
  const low = 1 + curves.low.c * q ** curves.low.e
  const high = 1 + curves.high.c * q ** curves.high.e
  const t = clamp((q - 70) / (80 - 70), 0, 1)
  return low + (high - low) * t * t * (3 - 2 * t)
}

export const STEEL_PATH_LEVEL_BONUS = 100
export const STEEL_PATH_HEALTH_SHIELD_MULTIPLIER = 2.5 // armor isn't multiplied since Update 36

export function scaleHealth(baseHealth: number, levelsAboveBase: number, faction: string, steelPath: boolean): number {
  const curves = HEALTH_CURVES[SCALING_GROUP[faction] ?? 'standard']
  return baseHealth * scalingMultiplier(curves, levelsAboveBase) * (steelPath ? STEEL_PATH_HEALTH_SHIELD_MULTIPLIER : 1)
}

export function scaleShield(baseShield: number, levelsAboveBase: number, faction: string, steelPath: boolean): number {
  if (baseShield <= 0) return 0
  const curves = SHIELD_CURVES[SCALING_GROUP[faction] ?? 'standard'] ?? SHIELD_CURVES.standard
  return baseShield * scalingMultiplier(curves, levelsAboveBase) * (steelPath ? STEEL_PATH_HEALTH_SHIELD_MULTIPLIER : 1)
}
`,S=`// what the Warframe build adds up to: Ability Strength, armor/health/shields, damage reduction, and the auras that buff
// weapons. mod and arcane text goes through the same parser as weapon mods (frameStat effects), auras and a few odd lines
// are read straight from the text here ("Squad receives +60% Melee Damage", Power Donation, Growing Power)
// damage reduction (wiki Damage_Reduction): "Sources of damage reduction (including armor) stack multiplicatively with each
// other", armor DR = armor / (armor + 300) and only on health, and the page's example gives shields "an innate 50% DR"
import { warframeBaseName } from '../data'
import { abilitiesById, type AbilityCast, type WarframeState } from '../data/warframeAbilities'
import type { Arcane, Mod, Warframe } from '../types'
import { parseUpgrade, type FrameStat, type ModEffect } from './parseMod'
import { countSets, setEnhancement, type SetPieces } from './modSets'
import { NO_SHARD_BONUS, rank30Energy, shardBuffsById, shardTotals, type ShardSlot, type ShardWeaponBonus } from '../data/archonShards'

export interface EquippedWarframeMod {
  mod: Mod
  rank: number
  conditionalStacks?: number
}
export interface EquippedWarframeArcane {
  arcane: Arcane
  rank: number
  conditionalStacks: number
}

export interface WarframeBuild {
  frame: Warframe
  mods: EquippedWarframeMod[]
  arcanes: EquippedWarframeArcane[] // the frame's two arcane slots
  extraStrength: number // anything not in the mods or shards (fraction, 0.1 = +10%)
  extraDuration?: number // same for Ability Duration
  extraArmor: number // flat armor not from shards
  shards?: (ShardSlot | null)[] // the 5 Archon Shard slots
  teammateStrength: number // strength allies cast at
  casts: AbilityCast[] // your abilities, your subsumed one and allies' (built by the panel)
  shieldInnateDr?: boolean // shields' innate 50% DR, on unless turned off
  otherDr?: number // any other DR source not modeled (fraction)
}

export interface DrSource {
  label: string
  value: number // fraction of damage removed
  on: 'health' | 'shields' | 'both'
}

export interface WarframeTotals {
  abilityStrength: number // 1 = 100%
  abilityDuration: number // 1 = 100%
  abilityRange: number // 1 = 100%
  abilityEfficiency: number // 1 = 100%, before the 175% cap
  energyCost: number // what abilities cost vs their base: 2 - efficiency, efficiency capped at 175%
  sprintSpeed: number // the frame's base sprint x (1 + mods)
  castingSpeed: number // bonus, 0 = normal
  parkourVelocity: number // bonus, 0 = normal
  shieldRecharge: number // bonus, 0 = normal
  armor: number
  health: number
  shields: number
  energy: number // max energy: rank 30 x (1 + Flow...) + Azure shards
  shards: ShardWeaponBonus // what the shards give weapons
  shardStrength: number // the part of abilityStrength that's from shards (Damage Cap splits it out)
  violetDoubled: boolean
  // damage reduction, multiplicative between sources
  drSources: DrSource[]
  healthDr: number // total vs health (armor included)
  shieldDr: number // total vs shields (no armor)
  effectiveHealth: number // health / (1 - healthDr) + shields / (1 - shieldDr)
  // Arcane Persistence's hit cap (needs armor above the threshold, Magnetic and nullifiers turn it off)
  damageCap: { source: string; armorNeeded: number; perSecond: number; active: boolean } | null
  setPieces: SetPieces // mod set pieces on the frame, they count with the weapon's for set bonuses
  // weapon damage from squad auras (Steel Charge, Rifle Amp, ...), by weapon group
  auraDamage: { melee: number; rifle: number; sniper: number; pistol: number; shotgun: number }
  weakpointCritChance: number // Worthy Comradery
  corrosiveProjections: number // auras that strip 18% armor each
  lines: string[] // what got counted, for the panel
}

const STAT_LABELS: Partial<Record<FrameStat, string>> = {
  damageResistance: 'DR', range: 'range', efficiency: 'efficiency', sprintSpeed: 'sprint speed', castingSpeed: 'casting speed',
  parkourVelocity: 'parkour velocity', shieldRecharge: 'shield recharge',
}
// Ability Efficiency stops at 175% (abilities never cost less than 25%)
export const EFFICIENCY_CAP = 1.75

const segments = (lines: string[]) => lines.flatMap((line) => line.split(/\\\\n|\\n/)).map((segment) => segment.trim()).filter(Boolean)
const percent = (text: string) => Number(text) / 100
export const SHIELD_INNATE_DR = 0.5
export const armorDr = (armor: number) => (armor > 0 ? armor / (armor + 300) : 0)
const combineDr = (values: number[]) => 1 - values.reduce((taken, value) => taken * (1 - Math.min(1, Math.max(0, value))), 1)

export function warframeTotals(build: WarframeBuild): WarframeTotals {
  const flat = { armor: build.extraArmor, health: 0 }
  const scaling = {
    strength: build.extraStrength, duration: build.extraDuration ?? 0, armorPercent: 0, healthPercent: 0, shieldPercent: 0, energyPercent: 0,
    range: 0, efficiency: 0, sprintSpeed: 0, castingSpeed: 0, parkourVelocity: 0, shieldRecharge: 0,
  }
  const drSources: DrSource[] = []
  const auraDamage = { melee: 0, rifle: 0, sniper: 0, pistol: 0, shotgun: 0 }
  let weakpointCritChance = 0
  let corrosiveProjections = 0
  const lines: string[] = []

  // frameStat effects from mods/arcanes, times their active stacks
  const addFrameStat = (source: string, stat: FrameStat, value: number, times: number) => {
    const total = value * times
    if (stat === 'damageResistance') drSources.push({ label: source, value: Math.min(0.9, total), on: 'both' })
    else if (stat === 'armor' || stat === 'health') flat[stat] += total
    else scaling[stat] += total
    lines.push(\`\${source}: \${stat === 'armor' || stat === 'health' ? \`+\${Math.round(total)} \${stat}\` : \`\${total >= 0 ? '+' : ''}\${Math.round(total * 1000) / 10}% \${STAT_LABELS[stat] ?? stat.replace('Percent', '')}\`}\`)
  }
  const addUpgrade = (name: string, levelStats: string[][], rank: number, stacks: number, enhance = 1) => {
    const parsed = parseUpgrade(levelStats, rank)
    const frameStat = (effect: ModEffect) => (effect.kind === 'frameStat' ? effect : null)
    for (const effect of parsed.effects) {
      const stat = frameStat(effect)
      if (stat) addFrameStat(name, stat.stat, stat.value, enhance)
    }
    for (const conditional of parsed.conditionals) {
      const stat = frameStat(conditional.effect)
      const active = Math.min(stacks, conditional.maxStacks)
      if (stat && active > 0) addFrameStat(name, stat.stat, stat.value, active * enhance)
    }
  }

  // mod sets on the frame (Umbra enhances its own mods: Fiber/Vitality x1.3 / x1.8, Intensify x1.25 / x1.75 with 2 / 3 pieces)
  const setPieces = countSets(build.mods.map(({ mod }) => mod))
  for (const { mod, rank, conditionalStacks } of build.mods) {
    const enhance = setEnhancement(mod, setPieces)
    addUpgrade(mod.name, mod.levelStats, rank, conditionalStacks ?? 0, enhance)
    if (enhance !== 1) lines.push(\`\${mod.name}: x\${enhance} from its set\`)
    // the lines the parser doesn't do: auras and a couple of strength oddballs
    const stats = mod.levelStats[Math.min(rank, mod.levelStats.length - 1)] ?? []
    for (const text of segments(stats)) {
      let match: RegExpMatchArray | null
      if ((match = text.match(/^You lose ([\\d.]+)% Ability Strength/))) {
        scaling.strength -= percent(match[1]) // Power Donation
        lines.push(\`\${mod.name}: -\${match[1]}% strength\`)
      } else if ((match = text.match(/increases personal Ability Strength by ([\\d.]+)%/))) {
        scaling.strength += percent(match[1]) // Growing Power, assumed up (weapon status procs keep it going)
        lines.push(\`\${mod.name}: +\${match[1]}% strength (assumed up)\`)
      } else if ((match = text.match(/^Squad receives \\+([\\d.]+)% Armor$/))) {
        scaling.armorPercent += percent(match[1]) // Stand United
        lines.push(\`\${mod.name}: +\${match[1]}% armor\`)
      } else if ((match = text.match(/^Squad gains \\+([\\d.]+)% Maximum Health$/))) {
        scaling.healthPercent += percent(match[1]) // Physique
        lines.push(\`\${mod.name}: +\${match[1]}% health\`)
      } else if ((match = text.match(/^Squad receives \\+([\\d.]+)% (Melee|Rifle|Sniper Rifle|Pistol|Shotgun) Damage$/))) {
        const group = ({ Melee: 'melee', Rifle: 'rifle', 'Sniper Rifle': 'sniper', Pistol: 'pistol', Shotgun: 'shotgun' } as const)[match[2] as 'Melee']
        auraDamage[group] += percent(match[1])
        lines.push(\`\${mod.name}: +\${match[1]}% \${match[2].toLowerCase()} damage\`)
      } else if ((match = text.match(/^Squad receives \\+([\\d.]+)% Weak Point Critical Chance$/))) {
        weakpointCritChance += percent(match[1])
        lines.push(\`\${mod.name}: +\${match[1]}% weak point crit chance\`)
      } else if (/^Enemies lose -18% Armor$/.test(text)) {
        corrosiveProjections += 1
        lines.push(\`\${mod.name}: -18% enemy armor\`)
      }
    }
  }
  // Arcane Persistence: "Remove all Shields. If Armor is above 700: Cannot be hit for more than 500 Damage/s"
  let shieldsRemovedBy: string | null = null
  let damageCap: WarframeTotals['damageCap'] = null
  for (const { arcane, rank, conditionalStacks } of build.arcanes) {
    addUpgrade(arcane.name, arcane.levelStats, rank, conditionalStacks)
    const text = segments(arcane.levelStats[Math.min(rank, arcane.levelStats.length - 1)] ?? []).join(' ')
    if (/Remove all Shields/i.test(text)) shieldsRemovedBy = arcane.name
    const cap = text.match(/If Armor is above ([\\d,]+): Cannot be hit for more than ([\\d,]+) Damage\\/s/i)
    if (cap) damageCap = { source: arcane.name, armorNeeded: Number(cap[1].replace(/,/g, '')), perSecond: Number(cap[2].replace(/,/g, '')), active: false }
  }

  // Archon Shards: flat Energy goes on after Flow ("after all bonuses"), then Violet checks the 500
  const energyBeforeShards = rank30Energy(build.frame) * (1 + scaling.energyPercent)
  const shards = shardTotals(build.shards ?? [], energyBeforeShards)
  scaling.strength += shards.strength
  scaling.duration += shards.duration
  // Amber casting speed / parkour shards don't touch weapons, so shardTotals skips them, but they're frame stats
  for (const slot of build.shards ?? []) {
    const shard = slot && shardBuffsById.get(slot.buffId)
    const value = shard ? (slot.tauforged ? shard.tauforged : shard.normal) : 0
    if (shard?.id === 'amber-casting') scaling.castingSpeed += value
    if (shard?.id === 'amber-parkour') scaling.parkourVelocity += value
  }
  flat.armor += shards.armor
  flat.health += shards.health
  if (shards.lines.length) lines.push(\`Archon Shards: \${shards.lines.join(', ')}\`)
  const energy = rank30Energy(build.frame) > 0 ? Math.round(energyBeforeShards + shards.energy) : 0

  const abilityStrength = Math.max(0, 1 + scaling.strength)
  const abilityDuration = Math.max(0, 1 + scaling.duration)
  const abilityRange = Math.max(0, 1 + scaling.range)
  const abilityEfficiency = 1 + scaling.efficiency

  // abilities: % of base armor/health/shields go in with the mods, DR sources stack multiplicatively
  const frameName = warframeBaseName(build.frame.name)
  // synergies: an active ability of yours multiplying another one's defense (Hysteria: "Warcry's armor bonus is multiplied by 3x")
  const boostFor = (abilityId: string) => build.casts
    .filter((cast) => cast.by !== 'ally')
    .reduce((total, cast) => total * (abilitiesById.get(cast.id)?.boosts?.[abilityId] ?? 1), 1)
  for (const cast of build.casts) {
    const ability = abilitiesById.get(cast.id)
    if (!ability?.defense) continue
    if (ability.selfOnly && (cast.by !== 'self' || ability.warframe !== frameName)) continue
    const strength = !ability.scalesWithStrength ? 1 : cast.by === 'ally' ? build.teammateStrength : abilityStrength
    for (const effect of ability.defense) {
      if (effect.selfOnly && cast.by === 'ally') continue
      if (effect.kind === 'damageReduction') {
        const cap = cast.by === 'helminth' ? effect.helminthCap ?? effect.cap : effect.cap
        // Null Star: the particle count is the Duration stat (12 x duration), 5% each no matter the Strength
        const stacks = effect.stacksScaleWithDuration ? Math.round(effect.stacks * abilityDuration) : effect.stacks
        drSources.push({ label: \`\${ability.name}\${effect.stacksScaleWithDuration ? \` (\${stacks} \${effect.stackLabel ?? 'stacks'})\` : ''}\`, value: Math.min(cap, effect.perStack * stacks * strength), on: 'both' })
      } else {
        const boost = cast.by === 'ally' ? 1 : boostFor(ability.id)
        scaling[effect.kind] += effect.value * strength * boost
        lines.push(\`\${ability.name}: +\${Math.round(effect.value * strength * boost * 1000) / 10}% \${effect.kind.replace('Percent', '')}\${boost !== 1 ? \` (x\${boost})\` : ''}\`)
      }
    }
  }

  const armor = Math.max(0, Math.round(build.frame.armor * (1 + scaling.armorPercent) + flat.armor))
  const health = Math.max(1, Math.round(build.frame.health * (1 + scaling.healthPercent) + flat.health))
  const shields = shieldsRemovedBy ? 0 : Math.max(0, Math.round(build.frame.shield * (1 + scaling.shieldPercent) + shards.shields))
  if (shieldsRemovedBy) lines.push(\`\${shieldsRemovedBy}: shields removed\`)
  if (damageCap) damageCap.active = armor > damageCap.armorNeeded

  if ((build.otherDr ?? 0) > 0) drSources.push({ label: 'Other DR', value: build.otherDr!, on: 'both' })
  const allSources: DrSource[] = [
    { label: \`Armor (\${armor.toLocaleString()})\`, value: armorDr(armor), on: 'health' },
    ...(build.shieldInnateDr === false || shields <= 0 ? [] : [{ label: 'Shields\\' innate DR', value: SHIELD_INNATE_DR, on: 'shields' as const }]),
    ...drSources,
  ]
  const healthDr = combineDr(allSources.filter((source) => source.on !== 'shields').map((source) => source.value))
  const shieldDr = combineDr(allSources.filter((source) => source.on !== 'health').map((source) => source.value))
  const effectiveHealth = health / Math.max(1e-6, 1 - healthDr) + shields / Math.max(1e-6, 1 - shieldDr)

  return {
    abilityStrength, abilityDuration, abilityRange, abilityEfficiency,
    energyCost: 2 - Math.min(EFFICIENCY_CAP, abilityEfficiency),
    sprintSpeed: (build.frame.sprintSpeed ?? 1) * (1 + scaling.sprintSpeed),
    castingSpeed: scaling.castingSpeed, parkourVelocity: scaling.parkourVelocity, shieldRecharge: scaling.shieldRecharge,
    armor, health, shields, energy,
    shards: shards.weapon ?? NO_SHARD_BONUS, shardStrength: shards.strength, violetDoubled: shards.violetDoubled,
    drSources: allSources, healthDr, shieldDr, effectiveHealth, damageCap, setPieces,
    auraDamage, weakpointCritChance, corrosiveProjections, lines,
  }
}

// what the damage calc gets (buffs.warframe)
export function warframeStateFor(build: WarframeBuild, totals: WarframeTotals): WarframeState {
  return {
    frameName: warframeBaseName(build.frame.name),
    abilityStrength: totals.abilityStrength,
    teammateStrength: build.teammateStrength,
    armor: totals.armor,
    health: totals.health,
    setPieces: totals.setPieces,
    casts: build.casts,
    arcanes: build.arcanes.map(({ arcane, rank, conditionalStacks }) => ({ arcaneId: arcane.uniqueName, rank, conditionalStacks })),
    auraDamage: totals.auraDamage,
    weakpointCritChance: totals.weakpointCritChance,
    shards: totals.shards,
    shardStrength: totals.shardStrength,
  }
}
`,C=`// where a weapon's base numbers sit among its own category (primaries vs primaries, melee vs melee), plus the plain
// "is this good?" lines the Compare Weapons and Rivens pages show. all from the unmodded attack data, so it says what
// the weapon brings to a build, not what a build does with it
import { weapons } from '../data'
import { SPEARGUNS, meleeClassOf } from '../data/weaponClasses'
import { resolveCoBehavior } from './conditionOverload'
import { PHYSICAL_TYPES } from './constants'
import type { CalcResult } from './damage'
import type { Attack, Weapon } from '../types'

export interface AttackMetrics {
  damage: number // one pellet, every type added up
  hit: number // one shot: damage x multishot
  critChance: number
  critMultiplier: number
  statusChance: number // per pellet
  fireRate: number // attack speed on melee
  multishot: number
  rawDps: number // hit x fire rate x average crit, no reloads. a rough "how much does it start with"
  magazine: number | null
  reload: number | null
}

export type MetricKey = keyof Omit<AttackMetrics, 'magazine' | 'reload'> | 'magazine' | 'reload'

export const METRIC_LABELS: Record<MetricKey, string> = {
  damage: 'Damage per pellet', hit: 'Damage per shot', critChance: 'Crit chance', critMultiplier: 'Crit multiplier', statusChance: 'Status chance',
  fireRate: 'Fire rate', multishot: 'Multishot', rawDps: 'Raw DPS', magazine: 'Magazine', reload: 'Reload',
}
// lower is better for these
export const LOWER_IS_BETTER = new Set<MetricKey>(['reload'])

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

export function attackMetrics(weapon: Weapon, attack: Attack): AttackMetrics {
  const damage = sum(Object.values(attack.damage))
  const multishot = weapon.category === 'Melee' ? 1 : attack.multishot ?? weapon.multishot ?? 1
  const hit = damage * multishot
  const averageCrit = 1 + Math.min(attack.critChance, 10) * (attack.critMultiplier - 1)
  const incarnon = /incarnon/i.test(attack.name)
  const reloads = weapon.category !== 'Melee' && !incarnon
  return {
    damage, hit, critChance: attack.critChance, critMultiplier: attack.critMultiplier, statusChance: attack.statusChance,
    fireRate: attack.fireRate, multishot, rawDps: hit * attack.fireRate * averageCrit,
    magazine: reloads ? weapon.magazineSize ?? null : null,
    reload: reloads ? weapon.reloadTime ?? null : null,
  }
}

// the same numbers off a calc run, for an attack with Incarnon evolutions on (their +damage, +crit... are applied there).
// damage is every modded type added up, so a "+N base damage" perk shows up in it
export function metricsFromResult(weapon: Weapon, attack: Attack, result: CalcResult): AttackMetrics {
  const damage = sum(result.damageTypes.map((row) => row.modded))
  const multishot = weapon.category === 'Melee' ? 1 : result.multishot
  const hit = damage * multishot
  const base = attackMetrics(weapon, attack)
  return {
    damage, hit, critChance: result.critChance, critMultiplier: result.critMultiplier, statusChance: result.statusChance, fireRate: result.fireRate, multishot,
    rawDps: hit * result.fireRate * (1 + Math.min(result.critChance, 10) * (result.critMultiplier - 1)),
    magazine: base.magazine === null ? null : result.magazineSize, reload: base.reload === null ? null : result.reloadTime,
  }
}

// who a stat is ranked against: every weapon's normal attack, or (for an Incarnon form) every other Incarnon form
export type PoolKind = 'normal' | 'incarnon'
export const isIncarnonAttack = (attack: Attack) => /incarnon/i.test(attack.name)

// each weapon counts once per category, by its first attack (the normal fire / normal swing), or by its first Incarnon
// attack for the Incarnon pool. exalted weapons and ones with nothing in that attack are left out so they don't skew it
export interface Pool { values: Record<MetricKey, number[]>; count: number }
// a pool from any list of metrics (Compare Weapons builds the Incarnon one with each form's evolutions on)
export function buildPool(list: AttackMetrics[]): Pool {
  const values = Object.fromEntries((Object.keys(METRIC_LABELS) as MetricKey[]).map((key) => [key, [] as number[]])) as Record<MetricKey, number[]>
  for (const metrics of list) {
    for (const key of Object.keys(values) as MetricKey[]) {
      const value = metrics[key]
      if (value !== null && Number.isFinite(value)) values[key].push(value)
    }
  }
  for (const entry of Object.values(values)) entry.sort((a, b) => a - b)
  return { values, count: list.length }
}
// ranking groups: a weapon is ranked against its own subtype (shotguns vs shotguns, glaives vs glaives), keyed
// "Primary/Shotgun", "Melee/Glaive". a subtype with too few weapons in it falls back to the whole category
// ("Primary"), percentiles out of 3 weapons don't mean much
const MIN_GROUP = 6
export function subtypeOf(weapon: Weapon): string | null {
  if (weapon.category === 'Melee') return meleeClassOf(weapon.name)
  if (weapon.category === 'Primary') return SPEARGUNS.includes(weapon.name) ? 'Speargun' : weapon.isBow ? 'Bow' : weapon.type
  return weapon.type // Pistol, Dual Pistols, Throwing
}
// a group can also name one attack ("Melee/Glaive#Charged Throw"): then each member is counted by its attack of that name,
// so a glaive's throw is ranked against other glaive throws, not against their normal swings
const splitGroup = (group: string) => { const [base, attackName] = group.split('#'); return { base, attackName: attackName ?? null } }
const inGroup = (weapon: Weapon, group: string) => {
  const [category, subtype] = splitGroup(group).base.split('/')
  return weapon.category === category && (!subtype || subtypeOf(weapon) === subtype)
}
// the group a weapon is ranked in, for its normal attack or its Incarnon form
export function rankGroup(weapon: Weapon, kind: PoolKind = 'normal', attack?: Attack): string {
  const subtype = subtypeOf(weapon)
  const group = subtype ? \`\${weapon.category}/\${subtype}\` : weapon.category
  const base = group !== weapon.category && poolFor(group, kind).count < MIN_GROUP ? weapon.category : group
  // a non-first attack (throw, heavy, alt-fire) goes against the same attack of its type, then of its category, and
  // only falls back to normal attacks when too few weapons have one
  if (kind === 'normal' && attack && attack !== weapon.attacks[0]) {
    for (const candidate of [\`\${group}#\${attack.name}\`, \`\${weapon.category}#\${attack.name}\`]) {
      if (poolFor(candidate, kind).count >= MIN_GROUP) return candidate
    }
  }
  return base
}
// what a group's members are counted by, for the "ranked against" text
export const groupAttackName = (group: string) => splitGroup(group).attackName
export const groupMembers = (group: string) => weapons.filter((weapon) => inGroup(weapon, group))

const pools = new Map<string, Pool>()
function poolFor(category: string, kind: PoolKind = 'normal'): Pool {
  const cached = pools.get(\`\${category}|\${kind}\`)
  if (cached) return cached
  const values = Object.fromEntries((Object.keys(METRIC_LABELS) as MetricKey[]).map((key) => [key, [] as number[]])) as Record<MetricKey, number[]>
  let count = 0
  for (const weapon of weapons) {
    const { attackName } = splitGroup(category)
    const attack = kind === 'incarnon' ? weapon.attacks.find(isIncarnonAttack) : attackName ? weapon.attacks.find((other) => other.name === attackName) : weapon.attacks[0]
    if (!inGroup(weapon, category) || weapon.exalted || !attack) continue
    const metrics = attackMetrics(weapon, attack)
    if (metrics.damage <= 0) continue
    count++
    for (const key of Object.keys(values) as MetricKey[]) {
      const value = metrics[key]
      if (value !== null && Number.isFinite(value)) values[key].push(value)
    }
  }
  for (const list of Object.values(values)) list.sort((a, b) => a - b)
  const pool = { values, count }
  pools.set(\`\${category}|\${kind}\`, pool)
  return pool
}

export interface Standing {
  value: number
  percentile: number // 0..1, share of the category this beats ("better than"), direction-aware
  average: number
  best: boolean // ties for the best in the category
  worst: boolean
  label: 'highest' | 'well above average' | 'above average' | 'average' | 'below average' | 'well below average' | 'lowest'
}

export function standing(category: string, key: MetricKey, value: number | null, kind: PoolKind = 'normal', pool?: Pool): Standing | null {
  if (value === null || !Number.isFinite(value)) return null
  const list = (pool ?? poolFor(category, kind)).values[key]
  if (list.length < 2) return null
  const lower = list.filter((other) => other < value - 1e-9).length
  const higher = list.filter((other) => other > value + 1e-9).length
  const equal = list.length - lower - higher
  const flip = LOWER_IS_BETTER.has(key)
  // ties count half (mid-rank), so a 1x multishot that most primaries share reads as typical, not "the lowest"
  const beats = ((flip ? higher : lower) + Math.max(0, equal - 1) / 2) / (list.length - 1)
  // best / worst only when few weapons share the value
  const rare = equal <= Math.max(2, list.length * 0.05)
  const best = rare && (flip ? lower : higher) === 0
  const worst = rare && (flip ? higher : lower) === 0
  const label: Standing['label'] = best ? 'highest' : worst ? 'lowest' : beats >= 0.85 ? 'well above average' : beats >= 0.6 ? 'above average'
    : beats > 0.4 ? 'average' : beats > 0.15 ? 'below average' : 'well below average'
  return { value, percentile: Math.min(1, Math.max(0, beats)), average: sum(list) / list.length, best, worst, label }
}

// "highest" on reload means fastest, so the wording follows the stat
export function standingWords(key: MetricKey, item: Standing): string {
  if (key === 'reload') return item.best ? 'the fastest' : item.worst ? 'the slowest' : item.label.replace('above', 'faster than').replace('below', 'slower than').replace('average', 'average')
  return item.best ? 'the highest' : item.worst ? 'the lowest' : item.label
}

// plural name of a group: "primaries", "shotguns", "glaives", "dual pistols"
const SUBTYPE_WORDS: Record<string, string> = {
  Rifle: 'rifles', Shotgun: 'shotguns', Sniper: 'snipers', Launcher: 'launchers', Bow: 'bows', Speargun: 'spearguns',
  Pistol: 'single pistols', 'Dual Pistols': 'dual pistols', Throwing: 'thrown secondaries',
  'Blade and Whip': 'blade and whips', 'Sword and Shield': 'sword and shields', Staff: 'staves', 'Assault Saw': 'assault saws',
  Fist: 'fists', Claws: 'claws', 'Dual Daggers': 'dual daggers', 'Dual Swords': 'dual swords', 'Dual Nikanas': 'dual nikanas',
}
export const categoryWord = (group: string) => {
  const [category, subtype] = splitGroup(group).base.split('/')
  if (subtype) return SUBTYPE_WORDS[subtype] ?? \`\${subtype.toLowerCase()}s\`
  return category === 'Melee' ? 'melee weapons' : category === 'Secondary' ? 'secondaries' : 'primaries'
}
export const categorySize = (category: string, kind: PoolKind = 'normal', pool?: Pool) => (pool ?? poolFor(category, kind)).count

const pct = (value: number) => \`\${Math.round(value * 1000) / 10}%\`
const fmt = (value: number) => (value >= 100 ? Math.round(value).toLocaleString() : (Math.round(value * 100) / 100).toString())
export const metricText = (key: MetricKey, value: number | null) => {
  if (value === null) return '–'
  if (key === 'critChance' || key === 'statusChance') return pct(value)
  if (key === 'critMultiplier' || key === 'multishot') return \`\${fmt(value)}x\`
  if (key === 'reload') return \`\${fmt(value)}s\`
  return fmt(value)
}

// the damage split: which share is Impact/Puncture/Slash, which elements it starts with
export function damageSplit(attack: Attack) {
  const total = sum(Object.values(attack.damage))
  const shares = Object.entries(attack.damage).filter(([, amount]) => amount > 0).map(([type, amount]) => ({ type, share: total > 0 ? amount / total : 0 }))
    .sort((a, b) => b.share - a.share)
  return {
    shares,
    physical: shares.filter((row) => PHYSICAL_TYPES.includes(row.type)),
    elements: shares.filter((row) => !PHYSICAL_TYPES.includes(row.type) && row.type !== 'true' && row.type !== 'void' && row.type !== 'tau'),
  }
}

// the plain lines under a weapon: only the stats that stand out, best first
export interface ProfileLine { text: string; tone: 'good' | 'bad' | 'neutral' }
// \`metrics\` / \`kind\`: Compare Weapons passes evolved Incarnon numbers and which pool to rank them in
export function profileLines(weapon: Weapon, attack: Attack, metrics: AttackMetrics = attackMetrics(weapon, attack), kind: PoolKind = 'normal', pool?: Pool): ProfileLine[] {
  const rankIn = rankGroup(weapon, kind, attack)
  const byAttack = groupAttackName(rankIn)
  const group = kind === 'incarnon' ? \`Incarnon forms of \${categoryWord(rankIn)}\` : byAttack ? \`\${categoryWord(rankIn)} (their \${byAttack})\` : categoryWord(rankIn)
  const lines: ProfileLine[] = []
  const keys: MetricKey[] = ['rawDps', 'hit', 'critChance', 'critMultiplier', 'statusChance', 'fireRate', 'multishot', 'magazine', 'reload']
  for (const key of keys) {
    if (weapon.category === 'Melee' && (key === 'multishot' || key === 'hit')) continue
    const item = standing(rankIn, key, metrics[key], kind, pool)
    if (!item || item.label === 'average') continue
    const label = key === 'fireRate' && weapon.category === 'Melee' ? 'Attack speed' : METRIC_LABELS[key]
    const words = standingWords(key, item)
    const where = item.best || item.worst ? \`of all \${categorySize(rankIn, kind, pool)} \${group}\` : \`for \${group} (better than \${Math.min(99, Math.round(item.percentile * 100))}%)\`
    lines.push({
      text: \`\${label} \${metricText(key, metrics[key])}: \${words} \${where}.\`,
      tone: item.percentile >= 0.6 ? 'good' : item.percentile <= 0.4 ? 'bad' : 'neutral',
    })
  }
  const split = damageSplit(attack)
  const topPhysical = split.physical[0]
  if (topPhysical && topPhysical.share >= 0.6) lines.push({ text: \`Mostly \${topPhysical.type} (\${pct(topPhysical.share)} of its damage).\`, tone: 'neutral' })
  if (split.elements.length) lines.push({ text: \`Starts with \${split.elements.map((row) => \`\${row.type} (\${pct(row.share)})\`).join(', ')}: element mods combine with it.\`, tone: 'neutral' })
  const co = resolveCoBehavior(weapon, attack)
  if (co.mode === 'multiply') lines.push({ text: 'Multiplicative Condition Overload: every status type on the enemy multiplies its damage.', tone: 'good' })
  if (attack.continuous) lines.push({ text: 'Beam: multishot merges into bigger ticks, so damaging statuses scale with it twice.', tone: 'neutral' })
  if (attack.isAoE) lines.push({ text: 'Area damage: no headshots.', tone: 'neutral' })
  // sort: the standout good, then the bad, then the rest
  const order = { good: 0, bad: 1, neutral: 2 }
  return lines.sort((a, b) => order[a.tone] - order[b.tone])
}
`,w=`// Experimental > Data Analysis: poking at the whole arsenal at once. base stats straight from the weapon data, how much
// Enervate is really worth, how weapons changed across updates, and what the leaderboard's best builds actually pick
import { useEffect, useMemo, useState } from 'react'
import { mods, weapons } from '../data'
import introducedJson from '../data/introduced.json'
import { calculate, enervateAverageCrit } from '../calc/damage'
import { passivesFor } from '../data/passives'
import { SCENARIO_BUFFS, SCENARIO_DEBUFFS, SCENARIO_TARGET } from '../optimizer/scenario'
import { loadLeaderboard } from '../optimizer/leaderboardLoader'
import type { Leaderboard, LeaderboardEntry } from '../optimizer/leaderboardTypes'
import { Bars, Histogram, Lines, Scatter, SERIES, Tile } from './charts'
import type { Attack, Weapon } from '../types'
import { subtypeOf } from '../calc/weaponProfile'
import { getIncarnonTiers, perkAppliesTo, scenarioPerkStacks, type SelectedPerk } from '../calc/incarnon'

const modsByName = new Map(mods.map((mod) => [mod.name, mod]))
const weaponsByName = new Map(weapons.map((weapon) => [weapon.name, weapon]))
const evolutionLines = (row: Row) => (row.evolutions.length ? ['Evolutions (base stats include them):', ...row.evolutions] : [])
// tooltip name: the weapon, plus which attack when it isn't the plain one
const rowLabel = (row: { name: string; attack: string }) => (row.attack === weaponsByName.get(row.name)?.attacks[0]?.name ? row.name : \`\${row.name} · \${row.attack}\`)
const CATEGORIES = ['Primary', 'Secondary', 'Melee'] as const
type Category = (typeof CATEGORIES)[number]
const COLOR: Record<Category, string> = { Primary: SERIES[0], Secondary: SERIES[1], Melee: SERIES[2] }
const pct = (value: number, digits = 0) => \`\${(value * 100).toFixed(digits)}%\`
const big = (value: number) => (value >= 1e6 ? \`\${+(value / 1e6).toPrecision(3)}M\` : value >= 1e3 ? \`\${+(value / 1e3).toPrecision(3)}k\` : \`\${+value.toPrecision(3)}\`)
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length / 2
  return sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2
}

// one row per weapon: its first attack (the plain fire / Normal Attack; merged "A + B" rows and heavies come later in the list).
// exalted weapons are abilities, not something you pick, so they're out
interface Row { name: string; attack: string; evolutions: string[]; baseDps: number; category: Category; type: string; subtype: string; crit: number; critMultiplier: number; status: number; damage: number; fireRate: number; incarnon: boolean; era: number | null }
const totalDamage = (damage: Record<string, unknown>) => Object.values(damage).reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)

// the wiki's Introduced is an update number ("19.0.7", "Vanilla"), a few old ones are named instead ("Update: The Silver Grove 2").
// those named ones are all Update 17-18 (2015-16), so they land in the same 5-update bucket either way
const INTRODUCED = introducedJson as Record<string, string>
function updateNumber(version: string | undefined): number | null {
  if (!version) return null
  if (/vanilla/i.test(version)) return 0
  const number = version.match(/^(\\d+)/)
  return number ? +number[1] : 18
}
const ERA_SIZE = 5
const eraLabel = (era: number) => (era === 0 ? 'U0–4' : \`U\${era}–\${era + ERA_SIZE - 1}\`)

// which attack a row stands for. most weapons have more than the plain fire: alt-fires and fire modes, the Incarnon form, melee
// heavies, and special attacks like glaive throws, gunblade shots or spectral daggers
export type AttackMode = 'normal' | 'both' | 'alt' | 'incarnon' | 'heavy'
export const MODES: { id: AttackMode; label: string; blurb: string }[] = [
  { id: 'normal', label: 'Normal fire', blurb: "each weapon's plain fire or Normal Attack (its first attack, with its explosion or other parts if it has them)" },
  { id: 'both', label: 'Normal + Incarnon', blurb: "how the weapons actually get used: the Incarnon form for weapons that have one, normal fire for the rest; leaderboard rows take whichever of the two scored higher" },
  { id: 'alt', label: 'Alt-fire & special', blurb: "each weapon's alt-fire, other fire mode or special attack (glaive throws, charged throws, ranged melee attacks...), the hardest-hitting one when it has several; weapons without one are left out" },
  { id: 'incarnon', label: 'Incarnon form', blurb: "each weapon's Incarnon form (whole shot, explosion included), only weapons that have one" },
  { id: 'heavy', label: 'Melee heavy', blurb: "each melee weapon's Heavy Attack, guns are left out" },
]
// a "shot" is a merged attack ("Rocket Impact + Rocket Explosion") or an attack that isn't part of one
interface Shot { attack: Attack; names: string[] }
function shotsOf(weapon: Weapon): Shot[] {
  const merged = weapon.attacks.filter((attack) => attack.parts?.length)
  const inMerged = new Set(merged.flatMap((attack) => attack.parts!))
  return [...merged.map((attack) => ({ attack, names: [attack.name, ...attack.parts!] })),
    ...weapon.attacks.filter((attack) => !attack.parts?.length && !inMerged.has(attack.name)).map((attack) => ({ attack, names: [attack.name] }))]
}
const shotDamage = (weapon: Weapon, attack: Attack) => totalDamage(attack.damage as Record<string, unknown>) * (attack.multishot ?? weapon.multishot ?? 1)
// what kind of attack a name is, for a weapon. leaderboard rows use the same names, so they get sorted the same way
export function modeOf(weapon: Weapon, attackName: string): AttackMode | null {
  const first = weapon.attacks[0]?.name
  if (attackName === first || weapon.attacks.find((attack) => attack.name === attackName)?.parts?.includes(first)) return 'normal'
  if (attackName.includes('Incarnon Form')) return 'incarnon'
  if (weapon.category === 'Melee') {
    if (/^Heavy Attack$/.test(attackName)) return 'heavy'
    if (/Slam|^Heavy Attack|Tactical Combo/.test(attackName)) return null // slams and the rest of the universal moves aren't a weapon's own thing
  }
  return 'alt'
}
function pickShot(weapon: Weapon, mode: AttackMode): Shot | null {
  if (mode === 'both') return pickShot(weapon, 'incarnon') ?? pickShot(weapon, 'normal')
  const shots = shotsOf(weapon).filter((shot) => modeOf(weapon, shot.attack.name) === mode)
  if (!shots.length) return null
  return shots.reduce((best, shot) => (shotDamage(weapon, shot.attack) > shotDamage(weapon, best.attack) ? shot : best))
}

// Incarnon weapons: the base stats with the evolutions the leaderboard picked for that attack, since those change the base
// (Braton's +crit, Latron's +base damage...). only the base-stat lines count here (base, "set to", and the native Incarnons'
// flat crit/status), the mod-like ones (+% damage, multishot) are mods, not base stats. conditional lines at the
// leaderboard's scenario stacks (body shots, kills on)
interface Evolved { crit: number; critMultiplier: number; status: number; damageScale: number; picked: string[]; perks: SelectedPerk[] }
function applyEvolutions(weapon: Weapon, attack: Attack, entry: LeaderboardEntry | undefined): Evolved {
  const out: Evolved = { crit: attack.critChance, critMultiplier: attack.critMultiplier, status: attack.statusChance, damageScale: 1, picked: [], perks: [] }
  const tiers = getIncarnonTiers(weapon.name)
  if (!tiers || !entry?.perks?.length) return out
  const isMelee = weapon.category === 'Melee'
  const isIncarnonAttack = /incarnon/i.test(attack.name)
  const base = { damage: 0, critChance: 0, critMultiplier: 0, statusChance: 0, multishot: 0 }
  const set: Partial<Record<'critChance' | 'statusChance' | 'critMultiplier', number>> = {}
  for (const { tier, name } of entry.perks) {
    const perk = tiers.find((one) => one.tier === tier)?.perks.find((one) => one.name === name)
    if (!perk) continue
    out.picked.push(\`\${tier}: \${name}\`)
    const stacks = scenarioPerkStacks(perk, { isMelee, bodyShots: true })
    out.perks.push({ perk, stacks })
    for (const statement of perk.statements) {
      const effect = statement.effect
      if (!effect || !perkAppliesTo(statement.mode, isIncarnonAttack, isMelee)) continue
      const times = statement.condition ? Math.min(stacks, statement.maxStacks) : 1
      if (times <= 0) continue
      if (effect.kind === 'base') base[effect.stat] += effect.value * times
      else if (effect.kind === 'flat') base[effect.stat] += effect.value * times
      else if (effect.kind === 'baseSet') set[effect.stat] = effect.value
    }
  }
  const pool = attack.baseDamagePool ?? totalDamage(attack.damage as Record<string, unknown>)
  return { ...out, crit: set.critChance ?? out.crit + base.critChance, critMultiplier: set.critMultiplier ?? out.critMultiplier + base.critMultiplier,
    status: set.statusChance ?? out.status + base.statusChance, damageScale: pool > 0 ? (pool + base.damage) / pool : 1 }
}

function rowsFor(list: Weapon[], mode: AttackMode, board: Leaderboard | null | undefined): Row[] {
  // the leaderboard row that picked the evolutions: the same attack on the sustained board (single hit for heavies)
  const entries = new Map<string, LeaderboardEntry>()
  for (const key of ['single', 'sustained']) for (const entry of board?.boards[key] ?? []) entries.set(\`\${entry.weaponName}|\${entry.attack}\`, entry)
  return list.filter((weapon) => !weapon.exalted && (CATEGORIES as readonly string[]).includes(weapon.category) && weapon.attacks.length).flatMap((weapon) => {
    const shot = pickShot(weapon, mode)
    if (!shot) return []
    const attack = shot.attack
    const update = updateNumber(INTRODUCED[weapon.name])
    const evolved = applyEvolutions(weapon, attack, entries.get(\`\${weapon.name}|\${attack.name}\`))
    // the weapon's own sustained DPS: no mods, no arcane, only its innate passives and the evolutions above, neutral target.
    // what the weapon brings, not what a build does with it. heavies don't have a sustained number, so it's one whole heavy
    const unmodded = calculate({
      weapon, attack, mods: [], arcane: null, incarnonPerks: evolved.perks, bonusElement: null,
      passives: passivesFor(weapon.name).map((passive) => ({ passive, stacks: passive.condition ? passive.scenarioStacks ?? passive.maxStacks ?? 1 : 1 })),
      target: SCENARIO_TARGET, armor: 0, debuffs: SCENARIO_DEBUFFS, buffs: SCENARIO_BUFFS,
    })
    const baseDps = mode === 'heavy' ? unmodded.attackTotal : unmodded.sustainedDps
    return [{
      name: weapon.name, attack: attack.name, evolutions: evolved.picked, category: weapon.category as Category, type: weapon.type, subtype: subtypeOf(weapon) ?? \`Other \${weapon.category.toLowerCase()}\`,
      crit: evolved.crit, critMultiplier: evolved.critMultiplier, status: evolved.status, damage: shotDamage(weapon, attack) * evolved.damageScale,
      fireRate: attack.fireRate, incarnon: weapon.attacks.some((other) => other.name.includes('Incarnon Form')),
      era: update === null ? null : Math.floor(update / ERA_SIZE) * ERA_SIZE, baseDps: Number.isFinite(baseDps) ? baseDps : 0,
    }]
  })
}

// Spearman rank correlation: does a higher base stat line up with a higher leaderboard score (1 = perfectly, 0 = no link)
function spearman(xs: number[], ys: number[]) {
  const rank = (values: number[]) => {
    const order = values.map((value, index) => [value, index] as const).sort((a, b) => a[0] - b[0])
    const ranks = Array<number>(values.length)
    for (let start = 0; start < order.length;) {
      let end = start
      while (end + 1 < order.length && order[end + 1][0] === order[start][0]) end++
      for (let k = start; k <= end; k++) ranks[order[k][1]] = (start + end) / 2 // ties share the average rank
      start = end + 1
    }
    return ranks
  }
  const rx = rank(xs)
  const ry = rank(ys)
  const mx = mean(rx)
  const my = mean(ry)
  let top = 0, sx = 0, sy = 0
  rx.forEach((value, index) => { top += (value - mx) * (ry[index] - my); sx += (value - mx) ** 2; sy += (ry[index] - my) ** 2 })
  return sx && sy ? top / Math.sqrt(sx * sy) : 0
}

export function DataExplorer() {
  const [mode, setMode] = useState<AttackMode>('normal')
  const [rawBoard, setBoard] = useState<Leaderboard | null | undefined>(undefined)
  useEffect(() => { loadLeaderboard().then(setBoard) }, [])
  const rows = useMemo(() => rowsFor(weapons, mode, rawBoard), [mode, rawBoard])
  const normalRows = useMemo(() => rowsFor(weapons, 'normal', rawBoard), [rawBoard])
  // the leaderboard with only this mode's rows on it, so "best per weapon" means best Incarnon form, best alt-fire...
  const board = useMemo(() => (rawBoard ? { ...rawBoard, boards: Object.fromEntries(Object.entries(rawBoard.boards).map(([key, entries]) =>
    [key, entries.filter((entry) => { const weapon = weaponsByName.get(entry.weaponName); if (!weapon) return false
      const entryMode = modeOf(weapon, entry.attack)
      return mode === 'both' ? entryMode === 'normal' || entryMode === 'incarnon' : entryMode === mode })])) } : rawBoard), [rawBoard, mode])
  const modeInfo = MODES.find((one) => one.id === mode)!
  return (
    <>
      <section className="panel">
        <h2>Data Analysis</h2>
        <p className="muted">
          Base stats before any mods, and "damage" is the attack's total base damage times its multishot. Exalted weapons are left out. The
          leaderboard sections read the current leaderboard, so they show what the optimizer picked.
        </p>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="label">Attack:</span>
          {MODES.map((one) => <button key={one.id} className={one.id === mode ? 'active' : ''} onClick={() => setMode(one.id)}>{one.label}</button>)}
        </div>
        <p className="muted">Showing {modeInfo.blurb}: {rows.length} weapons. The Enervate section always uses normal fire.</p>
      </section>
      <ArsenalFacts rows={rows} />
      <Subtypes rows={rows} mode={mode} />
      <Enervate rows={normalRows} />
      <Trends rows={rows} />
      <PrimeUplift rows={rows} />
      <LeaderboardMeta rows={rows} board={board} />
    </>
  )
}

// ---- 1. simple facts ----
function ArsenalFacts({ rows }: { rows: Row[] }) {
  const [category, setCategory] = useState<Category>('Primary')
  const inCategory = rows.filter((row) => row.category === category)
  return (
    <section className="panel">
      <div className="row spread"><h2>The arsenal in numbers</h2><CategoryPicker value={category} onChange={setCategory} /></div>
      <div className="tile-groups">
        {CATEGORIES.filter((one) => rows.some((row) => row.category === one)).map((one) => {
          const group = rows.filter((row) => row.category === one)
          return (
            <div key={one} className="tile-group">
              <h3>{one} · {group.length} weapons</h3>
              <div className="tiles">
                <Tile label="Average crit chance" value={pct(mean(group.map((row) => row.crit)), 1)} sub={\`median \${pct(median(group.map((row) => row.crit)))}\`} />
                <Tile label="Average crit multiplier" value={\`\${mean(group.map((row) => row.critMultiplier)).toFixed(2)}x\`} sub={\`median \${median(group.map((row) => row.critMultiplier)).toFixed(1)}x\`} />
                <Tile label="Average status chance" value={pct(mean(group.map((row) => row.status)), 1)} sub={\`median \${pct(median(group.map((row) => row.status)))}\`} />
                <Tile label="Average base damage" value={big(mean(group.map((row) => row.damage)))} sub={\`median \${big(median(group.map((row) => row.damage)))}\`} />
              </div>
            </div>
          )
        })}
      </div>
      <p className="muted">Average damage sits well above the median everywhere: a handful of launchers, bows and snipers hit for hundreds or thousands per shot and pull the average up.</p>

      <div className="chart-grid">
        <Histogram title={\`\${category} base crit chance\`} values={inCategory.map((row) => row.crit)} binSize={0.05} max={0.6} fmt={(value) => pct(value)} xLabel="crit chance (last bar is 55%+)" color={COLOR[category]} />
        <Histogram title={\`\${category} base status chance\`} values={inCategory.map((row) => row.status)} binSize={0.05} max={0.6} fmt={(value) => pct(value)} xLabel="status chance (last bar is 55%+)" color={COLOR[category]} />
      </div>

      <Scatter title="Crit chance vs status chance, every weapon" xLabel="crit chance" yLabel="status chance" xFmt={(value) => pct(value)} yFmt={(value) => pct(value)}
        xMax={0.6} yMax={0.6} series={CATEGORIES.map((one) => ({ name: one, color: COLOR[one], points: rows.filter((row) => row.category === one).map((row) => ({ x: row.crit, y: row.status, label: rowLabel(row), extra: evolutionLines(row) })) }))}
        note="Capped at 60% on both axes (the few above sit on the edge). The empty top-right corner is DE's balancing: almost nothing gets high crit and high status at once." />

    </section>
  )
}

function CategoryPicker({ value, onChange }: { value: Category; onChange: (category: Category) => void }) {
  return <div className="row">{CATEGORIES.map((one) => <button key={one} className={one === value ? 'active' : ''} onClick={() => onChange(one)}>{one}</button>)}</div>
}

// ---- 1b. per subtype: shotguns vs snipers, glaives vs heavy blades. "Primary" lumps too much together ----
interface SubtypeStats { name: string; category: Category; members: Row[]; crit: number; critMultiplier: number; status: number; damage: number; fireRate: number }
type SortKey = 'name' | 'count' | 'crit' | 'critMultiplier' | 'status' | 'damage' | 'fireRate' | 'score'
const SORT_COLUMNS: { key: SortKey; label: string }[] = [{ key: 'name', label: 'Subtype' }, { key: 'count', label: 'Weapons' }, { key: 'crit', label: 'Crit' },
  { key: 'critMultiplier', label: 'Crit multi' }, { key: 'status', label: 'Status' }, { key: 'damage', label: 'Damage' }, { key: 'fireRate', label: 'Fire rate' }, { key: 'score', label: 'Median DPS (unmodded)' }]
function Subtypes({ rows, mode }: { rows: Row[]; mode: AttackMode }) {
  const [picked, setPicked] = useState('Shotgun')
  // click a header to sort by it (biggest first), again to flip, a third time back to the category grouping
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean } | null>(null)
  // the weapons' own numbers only: no mods anywhere in this section (the leaderboard section at the bottom has the builds)
  const scoreName = mode === 'heavy' ? 'unmodded heavy damage' : 'unmodded sustained DPS'
  const groups: SubtypeStats[] = [...new Set(rows.map((row) => \`\${row.category}/\${row.subtype}\`))].map((key) => {
    const members = rows.filter((row) => \`\${row.category}/\${row.subtype}\` === key)
    return { name: members[0].subtype, category: members[0].category, members, crit: median(members.map((row) => row.crit)),
      critMultiplier: median(members.map((row) => row.critMultiplier)), status: median(members.map((row) => row.status)),
      damage: median(members.map((row) => row.damage)), fireRate: median(members.map((row) => row.fireRate)) }
  }).sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || b.members.length - a.members.length)
  const medianScore = (group: SubtypeStats) => median(group.members.map((row) => row.baseDps))
  const group = groups.find((one) => one.name === picked) ?? groups[0]
  const sortValue = (one: SubtypeStats, key: SortKey): number | string => key === 'name' ? one.name : key === 'count' ? one.members.length : key === 'score' ? medianScore(one) : one[key]
  const sorted = !sort ? groups : [...groups].sort((a, b) => {
    const left = sortValue(a, sort.key)
    const right = sortValue(b, sort.key)
    const order = typeof left === 'string' ? left.localeCompare(right as string) : left - (right as number)
    return sort.descending ? -order : order
  })
  const categoryRows = rows.filter((row) => row.category === group.category)
  const versus = (value: number, overall: number, format: (v: number) => string) => \`\${value >= overall ? '+' : ''}\${format(value - overall)} vs all \${group.category.toLowerCase()}\`
  return (
    <section className="panel">
      <div className="row spread">
        <h2>By weapon subtype</h2>
      </div>
      <p className="muted">
        Guns split by type (rifles, shotguns, bows, snipers, launchers, spearguns, pistols, dual pistols, thrown), melee by the wiki's weapon classes
        (glaives, heavy blades, nikanas...). Medians throughout, and no mods: DPS is each weapon's own (innate passives and its Incarnon evolutions only). Click a column header to sort by it, click a row to dig into that subtype.
      </p>
      <Scatter title="Every subtype: median crit vs median status" xLabel="median crit chance" yLabel="median status chance" xFmt={(value) => pct(value)} yFmt={(value) => pct(value)}
        series={CATEGORIES.map((one) => ({ name: one, color: COLOR[one], points: groups.filter((one2) => one2.category === one).map((one2) => ({ x: one2.crit, y: one2.status, label: \`\${one2.name} (\${one2.members.length})\` })) }))}
        note="Each dot is a whole subtype. Hover for its name and size." />
      <div className="table-scroll">
        <table className="stat-table clickable">
          <thead><tr>{SORT_COLUMNS.map((column) => (
            <th key={column.key} className="sortable" onClick={() => setSort(sort?.key !== column.key ? { key: column.key, descending: column.key !== 'name' }
              : sort.descending === (column.key !== 'name') ? { key: column.key, descending: !sort.descending } : null)}>
              {column.key === 'score' && mode === 'heavy' ? 'Median heavy (unmodded)' : column.label}{sort?.key === column.key ? (sort.descending ? ' ▼' : ' ▲') : ''}
            </th>))}<th>Best weapon</th></tr></thead>
          <tbody>{sorted.map((one) => {
            const top = [...one.members].sort((a, b) => b.baseDps - a.baseDps)[0]
            return (
              <tr key={\`\${one.category}\${one.name}\`} className={one === group ? 'picked' : ''} onClick={() => setPicked(one.name)}>
                <td><i className="swatch" style={{ background: COLOR[one.category] }} />{one.name}</td><td>{one.members.length}</td><td>{pct(one.crit)}</td><td>{one.critMultiplier.toFixed(1)}x</td>
                <td>{pct(one.status)}</td><td>{big(one.damage)}</td><td>{one.fireRate.toFixed(2)}</td><td>{big(medianScore(one))}</td><td>{top?.name ?? '–'}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>

      <h3>{group.name} · {group.members.length} {group.category.toLowerCase()} weapon{group.members.length === 1 ? '' : 's'}</h3>
      <div className="tiles">
        <Tile label="median crit chance" value={pct(group.crit)} sub={versus(group.crit, median(categoryRows.map((row) => row.crit)), (value) => \`\${(value * 100).toFixed(0)} pts\`)} />
        <Tile label="median crit multiplier" value={\`\${group.critMultiplier.toFixed(1)}x\`} sub={versus(group.critMultiplier, median(categoryRows.map((row) => row.critMultiplier)), (value) => \`\${value.toFixed(1)}x\`)} />
        <Tile label="median status chance" value={pct(group.status)} sub={versus(group.status, median(categoryRows.map((row) => row.status)), (value) => \`\${(value * 100).toFixed(0)} pts\`)} />
        <Tile label="median base damage" value={big(group.damage)} sub={\`all \${group.category.toLowerCase()}: \${big(median(categoryRows.map((row) => row.damage)))}\`} />
        <Tile label={\`median \${scoreName}\`} value={big(medianScore(group))} sub={\`all \${group.category.toLowerCase()}: \${big(median(categoryRows.map((row) => row.baseDps)))}\`} />
        <Tile label="Incarnon available" value={\`\${group.members.filter((row) => row.incarnon).length} / \${group.members.length}\`} />
      </div>
      <div className="chart-grid">
        <Histogram title={\`\${group.name} base crit chance\`} values={group.members.map((row) => row.crit)} binSize={0.05} max={0.6} fmt={(value) => pct(value)} xLabel="crit chance (last bar is 55%+)" color={COLOR[group.category]} />
        <Histogram title={\`\${group.name} base status chance\`} values={group.members.map((row) => row.status)} binSize={0.05} max={0.6} fmt={(value) => pct(value)} xLabel="status chance (last bar is 55%+)" color={COLOR[group.category]} />
      </div>
      <Scatter title={\`\${group.name}: crit vs status\`} xLabel="crit chance" yLabel="status chance" xFmt={(value) => pct(value)} yFmt={(value) => pct(value)} xMax={0.6} yMax={0.6}
        series={[{ name: group.name, color: COLOR[group.category], points: group.members.map((row) => ({ x: row.crit, y: row.status, label: rowLabel(row), extra: evolutionLines(row) })) }]} />
      <Bars title={\`Top \${group.name.toLowerCase()} weapons, \${scoreName}\`} fmt={big} labelWidth={180}
        rows={[...group.members].sort((a, b) => b.baseDps - a.baseDps).slice(0, 12).map((row) => ({ label: rowLabel(row), value: row.baseDps, detail: row.evolutions.length ? \`Evolutions: \${row.evolutions.join(', ')}\` : undefined }))} />
    </section>
  )
}

// ---- 2. Enervate ----
// Secondary Enervate: "On Hit: Increase Critical Chance by 10%. Resets after 6 Big Critical Hit." the calc averages crit over a
// whole build-up-and-reset cycle (enervateAverageCrit in damage.ts): every hit adds 10%, and once crit is past 100% each hit is a
// Big Crit (orange or red) with chance crit - 100%. 6 of those and it's back to the start
function Enervate({ rows }: { rows: Row[] }) {
  // base crit only: Enervate drags every gun up to roughly the same crit, so the build's only crit source is Enervate itself and
  // the number that matters is the weapon's own base. 0..60% covers basically every secondary
  const baseCrits = Array.from({ length: 61 }, (_, index) => index * 0.01)
  const withEnervate = (base: number) => enervateAverageCrit(base, 0.1, 6)
  const secondaries = rows.filter((row) => row.category === 'Secondary')
  const medianBase = median(secondaries.map((row) => row.crit))
  const highBase = [...secondaries].sort((a, b) => b.crit - a.crit)[0]
  // the additive crit mods to compare against, straight from their max-rank text. Galvanized Crosshairs: "+120% Critical Chance when
  // Aiming ... On Weak Point Kill: +40% Critical Chance when Aiming for 12s. Stacks up to 5x", so 120 + 5 x 40 = +320% at full stacks
  const maxRankText = (name: string) => modsByName.get(name)?.levelStats.at(-1)?.join(' ') ?? ''
  const percents = (text: string) => [...text.matchAll(/\\+(\\d+(?:\\.\\d+)?)% Critical Chance/g)].map((match) => +match[1] / 100)
  const gambit = { name: 'Primed Pistol Gambit', value: percents(maxRankText('Primed Pistol Gambit'))[0] ?? 1.87 }
  const [crossBase = 1.2, crossStack = 0.4] = percents(maxRankText('Galvanized Crosshairs'))
  const crosshairs = crossBase + 5 * crossStack
  // Critical Deceleration is the shotgun one, its pistol twin is Creeping Bullseye: same "+200% Critical Chance, -20% Fire Rate"
  const bullseye = percents(maxRankText('Creeping Bullseye'))[0] ?? 2
  const crossAt = (bonus: number) => baseCrits.find((base) => base * (1 + bonus) >= enervateAverageCrit(base, 0.1, 6)) ?? 0.6
  const crossover = baseCrits.find((base) => base * (1 + gambit.value + crosshairs) >= enervateAverageCrit(base, 0.1, 6))
  return (
    <section className="panel">
      <h2>How much crit does Enervate actually give?</h2>
      <p className="muted">
        Secondary Enervate reads "+10% crit per hit, resets after 6 Big Critical Hits". Under 100% crit there are no big crits, so the stacks climb
        until crit passes 100%, then the 6 big crits that reset it come fast. Averaged over a whole cycle, almost every gun ends up a bit over 100%,
        whatever it started at. So these use the weapon's base crit with no other crit mods: the only crit source on the build is Enervate.
      </p>
      <div className="tiles">
        <Tile label="0% base crit" value={pct(withEnervate(0))} sub={\`+\${pct(withEnervate(0))} from Enervate\`} />
        <Tile label={\`median secondary (\${pct(medianBase)} base)\`} value={pct(withEnervate(medianBase))} sub={\`+\${pct(withEnervate(medianBase) - medianBase)} from Enervate\`} />
        <Tile label={\`highest base: \${highBase?.name ?? '–'} (\${pct(highBase?.crit ?? 0)})\`} value={pct(withEnervate(highBase?.crit ?? 0))} sub={\`+\${pct(withEnervate(highBase?.crit ?? 0) - (highBase?.crit ?? 0))} from Enervate\`} />
        <Tile label="0% vs 60% base, with Enervate" value={\`\${pct(withEnervate(0))} vs \${pct(withEnervate(0.6))}\`} sub="a 60 point base gap shrinks to this" />
      </div>
      <Lines title="Average crit chance with Enervate, by base crit" x={baseCrits} xFmt={(value) => pct(value)} yFmt={(value) => pct(value)} xLabel="weapon's base crit chance (no other crit mods)"
        series={[{ name: 'With Enervate', color: SERIES[1], values: baseCrits.map(withEnervate) },
          { name: 'Flat crit Enervate adds', color: SERIES[0], dashed: true, values: baseCrits.map((base) => withEnervate(base) - base) }]}
        note="Every 10 points of base crit only adds about 5 points after Enervate, because the higher start just means the stacks pass 100% and reset sooner. Base crit barely matters once Enervate is on." />
      <Lines title="Enervate vs crit mods, by base crit chance" x={baseCrits} xFmt={(value) => pct(value)} yFmt={(value) => pct(value)} xLabel="weapon's base crit chance"
        series={[{ name: 'Enervate alone', color: SERIES[1], values: baseCrits.map((base) => enervateAverageCrit(base, 0.1, 6)) },
          { name: \`\${gambit.name} + Galvanized Crosshairs\`, color: SERIES[0], values: baseCrits.map((base) => base * (1 + gambit.value + crosshairs)) },
          { name: \`\${gambit.name} alone\`, color: SERIES[2], values: baseCrits.map((base) => base * (1 + gambit.value)) },
          { name: 'Creeping Bullseye (Critical Deceleration)', color: '#9085e9', dashed: true, values: baseCrits.map((base) => base * (1 + bullseye)) }]}
        note={<>The mods multiply your base ({gambit.name} +{pct(gambit.value)}, Galvanized Crosshairs +{pct(crosshairs)} while aiming at 5 weak point kill stacks,
          +{pct(gambit.value + crosshairs)} together), so they're worth more the higher the base is. Enervate adds roughly the same flat chunk whatever the base,
          so it wins on low-crit guns: it beats both mods together below {crossover === undefined ? 'over 60%' : \`about \${pct(crossover)}\`} base crit,{' '}
          {gambit.name} alone below about {pct(crossAt(gambit.value))}, and Creeping Bullseye (+{pct(bullseye)}, but -20% fire rate) below about {pct(crossAt(bullseye))}.
          Critical Deceleration only goes on shotguns, Creeping Bullseye is the same mod for pistols.</>} />
    </section>
  )
}

// ---- 3. trends across updates ----
function Trends({ rows }: { rows: Row[] }) {
  const eras = [...new Set(rows.map((row) => row.era).filter((era): era is number => era !== null))].sort((a, b) => a - b)
  const inEra = (era: number, category?: Category) => rows.filter((row) => row.era === era && (!category || row.category === category))
  const firstHalf = rows.filter((row) => row.era !== null && row.era < 20)
  const secondHalf = rows.filter((row) => row.era !== null && row.era >= 30)
  return (
    <section className="panel">
      <h2>Trends across updates</h2>
      <p className="muted">
        Weapons grouped by the update they came out in (the wiki's "Introduced", in buckets of {ERA_SIZE} updates; Primes and variants count when they
        released, not when the original did). Medians, so one odd launcher doesn't swing a bucket.
      </p>
      <div className="tiles">
        <Tile label="median crit, Update 0–19" value={pct(median(firstHalf.map((row) => row.crit)))} sub={\`\${firstHalf.length} weapons\`} />
        <Tile label="median crit, Update 30+" value={pct(median(secondHalf.map((row) => row.crit)))} sub={\`\${secondHalf.length} weapons\`} />
        <Tile label="median status, Update 0–19" value={pct(median(firstHalf.map((row) => row.status)))} />
        <Tile label="median status, Update 30+" value={pct(median(secondHalf.map((row) => row.status)))} />
      </div>
      <Lines title="Median base crit and status chance by release" x={eras} xTickLabels xFmt={eraLabel} yFmt={(value) => pct(value)}
        series={[{ name: 'Crit chance', color: SERIES[0], values: eras.map((era) => median(inEra(era).map((row) => row.crit))) },
          { name: 'Status chance', color: SERIES[1], values: eras.map((era) => median(inEra(era).map((row) => row.status))) }]} />
      <Lines title="Median crit multiplier by release" x={eras} xTickLabels xFmt={eraLabel} yFmt={(value) => \`\${value.toFixed(1)}x\`} yMin={1}
        series={[{ name: 'Crit multiplier', color: SERIES[2], values: eras.map((era) => median(inEra(era).map((row) => row.critMultiplier))) }]} />
      <Lines title="Weapons released per bucket" x={eras} xTickLabels xFmt={eraLabel} yFmt={(value) => String(Math.round(value))}
        series={CATEGORIES.map((one) => ({ name: one, color: COLOR[one], values: eras.map((era) => inEra(era, one).length) }))} />
    </section>
  )
}

// ---- 4. Prime vs the original ----
function PrimeUplift({ rows }: { rows: Row[] }) {
  const byName = new Map(rows.map((row) => [row.name, row]))
  const pairs = rows.filter((row) => row.name.endsWith(' Prime') && byName.has(row.name.replace(/ Prime$/, ''))).map((prime) => [byName.get(prime.name.replace(/ Prime$/, ''))!, prime] as const)
  const change = (pick: (row: Row) => number) => median(pairs.map(([base, prime]) => (pick(base) > 0 ? pick(prime) / pick(base) - 1 : 0)))
  const stats: { label: string; pick: (row: Row) => number }[] = [
    { label: 'Crit chance', pick: (row) => row.crit }, { label: 'Crit multiplier', pick: (row) => row.critMultiplier }, { label: 'Status chance', pick: (row) => row.status },
    { label: 'Base damage', pick: (row) => row.damage }, { label: 'Fire rate', pick: (row) => row.fireRate }]
  const betterAt = (pick: (row: Row) => number) => pairs.filter(([base, prime]) => pick(prime) > pick(base) + 1e-9).length
  return (
    <section className="panel">
      <h2>What a Prime actually changes</h2>
      <p className="muted">{pairs.length} weapons that have both a regular and a Prime version, compared attack to attack.</p>
      <table className="stat-table">
        <thead><tr><th>Stat</th><th>Median change</th><th>Prime is higher</th><th>Same</th><th>Prime is lower</th></tr></thead>
        <tbody>{stats.map((stat) => {
          const higher = betterAt(stat.pick)
          const lower = pairs.filter(([base, prime]) => stat.pick(prime) < stat.pick(base) - 1e-9).length
          const value = change(stat.pick)
          return <tr key={stat.label}><td>{stat.label}</td><td>{value >= 0 ? '+' : ''}{pct(value)}</td><td>{higher}</td><td>{pairs.length - higher - lower}</td><td>{lower}</td></tr>
        })}</tbody>
      </table>
      <Bars title="Biggest base damage jumps, Prime over the original" fmt={(value) => \`+\${pct(value)}\`}
        rows={pairs.map(([base, prime]) => ({ label: prime.name, value: base.damage > 0 ? prime.damage / base.damage - 1 : 0, detail: \`\${big(base.damage)} → \${big(prime.damage)}\` }))
          .filter((row) => row.value > 0).sort((a, b) => b.value - a.value).slice(0, 12)} />
    </section>
  )
}

// ---- 5. what the leaderboard picks ----
// heavies only show up on the single-hit boards (sustained is the stance combo), so a board with nothing for this attack mode
// falls back to Single hit
const usableBoard = (board: Leaderboard | null | undefined, key: string) => (!board || board.boards[key]?.length ? key : 'single')
// each weapon's best entry on a board (a weapon has one row per attack)
function bestPerWeapon(board: Leaderboard | null | undefined, boardKey: string) {
  const out = new Map<string, LeaderboardEntry>()
  for (const entry of board?.boards[boardKey] ?? []) if ((out.get(entry.weaponName)?.score ?? -1) < entry.score) out.set(entry.weaponName, entry)
  return [...out.values()]
}
const BOARD_CHOICES = [{ key: 'sustained', label: 'Sustained DPS' }, { key: 'window3', label: '3 s window' }, { key: 'single', label: 'Single hit' }]
function LeaderboardMeta({ rows, board }: { rows: Row[]; board: Leaderboard | null | undefined }) {
  const [category, setCategory] = useState<Category>('Primary')
  const [subtype, setSubtype] = useState('All')
  const [chosenKey, setBoardKey] = useState('sustained')
  const boardKey = usableBoard(board, chosenKey)
  const best = useMemo(() => bestPerWeapon(board, boardKey), [board, boardKey])
  if (board === undefined) return <section className="panel"><h2>What the leaderboard picks</h2><p className="muted">Loading the leaderboard…</p></section>
  if (!board) return <section className="panel"><h2>What the leaderboard picks</h2><p className="muted">Couldn't load the leaderboard.</p></section>

  const subtypeByName = new Map(rows.map((row) => [row.name, row.subtype]))
  const subtypes = [...new Set(rows.filter((row) => row.category === category).map((row) => row.subtype))].sort()
  const builds = best.filter((entry) => entry.category === category && (subtype === 'All' || subtypeByName.get(entry.weaponName) === subtype))
  const share = (count: number) => count / Math.max(1, builds.length)
  const tally = (names: string[]) => {
    const counts = new Map<string, number>()
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }
  const modRows = tally(builds.flatMap((entry) => [...new Set(entry.mods.map((mod) => mod.name))])).slice(0, 15).map(([label, count]) => ({ label, value: share(count), detail: \`\${count} of \${builds.length} builds\` }))
  const arcaneRows = tally(builds.map((entry) => entry.arcane?.name ?? 'No arcane')).slice(0, 8).map(([label, count]) => ({ label, value: share(count), detail: \`\${count} of \${builds.length} builds\` }))
  const elements = new Map<string, number>()
  for (const entry of builds) for (const part of entry.stats.damageTypes) elements.set(part.type, (elements.get(part.type) ?? 0) + part.share / builds.length)
  const elementRows = [...elements.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([type, value]) => ({ label: type[0].toUpperCase() + type.slice(1), value }))
  const incarnonWins = builds.filter((entry) => entry.incarnonForm).length
  const top10 = [...builds].sort((a, b) => b.score - a.score).slice(0, 10)

  // base stats vs score: which base stat best predicts where a weapon lands
  const rowByName = new Map(rows.map((row) => [row.name, row]))
  const joined = builds.map((entry) => ({ entry, row: rowByName.get(entry.weaponName) })).filter((pair): pair is { entry: LeaderboardEntry; row: Row } => !!pair.row && pair.entry.score > 0)
  const scores = joined.map((pair) => pair.entry.score)
  const predictors: { label: string; pick: (row: Row) => number }[] = [
    { label: 'Base crit chance', pick: (row) => row.crit }, { label: 'Base crit multiplier', pick: (row) => row.critMultiplier },
    { label: 'Base status chance', pick: (row) => row.status }, { label: 'Base damage', pick: (row) => row.damage }, { label: 'Fire rate', pick: (row) => row.fireRate }]
  const scoreName = BOARD_CHOICES.find((choice) => choice.key === boardKey)!.label
  return (
    <section className="panel">
      <div className="row spread">
        <h2>What the leaderboard picks</h2>
        <div className="row">
          <select value={boardKey} onChange={(event) => setBoardKey(event.target.value)}>{BOARD_CHOICES.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}</select>
          <CategoryPicker value={category} onChange={(next) => { setCategory(next); setSubtype('All') }} />
          <select value={subtype} onChange={(event) => setSubtype(event.target.value)}>
            <option value="All">All {category.toLowerCase()}</option>{subtypes.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      </div>
      <p className="muted">Each weapon's best build on the {scoreName} board ({builds.length} {subtype === 'All' ? category.toLowerCase() : subtype.toLowerCase()} weapons), neutral target, no rivens.{boardKey === 'single' ? ' Guns score single hits on headshots, so Acuity and weak point builds show up there.' : ''}</p>
      <div className="tiles">
        <Tile label="median score" value={big(median(builds.map((entry) => entry.score)))} />
        <Tile label="best weapon" value={top10[0]?.weaponName ?? '–'} sub={top10[0] ? big(top10[0].score) : undefined} />
        <Tile label="builds where the Incarnon form wins" value={pct(share(incarnonWins))} sub={\`\${incarnonWins} weapons\`} />
        <Tile label="top 10 that are Incarnon" value={\`\${top10.filter((entry) => entry.incarnonForm).length} / 10\`} />
      </div>
      <div className="chart-grid">
        <Bars title="Most picked mods (share of builds)" rows={modRows} fmt={(value) => pct(value)} />
        <div>
          <Bars title="Arcane picks" rows={arcaneRows} fmt={(value) => pct(value)} />
          <Bars title="Average damage mix" rows={elementRows} fmt={(value) => pct(value)} note="Each build's share of damage by type, averaged over the builds." />
        </div>
      </div>
      <h3>Does a good base stat mean a high rank?</h3>
      <table className="stat-table">
        <thead><tr><th>Base stat</th><th>Rank correlation with score</th><th>Reads as</th></tr></thead>
        <tbody>{predictors.map((predictor) => {
          const rho = spearman(joined.map((pair) => predictor.pick(pair.row)), scores)
          const strength = Math.abs(rho) >= 0.5 ? 'strong' : Math.abs(rho) >= 0.3 ? 'moderate' : Math.abs(rho) >= 0.1 ? 'weak' : 'none'
          return <tr key={predictor.label}><td>{predictor.label}</td><td>{rho.toFixed(2)}</td><td>{strength}{strength !== 'none' ? (rho > 0 ? ', higher is better' : ', higher is worse') : ''}</td></tr>
        })}</tbody>
      </table>
      <p className="muted">Spearman rank correlation over {joined.length} weapons: 1 means ranking weapons by that stat gives the leaderboard order exactly, 0 means it tells you nothing.</p>
      {joined.length > 0 && <Scatter title={\`Base crit chance vs \${scoreName}\`} xLabel="base crit chance" yLabel={scoreName} logY xFmt={(value) => pct(value)} yFmt={big}
        series={[{ name: category, color: COLOR[category], points: joined.map((pair) => ({ x: pair.row.crit, y: pair.entry.score, label: rowLabel(pair.row), extra: evolutionLines(pair.row) })) }]}
        note="Log scale on the score, the top weapons are orders of magnitude above the bottom ones." />}
    </section>
  )
}
`,T=`// weapons that reload one shell at a time (wiki Reload_Speed lists them). total reload =
// (start + end delay + per shell x magazine) / (1 + reload speed), so a bigger magazine means a longer reload.
// numbers from each weapon's wiki page, they add up to the data's reload time at base magazine
export const SHELL_BY_SHELL_RELOAD: Record<string, { delay: number; perShell: number }> = {
  Felarx: { delay: 0.8 + 0.5, perShell: 0.4 }, // 6 shells -> 3.7s
  Strun: { delay: 0.5 + 0.25, perShell: 0.5 }, // 6 -> 3.75s
  'Mk1-Strun': { delay: 0.5 + 0.25, perShell: 0.5 }, // 6 -> 3.75s
  'Strun Prime': { delay: 0.6, perShell: 0.4 }, // 10 -> 4.6s
  'Strun Wraith': { delay: 0.25 + 0.25, perShell: 0.45 }, // 10 -> 5s
  Corinth: { delay: 1.2, perShell: 0.22 }, // 5 -> 2.3s (Corinth Prime reloads the whole magazine)
  Zarr: { delay: 0.75, perShell: 0.5 }, // 3 -> 2.25s
}
`,E=`// which kind of attack a leaderboard entry is, for the attack-type filter. the export has no such field, so it's the
// weapon category + the data's AoE flag (explosions, radial hits) + the attack name. names are free text, so the
// alt-fire list is a best guess: anything that isn't recognised as alt-fire on a gun counts as primary fire
import type { Attack, Weapon } from '../types'

export type AttackKind = 'normal' | 'heavy' | 'slam' | 'meleeOther' | 'primaryFire' | 'altFire' | 'aoe' | 'incarnon'

export const ATTACK_KINDS: { id: AttackKind; label: string; melee: boolean }[] = [
  { id: 'normal', label: 'Normal attacks', melee: true },
  { id: 'heavy', label: 'Heavy attacks / glaive detonations', melee: true },
  { id: 'slam', label: 'Slams', melee: true },
  { id: 'meleeOther', label: 'Throws / other melee', melee: true },
  { id: 'primaryFire', label: 'Primary fire', melee: false },
  { id: 'altFire', label: 'Alt-fire', melee: false },
  { id: 'aoe', label: 'Explosions / AoE', melee: false },
  { id: 'incarnon', label: 'Incarnon form', melee: false },
]

const ALT_FIRE = /alt[- ]?fire|secondary fire|cannon mode|barrage mode|lock-?on|grenade|air burst|harpoon|throw|cube|bubble|orb|spectral|glaive|plasma bomb|cluster bomb|attraction field|soul swarm|energy disk|energy wave|corrosive (wave|pool|dot)|spore|disc/i

export function attackKind(weapon: Weapon, attack: Pick<Attack, 'name' | 'isAoE' | 'heavy'>): AttackKind {
  const name = attack.name
  if (weapon.category === 'Melee') {
    if (/slam/i.test(name)) return 'slam'
    // glaive detonations are heavies too (build-data marks them)
    if (/heavy attack/i.test(name) || attack.heavy) return 'heavy'
    if (/^normal attack$/i.test(name)) return 'normal'
    return 'meleeOther'
  }
  if (/incarnon/i.test(name)) return 'incarnon'
  if (attack.isAoE || /explosion|detonation|radial|\\baoe\\b|cloud|blast|collapse|merging/i.test(name)) return 'aoe'
  if (ALT_FIRE.test(name)) return 'altFire'
  return 'primaryFire'
}
`,D=`// the Boss Damage leaderboard: one tough target that doesn't die and takes status capped. built by
// \`npm run leaderboard -- --boss\` into public/boss-leaderboard.json, separate from the main boards so neither one
// reruns the other.
//  - status capped at 4 stacks of each type (most bosses; Heat, Slash, Viral... stop growing early)
//  - no kills: every on-kill conditional is off (Deadhead, Merciless, Galvanized stacks, Bladed Rounds, kill passives)
//  - perks bosses ignore are off (Devouring Attrition), gauge-gated alt-fires are left out (they need kills or a meter)
//  - otherwise the neutral scenario: no faction, no armor, body shots, sustained DPS over the 10 s fight
import { calculate } from '../calc/damage'
import { resolveCoBehavior } from '../calc/conditionOverload'
import { optimizeAttack, type OptimizedBuild } from './optimize'
import { TTK_OBJECTIVE, type BoardSpec } from './objectives'
import { STEEL_PATH_LEVEL_BONUS, scaleArmor, scaleHealth, scaleShield } from '../calc/target'
import { toEntry, type WeaponEntry } from './leaderboardWeapon'
import { SCENARIO_BUFFS, SCENARIO_DEBUFFS, SCENARIO_TARGET } from './scenario'
import type { TargetSettings, Weapon } from '../types'

// the Boss board: time to kill a Steel Path hardmode boss, solo. one ranking per boss, each its own target:
//  - level-scaled health / shields / armor from the wiki's Module:Enemies/data, Steel Path on (+100 levels, x2.5 health/shields)
//  - status capped at 4 stacks of each type, no kills (on-kill conditionals off: Deadhead, Merciless, Galvanized stacks...)
//  - perks bosses ignore are off (Devouring Attrition), gauge-gated alt-fires left out (they need kills or a meter)
//  - scored on time to kill (damage.ts timeToReach): shields first, then health, reloads / Incarnon refills / DoTs included
//  - damage attenuation (simulate.ts attenuatedTimeToKill): Update 40 made it "proportional to Max Health" for "True Bosses /
//    HUD Health Bar enemies", but no boss's new numbers are published. the only post-rework ones on the wiki are Hemocyte's
//    ("Max Damage Per Hit = 0.05 x Maximum Health", "DPS Damage Attenuation that is based on 20% of the Hemocyte's maximum
//    health"), so both bosses get those: 5% of max health per trigger, 20% per second. Lephantis's page backs the per-trigger
//    part ("Damage Attenuation that is based on 5% of its maximum health", MaxPeakDamageHealthPercent), the per-second one is
//    still Hemocyte's alone. multi-pellet weapons get 0.7x the per-trigger cap (damage.ts SHOTGUN_COMPENSATION).
//    Janus Vor is a judgment call: Update 42 "Removed the old damage attenuation (that we no longer use) from Captain Vor",
//    and he isn't on the standardized list, but he has a HUD health bar. he keeps attenuation and the boards say untested
// not modeled: invulnerable phases (Vor's shielded phases, the turrets), adds, movement
export const BOSS_ATTENUATION = { perTrigger: 0.05, perSecond: 0.2 }
export interface BossTarget { key: string; name: string; note: string; target: TargetSettings; armor: number }
const bossTarget = (stats: { faction: string; health: number; shield: number; armor: number; spawnLevel: number }, extra: Partial<TargetSettings>) => {
  const levelsAboveBase = stats.spawnLevel - 1 // base level 1 on both
  const settings: TargetSettings = {
    ...SCENARIO_TARGET, faction: stats.faction, layer: 'health', enemyId: null, baseLevel: 1, level: stats.spawnLevel - STEEL_PATH_LEVEL_BONUS,
    steelPath: true, statusMode: 'capped', attenuation: BOSS_ATTENUATION,
    pool: { health: scaleHealth(stats.health, levelsAboveBase, stats.faction, true), shield: scaleShield(stats.shield, levelsAboveBase, stats.faction, true) },
    ...extra,
  }
  return { target: settings, armor: scaleArmor(stats.armor, levelsAboveBase) }
}
export const BOSSES: BossTarget[] = [
  {
    // wiki Janus Captain Vor: "Health = 7500, Shield = 2750, Armor = 250", "SpawnLevel = 375", Steel Path Tolstoj, "Solo: 1x
    // health", "Janus Captain Vor is immune to armor reduction". Grineer
    key: 'boss-janus-vor', name: 'Janus Captain Vor',
    note: 'Steel Path hardmode Vor at level 375, solo: shields then health, armor 250 scaled (2,700 cap) and immune to armor reduction',
    ...bossTarget({ faction: 'Grineer', health: 7500, shield: 2750, armor: 250, spawnLevel: 375 }, { armorStripImmune: true }),
  },
  {
    // wiki The Fragmented One: "Health = 50000", "SpawnLevel = 225" (solo), The Murmur (Viral x0.5), "Viral damage resistance and
    // immunity to Viral status". no shields or armor. Update 40, The Fragmented: "Steel Path / Deep Archimedea base health
    // bonus: 150,000", so 200,000 base before level scaling
    key: 'boss-fragmented-one', name: 'The Fragmented One',
    note: 'Steel Path hardmode Fragmented at level 225, solo: health only (200,000 base with the Steel Path bonus), Viral resisted and no Viral status',
    ...bossTarget({ faction: 'The Murmur', health: 200000, shield: 0, armor: 0, spawnLevel: 225 }, { statusImmune: ['viral'] }),
  },
]
export const BOSS_BOARDS: BoardSpec[] = BOSSES.map((boss) => ({ key: boss.key, objective: TTK_OBJECTIVE, allowFireRateMods: true }))
const scenarioFor = (boss: BossTarget) => ({ target: boss.target, armor: boss.armor, debuffs: SCENARIO_DEBUFFS, buffs: SCENARIO_BUFFS })
export const BOSS_DESCRIPTION =
  'Boss boards: time to kill a Steel Path hardmode boss solo (Janus Captain Vor, The Fragmented One), level-scaled from the wiki, status capped at 4 stacks of each type, no kills (every on-kill conditional off), Devouring Attrition off (bosses ignore it), weapons that don\\'t work on bosses left off (Shadow Clones, Shattered Lash), body shots, reloads / Incarnon refills / DoT ticks as they land, melee Normal Attacks as the best stance combo at max combo, rank 30 with enough Forma, no rivens. Damage attenuation is guessed at Hemocyte\\'s published share (5% of max health per trigger, 20% per second). Invulnerable phases and adds aren\\'t modeled.'

// perks bosses ignore. wiki Laetum, Devouring Attrition: "Multiplicative to base damage sources such as Hornet Strike.
// Bosses ignore this perk." Phenmor has the same perk, so it's out there too. Felarx's Devastating Attrition has no
// such note on its page, so it stays
const BOSS_IGNORED_PERKS = ['Devouring Attrition']

// weapons that don't work on bosses, left off the board entirely. Shadow Clones (Blade Storm) can't hit boss targets,
// Shattered Lash is buggy against them. add more here as they turn up
const BOSS_EXCLUDED_WEAPONS = /^(Shadow Clones|Shattered Lash)( Prime)?$/

// same attacks the main boards rank, minus heavies (they eat the combo, so they're never DPS)
const rankedAttacks = (weapon: Weapon) => weapon.attacks.filter(
  (attack) => Object.values(attack.damage).some((amount) => amount > 0) && !/reload|expiry|turret/i.test(attack.name) && !attack.headshotOnly && !attack.heavy
    // gauge-gated alt-fires (Trumna, Sepulcrum, Higasa: kills; Grimoire, Nunchasa: hits) are one volley now and then,
    // never sustained DPS, and the kill ones can't fire at all on a boss that doesn't die
    && !attack.altGate,
)

export function optimizeWeaponBoss(weapon: Weapon): Record<string, WeaponEntry[]> {
  const boards: Record<string, WeaponEntry[]> = Object.fromEntries(BOSSES.map((boss) => [boss.key, []]))
  if (BOSS_EXCLUDED_WEAPONS.test(weapon.name)) return boards
  for (const boss of BOSSES) {
    const scenario = scenarioFor(boss)
    const found = new Map<string, OptimizedBuild>()
    for (const attack of rankedAttacks(weapon)) {
      let best = optimizeAttack(weapon, attack, TTK_OBJECTIVE, true, 'biggestHit', { scenario, noKills: true, excludedPerkNames: BOSS_IGNORED_PERKS })
      // a whole shot is at least as good as each part's build on it (the beam search can miss it)
      for (const part of attack.parts ?? []) {
        const other = found.get(part)
        if (!other) continue
        const result = calculate({
          weapon, attack, mods: other.mods, arcane: other.arcane, coBehavior: resolveCoBehavior(weapon, attack), incarnonPerks: other.perks,
          passives: other.passives, bonusElement: other.bonusElement, heavyMode: 'biggestHit', ...scenario,
        })
        const score = TTK_OBJECTIVE.score(result)
        if (score > best.score) best = { ...other, attack, result, score }
      }
      // the search ran on the quick attenuation estimate, the board shows the full timeline for the build it picked
      const exact = calculate({
        weapon, attack, mods: best.mods, arcane: best.arcane, coBehavior: resolveCoBehavior(weapon, attack), incarnonPerks: best.perks,
        passives: best.passives, bonusElement: best.bonusElement, heavyMode: 'biggestHit', ...scenario, target: { ...scenario.target, exactTimeToKill: true },
      })
      best = { ...best, result: exact, score: TTK_OBJECTIVE.score(exact) }
      found.set(attack.name, best)
      if (best.score > 0) boards[boss.key].push(toEntry(best))
    }
  }
  return boards
}
`,O=`// runs the Damage Cap ladder off the main thread
import { runCapLadder, type CapPath, type CapRequest, type CapStepResult } from './damageCap'

export type CapMessage =
  | { type: 'step'; id: number; result: CapStepResult }
  | { type: 'paths'; id: number; paths: CapPath[]; defaultPath: number }
  | { type: 'done'; id: number }
  | { type: 'error'; id: number; message: string }

self.onmessage = (event: MessageEvent<{ id: number; request: CapRequest }>) => {
  const { id, request } = event.data
  try {
    runCapLadder(
      request,
      (result) => self.postMessage({ type: 'step', id, result } satisfies CapMessage),
      (paths, defaultPath) => self.postMessage({ type: 'paths', id, paths, defaultPath } satisfies CapMessage),
    )
    self.postMessage({ type: 'done', id } satisfies CapMessage)
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error) } satisfies CapMessage)
  }
}
`,k=`// the Compare tab: optimize one weapon attack several times, each under a different set of rules (a "path"), for a
// few goals. pure data in and out so it can run in a Web Worker (src/optimizer/compareWorker.ts) and in tests
import { arcanesById, modsById, weaponsById } from '../data'
import { rivenMod, type RivenConfig, RIVEN_MOD_ID } from '../calc/riven'
import { equipArcane, equipMod, optimizeAttack, critViolation, type OptimizeConstraints, type OptimizedBuild } from './optimize'
import { BOARDS, boardKey } from './objectives'
import { toEntry, type WeaponEntry } from './leaderboardWeapon'
import type { Buffs, Debuffs, EquippedMod, TargetSettings } from '../types'

export interface ComparePath {
  name: string
  lockedModIds: string[]
  excludedModNames: string[]
  riven: RivenConfig | null // always locked in when set
  lockedArcaneId: string | 'none' | null // null = search picks
  excludedArcaneIds: string[]
  lockedPerks: Record<string, string | null> // tier -> perk, null = no perk in that tier
  excludedPerkNames: string[]
  maxCritChance: number | null // fractions, 0.5 = 50%
  minCritChance: number | null
}

export interface CompareScenario {
  target: TargetSettings
  armor: number
  debuffs: Debuffs
  buffs: Buffs
}

export interface CompareRequest {
  weaponId: string
  attackIndex: number
  boards: string[] // leaderboard board keys: 'sustained', 'single', 'window10-nofr'...
  paths: ComparePath[]
  scenario: CompareScenario | null // null = the leaderboard's neutral scenario
  thorough: boolean // wider beam: slower, finds a bit more under tight rules
}

export interface CompareResult {
  pathIndex: number
  board: string
  entry: WeaponEntry // same shape as a leaderboard entry, mods by uniqueName
  critMiss: number // how far outside the crit limits it ended up, 0 = inside
  usedFireRateMods: boolean
}

export const emptyPath = (name: string): ComparePath => ({
  name, lockedModIds: [], excludedModNames: [], riven: null, lockedArcaneId: null, excludedArcaneIds: [], lockedPerks: {},
  excludedPerkNames: [], maxCritChance: null, minCritChance: null,
})

function constraintsFor(request: CompareRequest, path: ComparePath): OptimizeConstraints {
  const weapon = weaponsById.get(request.weaponId)!
  const isMelee = weapon.category === 'Melee'
  const lockedMods: EquippedMod[] = path.lockedModIds.flatMap((id) => {
    const mod = modsById.get(id)
    return mod ? [equipMod(mod, isMelee)] : []
  })
  const riven = path.riven ? rivenMod(weapon, path.riven) : null
  if (riven) lockedMods.push({ mod: riven, rank: riven.fusionLimit, conditionalStacks: 0 })
  const arcane = path.lockedArcaneId && path.lockedArcaneId !== 'none' ? arcanesById.get(path.lockedArcaneId) : undefined
  return {
    lockedMods,
    excludedModNames: path.excludedModNames,
    lockedArcane: path.lockedArcaneId === 'none' ? 'none' : arcane ? equipArcane(arcane, isMelee) : null,
    excludedArcaneIds: path.excludedArcaneIds,
    lockedPerks: path.lockedPerks,
    excludedPerkNames: path.excludedPerkNames,
    maxCritChance: path.maxCritChance,
    minCritChance: path.minCritChance,
    scenario: request.scenario,
    beamWidth: request.thorough ? 16 : 8,
  }
}

// one path on one board, the leaderboard's way: fire-rate boards also try the no-fire-rate build and keep the better
export function runPath(request: CompareRequest, pathIndex: number, board: string): CompareResult {
  const weapon = weaponsById.get(request.weaponId)!
  const attack = weapon.attacks[request.attackIndex] ?? weapon.attacks[0]
  const spec = BOARDS.find((candidate) => candidate.key === board)!
  const constraints = constraintsFor(request, request.paths[pathIndex])
  const build = (allowFireRate: boolean): OptimizedBuild => optimizeAttack(weapon, attack, spec.objective, allowFireRate, spec.heavyMode ?? 'biggestHit', constraints)
  const score = (candidate: OptimizedBuild) => (critViolation(candidate.result.critChance, constraints) > 0 ? candidate.score * 1e-6 : candidate.score)
  let best = build(spec.allowFireRateMods)
  let usedFireRateMods = spec.allowFireRateMods
  if (spec.allowFireRateMods && spec.objective.usesFireRate) {
    const without = build(false)
    if (score(without) > score(best)) {
      best = without
      usedFireRateMods = false
    }
  }
  return { pathIndex, board, entry: toEntry(best), critMiss: critViolation(best.result.critChance, constraints), usedFireRateMods }
}

// the board keys this attack can be ranked on (heavies skip the fire-rate ones like the leaderboard does)
export const boardsFor = (attack: { heavy?: boolean }) =>
  BOARDS.filter((spec) => !spec.heavyOnly && !(attack.heavy && spec.objective.usesFireRate)).map((spec) => spec.key)

export const isRivenId = (id: string) => id === RIVEN_MOD_ID
export { boardKey }
`,A=`// runs Compare tab requests off the main thread so the page doesn't freeze while it searches
import { runPath, type CompareRequest, type CompareResult } from './compare'

export type CompareMessage =
  | { type: 'progress'; id: number; done: number; total: number; result: CompareResult }
  | { type: 'done'; id: number }
  | { type: 'error'; id: number; message: string }

self.onmessage = (event: MessageEvent<{ id: number; request: CompareRequest }>) => {
  const { id, request } = event.data
  const jobs = request.boards.flatMap((board) => request.paths.map((_, pathIndex) => ({ board, pathIndex })))
  try {
    jobs.forEach(({ board, pathIndex }, index) => {
      const result = runPath(request, pathIndex, board)
      self.postMessage({ type: 'progress', id, done: index + 1, total: jobs.length, result } satisfies CompareMessage)
    })
    self.postMessage({ type: 'done', id } satisfies CompareMessage)
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error) } satisfies CompareMessage)
  }
}
`,j=`// Damage Cap tab: how much has to stack up for one hit of a weapon to pass the damage limit. a ladder where each step
// adds a layer and is optimized for the biggest single instance:
//   1. mods, weapon arcane and Incarnon   2. + headshot
//   3. + solo priming: the statuses the build applies itself plus what a Diriga primes, kept on through steps 4-6
//   4. + Warframe arcanes and 5. + Archon Shards: what any Warframe gets without casting anything (Arcane Avenger,
//      Violet crit damage with the frame mods picked for Energy)
//   6. + your Warframe: its own abilities/augments, one Helminth subsume (in a slot it can actually go in), a real
//      frame mod build (8 slots + aura + exilus, frameBuild.ts), and the shards/arcanes re-picked now Strength matters
//   7. + enemy debuffs maxed (every status for CO, Viral 10...)   8. + allies' abilities
// steps 1-6 are doable solo, 7-8 need a team (or a lot of setup)
// the Warframe steps search every Warframe (or use the Calculator's Warframe panel). setups are scored on the previous step's
// build with a reference Strength first, then the best few get their frame mods picked and the weapon mods re-optimized
import { arcanes, warframes, warframeBaseName, weaponsById } from '../data'
import { SHARD_SLOTS, shardBuffsById, rank30Energy, type ShardSlot } from '../data/archonShards'
import { describeLoadout, evaluateFrame, optimizeFrameMods, REGULAR_SLOTS, type FrameEval, type FrameLoadout, type FrameSpec } from './frameBuild'
import { calculate, type CalcResult } from '../calc/damage'
import { resolveCoBehavior } from '../calc/conditionOverload'
import type { Warframe } from '../types'
import { rivenMod, type RivenConfig } from '../calc/riven'
import { STATUS_EFFECTS, STATUS_TYPES, maxComboFor } from '../calc/constants'
import type { HeavyMode } from '../data/heavyAttacks'
import {
  SUBSUMABLE, WARFRAME_ABILITIES, abilitiesById, canSubsumeInto, helpsAllies, modeledVariants,
  type AbilityCast, type WarframeAbility, type WarframeState,
} from '../data/warframeAbilities'
import { optimizeAttack, type OptimizeConstraints, type OptimizedBuild } from './optimize'
import { exaltedRuleFor } from '../data/exalted'
import type { Objective } from './objectives'
import { toEntry, type WeaponEntry } from './leaderboardWeapon'
import type { CompareScenario } from './compare'
import type { Buffs, Debuffs, TargetSettings } from '../types'

export interface CapStep {
  id: 'mods' | 'head' | 'debuffs' | 'frame' | 'shards' | 'frameArcanes' | 'priming' | 'allies'
  label: string
  description: string
}

export const CAP_STEPS: CapStep[] = [
  { id: 'mods', label: 'Mods, arcane & Incarnon', description: 'Best 8 mods (conditionals at max), weapon arcane, Incarnon perks' },
  { id: 'head', label: '+ Headshot', description: 'Weak point multiplier, and headcrits where the faction has them' },
  { id: 'priming', label: '+ Solo priming', description: 'Only the statuses your build applies (at max stacks), plus a Diriga primer (Impact, Puncture, Slash, Electricity + 3 modded elements). Its damage isn\\'t counted. Kept on through the Warframe steps after it' },
  { id: 'frameArcanes', label: '+ Warframe arcanes', description: 'The best two Warframe arcanes that work on any Warframe without casting anything (Arcane Avenger...)' },
  { id: 'shards', label: '+ Archon Shards', description: 'The best 5 Tauforged shards on any Warframe, with frame mods picked for them (Violet crit damage doubles past 500 Energy, so a Flow mod / Azure shard can earn a slot)' },
  { id: 'frame', label: '+ Your Warframe', description: 'Its own abilities and augments, one Helminth subsume in a slot it can replace, the best frame mods (8 slots, aura, exilus), and the shards and arcanes re-picked now that Strength matters (Molt Augmented, Crimson shards)' },
  { id: 'debuffs', label: '+ Enemy debuffs (maxed)', description: 'Every status type on the target (CO / Galvanized), 10 Viral, 10 Corrosive + full Heat strip, 10 Cold, 5 Puncture, 10 Tau, lifted' },
  { id: 'allies', label: '+ Allies', description: 'Teammates\\' abilities (external Nourish, Roar...), at their strength' },
]

const COMPRESSION_ID = arcanes.filter((arcane) => arcane.name === 'Primary Compression').map((arcane) => arcane.uniqueName)

export interface CapRequest {
  weaponId: string
  attackIndex: number
  heavyMode: HeavyMode
  scenario: CompareScenario // the calculator's target (faction, level, armor) and Warframe panel
  riven: RivenConfig | null // locked into every step
  thorough: boolean
  frameMode: 'search' | 'panel' // find the best Warframe setup, or use the Calculator's Warframe panel
  allyStrength: number
  allyCount: number
  meleeHeadshots: boolean // most melee can't reliably headshot, so off unless asked
  allowCompression: boolean // Primary Compression shrinks the AoE (Niche), so it's only in the pool when asked
}

// one Warframe setup carried through the last four steps
export interface CapPath {
  index: number
  label: string // "Excalibur: Furious Javelin, Wrathful Advance (Helminth)"
  situational: string[] // "Empowered Quiver: only while standing in a Dashwire..."
  finalPeak: number
}

// enough to rebuild a Warframe setup in the Calculator's Warframe panel ("Load in calculator")
export interface FrameLoad {
  frame: string // "Excalibur", or a variant when its Energy matters ("Excalibur Umbra")
  allyStrength: number
  casts: AbilityCast[] // own (self), the subsumed one (helminth), allies' (ally)
  subsume: { from: string; name: string; replaces: string } | null
  arcaneIds: string[]
  shards?: (ShardSlot | null)[]
  mods: { regular: string[]; aura: string[]; exilus: string | null } // the frame mod build, augments included
}

// what the Warframe steps settled on, for the table, plus the load data
export interface CapSetup {
  frame: string
  priming?: { companion: string; types: string[]; own: string[] } // solo priming step: who applies what
  casts: { name: string; by: AbilityCast['by']; replaces?: string }[]
  arcanes: string[]
  shards?: string[] // "3x Violet Melee Critical Damage", for the table
  mods?: string[] // the frame mods, "Umbral Intensify", "Steel Charge (aura)"...
  strength?: number // what they add up to
  energy?: number
  allies: { frame: string; abilities: string[] }[]
  load?: FrameLoad // not in panel mode: those steps already come from the Warframe panel
}

export interface CapStepResult {
  stepIndex: number
  pathIndex: number | null // the Warframe steps run once per Warframe path, the first two are shared
  headshot: boolean // what this step was scored with, so "Load in calculator" can set the same
  debuffed: boolean
  debuffs: Debuffs // the exact debuffs it was scored with
  peakHit: number
  peakDotTick: { damageType: string; value: number } | null
  entry: WeaponEntry
  setup: CapSetup | null
}

// the Damage Cap tab's own target: a Steel Path Heavy Gunner at the level cap. Steel Path adds 100 levels, so 9,899
// spawns as 9,999. base level 8, 500 base armor, which is way past the 2,700 armor clamp by then
export const CAP_TARGET: TargetSettings = {
  faction: 'Grineer', layer: 'health', enemyId: '/Lotus/Types/Enemies/Grineer/AIWeek/Avatars/HeavyFemaleGrineerAvatar',
  baseLevel: 8, level: 9899, steelPath: true, manualArmor: 0, headshot: false, headshotMultiplier: null, headcrit: null,
}

const PEAK_OBJECTIVE: Objective = {
  id: 'single',
  label: 'Biggest single hit',
  unit: 'per hit',
  description: 'Top crit tier (or a Devouring Attrition non-crit), every multiplier, one instance',
  usesFireRate: false,
  score: (result) => result.peakHit,
}

const cleanDebuffs = (debuffs: Debuffs): Debuffs => ({
  ...debuffs,
  stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, 0])),
  heatArmorStrip: 0, corrosiveProjections: 0, otherArmorReduction: 0, damageVulnerability: 0, liftedOrKnockedDown: false, statusTypeSource: 'build',
})
// every status at its max (DoTs without a cap get 10), so CO / Galvanized count all of them
export const maxedDebuffs = (): Debuffs => ({
  stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, STATUS_EFFECTS[statusType].maxStacks ?? 10])),
  heatArmorStrip: 0.5, corrosiveProjections: 0, otherArmorReduction: 0, damageVulnerability: 0, liftedOrKnockedDown: true,
  statusTypeSource: 'debuffs',
})

// ---- Warframe search ----
// one ability (slot) and its variants, or a passive. required: a plain passive is always on, so leaving it off isn't a setup
interface Group { slot: string | null; options: WarframeAbility[]; required?: boolean }

const frameNames = [...new Set(warframes.map((frame) => warframeBaseName(frame.name)))].sort()
const frameSlots = (frame: string) => warframes.find((candidate) => candidate.name === frame)?.abilities.map((ability) => ability.name) ?? []
const hasEffects = (ability: WarframeAbility) => ability.effects.length > 0

// the frame's own modeled abilities, grouped by the ability they come from (Thermal Transfer's heat/cold/blast are one slot)
function ownGroups(frame: string, forAllies: boolean): Group[] {
  const groups = new Map<string, Group>()
  for (const ability of WARFRAME_ABILITIES) {
    if (ability.warframe !== frame || !hasEffects(ability)) continue
    if (forAllies && !helpsAllies(ability)) continue
    const key = ability.ability ?? ability.id
    if (!groups.has(key)) groups.set(key, { slot: ability.ability ?? null, options: [], required: !ability.ability && !ability.augment })
    groups.get(key)!.options.push(ability)
  }
  return [...groups.values()]
}

// every pick of one option (or none) per group, capped so a frame with lots of variants can't blow up
function* combos(groups: Group[], limit = 400): Generator<WarframeAbility[]> {
  let count = 0
  function* walk(index: number, picked: WarframeAbility[]): Generator<WarframeAbility[]> {
    if (count >= limit) return
    if (index === groups.length) {
      count++
      yield picked
      return
    }
    if (!groups[index].required) yield* walk(index + 1, picked)
    for (const option of groups[index].options) yield* walk(index + 1, [...picked, option])
  }
  yield* walk(0, [])
}

// Helminth options: every other frame's subsumable ability that's modeled and buffs weapons
const subsumeOptions = frameNames.flatMap((frame) => {
  const name = SUBSUMABLE[frame]
  return name ? modeledVariants(frame, name).filter((ability) => hasEffects(ability) && !ability.selfOnly).map((ability) => ({ frame, name, ability })) : []
})

interface Snapshot { build: OptimizedBuild; target: TargetSettings; armor: number; debuffs: Debuffs; buffs: Buffs }
// corrosiveProjections: Corrosive Projection auras on the frame, they strip the target's armor
const rescore = (snapshot: Snapshot, warframe: WarframeState | undefined, corrosiveProjections = 0): CalcResult =>
  calculate({
    weapon: snapshot.build.weapon, attack: snapshot.build.attack, mods: snapshot.build.mods, arcane: snapshot.build.arcane,
    coBehavior: resolveCoBehavior(snapshot.build.weapon, snapshot.build.attack), incarnonPerks: snapshot.build.perks,
    passives: snapshot.build.passives, bonusElement: snapshot.build.bonusElement, heavyMode: 'biggestHit',
    target: snapshot.target, armor: snapshot.armor, buffs: { ...snapshot.buffs, warframe },
    debuffs: corrosiveProjections ? { ...snapshot.debuffs, corrosiveProjections: snapshot.debuffs.corrosiveProjections + corrosiveProjections } : snapshot.debuffs,
  })

const scoreEval = (snapshot: Snapshot, evaluated: FrameEval) => rescore(snapshot, evaluated.state, evaluated.corrosiveProjections).peakHit

interface FrameCandidate { spec: FrameSpec; setup: CapSetup; score: number; situational: string[]; picked: number }
// Empowered Quiver works on melee in-game, but standing in a Dashwire while meleeing isn't a real setup. exalted guns keep it
const searchable = (ability: WarframeAbility, melee: boolean) => !(melee && ability.capGunsOnly)
// same hit as a setup with fewer abilities (Warcry's attack speed does nothing for one hit): not a separate setup
const sameHit = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b))

const frameByName = (name: string): Warframe => warframes.find((frame) => frame.name === name)!
// the frame's variants (Excalibur, Excalibur Prime, Excalibur Umbra): same kit, different Energy
const variantsOf = (name: string) => warframes.filter((frame) => warframeBaseName(frame.name) === name)

// the screening pass scores every setup at a reference Strength: what the best Strength-only mod build reaches with the
// slots the augments leave free (no shards, no arcanes)
const referenceStrength = new Map<number, number>()
function strengthWithFreeSlots(frame: Warframe, freeSlots: number): number {
  const cached = referenceStrength.get(freeSlots)
  if (cached !== undefined) return cached
  const result = optimizeFrameMods({ frame, subsume: null, casts: [], allyStrength: 1, arcaneIds: [], shards: [] }, (evaluated) => evaluated.strength, 4, freeSlots)
  referenceStrength.set(freeSlots, result.evaluated.strength)
  return result.evaluated.strength
}

// "any Warframe" still has to be a real one to load into the panel: the first frame with nothing of its own modeled
// that isn't a damage-buff frame (those restrict where a subsume can go)
const anyFrame = () => frameNames.find((frame) => ownGroups(frame, false).length === 0 && SUBSUMABLE[frame] && frameSlots(frame).length === 4) ?? 'Loki'

function searchFrames(snapshot: Snapshot, allyStrength: number): FrameCandidate[] {
  const candidates: FrameCandidate[] = []
  const melee = snapshot.build.weapon.category === 'Melee'
  // an exalted weapon only exists on its own Warframe (Exalted Blade -> Excalibur). otherwise every frame with something
  // modeled, and frames with nothing of their own are all the same here: "any Warframe" with a subsume
  const exaltedRule = exaltedRuleFor(snapshot.build.weapon)
  const exaltedFrame = exaltedRule?.warframe
  const framesToTry = exaltedFrame ? [exaltedFrame] : [...frameNames.filter((frame) => ownGroups(frame, false).length > 0), 'Any Warframe']
  for (const frame of framesToTry) {
    const loadFrame = frame === 'Any Warframe' ? anyFrame() : frame
    const frameObject = frameByName(loadFrame)
    const groups = (frame === 'Any Warframe' ? [] : ownGroups(frame, false))
      .map((group) => ({ ...group, options: group.options.filter((ability) => searchable(ability, melee)) }))
      .filter((group) => group.options.length > 0)
    // the ability that summons an exalted weapon (Exalted Blade, Landslide) can't be swapped out for a subsume
    const slots = frameSlots(loadFrame).filter((slot) => !exaltedRule || slot.toLowerCase() !== exaltedRule.ability.toLowerCase())
    // per frame: the best setup, and the best one without situational abilities (Empowered Quiver), as separate paths
    // with only one frame to try (an exalted weapon), its best few setups become the paths instead
    const keep = framesToTry.length === 1 ? 5 : 1
    const top: FrameCandidate[] = []
    let bestPlain: FrameCandidate | null = null
    for (const own of combos(groups)) {
      const usedSlots = new Set(own.flatMap((ability) => (ability.ability ? [ability.ability] : [])))
      const ownCasts: AbilityCast[] = own.map((ability) => ({ id: ability.id, by: 'self', ...(ability.stacks ? { stacks: ability.stacks.default } : {}) }))
      for (const subsume of [null, ...subsumeOptions]) {
        if (subsume && (subsume.frame === frame || !searchable(subsume.ability, melee))) continue
        // it has to replace one of this frame's abilities that isn't in use (Roar/Eclipse/Xata only in a damage-buff slot)
        const slot = subsume
          ? slots.find((candidate) => !usedSlots.has(candidate) && canSubsumeInto(loadFrame, candidate, subsume.name))
          : undefined
        if (subsume && !slot) continue
        const picked = [...own, ...(subsume ? [subsume.ability] : [])]
        const casts: AbilityCast[] = subsume ? [...ownCasts, { id: subsume.ability.id, by: 'helminth', ...(subsume.ability.stacks ? { stacks: subsume.ability.stacks.default } : {}) }] : ownCasts
        // screening: the Strength a real build would have with the slots the augments leave
        const augments = new Set(picked.flatMap((ability) => (ability.augment ? [ability.augment] : []))).size
        const strength = strengthWithFreeSlots(frameObject, REGULAR_SLOTS - augments)
        const score = rescore(snapshot, { frameName: frame === 'Any Warframe' ? loadFrame : frame, abilityStrength: strength, teammateStrength: allyStrength, armor: 0, casts, arcanes: [] }).peakHit
        const situational = picked.flatMap((ability) => (ability.situational ? [\`\${ability.name}: \${ability.situational}\`] : []))
        const better = (current: FrameCandidate | null | undefined) => !current || score > current.score
        // a tie with a kept setup: keep whichever has fewer abilities
        const twin = top.find((kept) => sameHit(kept.score, score))
        if (twin && twin.picked <= picked.length) continue
        if (twin) top.splice(top.indexOf(twin), 1)
        const makesTop = top.length < keep || better(top.at(-1))
        if (makesTop || (!situational.length && better(bestPlain))) {
          const candidate: FrameCandidate = {
            score, situational, picked: picked.length,
            spec: { frame: frameObject, subsume: subsume ? { warframe: subsume.frame, ability: subsume.name } : null, casts, allyStrength, arcaneIds: [], shards: [] },
            setup: {
              frame: frame === 'Any Warframe' ? \`Any Warframe (e.g. \${loadFrame})\` : frame,
              casts: [
                ...own.map((ability) => ({ name: ability.name, by: 'self' as const })),
                ...(subsume ? [{ name: subsume.ability.name, by: 'helminth' as const, replaces: slot }] : []),
              ],
              arcanes: [], allies: [],
              load: {
                frame: loadFrame, allyStrength, casts, subsume: subsume && slot ? { from: subsume.frame, name: subsume.name, replaces: slot } : null,
                arcaneIds: [], mods: { regular: [], aura: [], exilus: null },
              },
            },
          }
          if (makesTop) {
            top.push(candidate)
            top.sort((a, b) => b.score - a.score)
            if (top.length > keep) top.pop()
          }
          if (!situational.length && (better(bestPlain) || (bestPlain && sameHit(bestPlain.score, score) && picked.length < bestPlain.picked))) bestPlain = candidate
        }
      }
    }
    candidates.push(...top)
    if (bestPlain && !top.includes(bestPlain)) candidates.push(bestPlain)
  }
  return candidates.sort((a, b) => b.score - a.score)
}

// the frame mods picked for a spec, written into the setup (table text + what "Load in calculator" equips)
function withLoadout(setup: CapSetup, spec: FrameSpec, loadout: FrameLoadout, evaluated: FrameEval): CapSetup {
  return {
    ...setup,
    mods: describeLoadout(loadout),
    strength: evaluated.strength,
    energy: evaluated.energy,
    load: {
      ...setup.load!,
      frame: spec.frame.name,
      arcaneIds: spec.arcaneIds,
      shards: spec.shards.length ? spec.shards : undefined,
      mods: { regular: loadout.regular.map((mod) => mod.name), aura: loadout.aura.map((mod) => mod.name), exilus: loadout.exilus?.name ?? null },
    },
  }
}

// ---- Archon Shards ----
// shards that can matter for one hit of this weapon class
const shardOptionsFor = (category: string) =>
  category === 'Melee' ? ['crimson-strength', 'crimson-melee-cd', 'violet-melee-cd', 'azure-energy']
    : category === 'Primary' ? ['crimson-strength', 'violet-primary-electricity', 'crimson-primary-sc']
      : category === 'Secondary' ? ['crimson-strength', 'crimson-secondary-cc', 'topaz-secondary-cc']
        : ['crimson-strength']

// every way to fill 5 slots from the options (order doesn't matter), all Tauforged
function* shardMultisets(options: string[], slots = SHARD_SLOTS, start = 0, picked: string[] = []): Generator<string[]> {
  if (picked.length === slots) {
    yield picked
    return
  }
  for (let index = start; index < options.length; index++) yield* shardMultisets(options, slots, index, [...picked, options[index]])
}

export const shardNames = (slots: ShardSlot[]) => {
  const counts = new Map<string, number>()
  for (const slot of slots) counts.set(slot.buffId, (counts.get(slot.buffId) ?? 0) + 1)
  return [...counts].map(([id, count]) => {
    const shard = shardBuffsById.get(id)!
    return \`\${count}x \${shard.color} \${shard.label.replace(/ \\(.*\\)$/, '')}\`
  })
}

interface ShardPick { spec: FrameSpec; loadout: FrameLoadout; evaluated: FrameEval; score: number }

// every shard set, each with its own frame mods (a quick narrow search), then the best few searched properly.
// Violet sets go on the frame variant with the most Energy (Excalibur Umbra's 225 vs Excalibur's 150)
function searchShards(snapshot: Snapshot, spec: FrameSpec, keep: number): ShardPick[] {
  const roomiest = variantsOf(warframeBaseName(spec.frame.name)).reduce((best, frame) => (rank30Energy(frame) > rank30Energy(best) ? frame : best), spec.frame)
  const score = (evaluated: FrameEval) => scoreEval(snapshot, evaluated)
  const quick: ShardPick[] = []
  for (const ids of shardMultisets(shardOptionsFor(snapshot.build.weapon.category))) {
    const shards = ids.map((buffId) => ({ buffId, tauforged: true }))
    const frame = ids.includes('violet-melee-cd') ? roomiest : spec.frame
    const shardSpec: FrameSpec = { ...spec, frame, shards }
    const result = optimizeFrameMods(shardSpec, score, 2)
    quick.push({ spec: shardSpec, ...result })
  }
  quick.sort((a, b) => b.score - a.score)
  return quick.slice(0, keep)
    .map((pick) => ({ spec: pick.spec, ...optimizeFrameMods(pick.spec, score, 6) }))
    .sort((a, b) => b.score - a.score)
}

// ---- solo priming ----
// the companion primer: what it keeps on enemies for you. its damage isn't counted, only the statuses it leaves.
// Diriga primes all three physicals and Electricity (Arc Coil), and with Manifold Bond up to 3 more elemental statuses
// from its weapon's mods, 7 in all. Hounds and Nautilus prime as much or one less, so Diriga stands in for all of them
interface Companion { id: string; name: string; fixed: string[]; free: number; exclude?: string; note: string }
export const COMPANIONS: Companion[] = [
  {
    id: 'diriga', name: 'Diriga', fixed: ['impact', 'puncture', 'slash', 'electricity'], free: 3, exclude: 'electricity',
    note: 'Arc Coil Electricity + all three physicals, and with Manifold Bond 3 modded elements other than Electricity (7 statuses)',
  },
]
const ELEMENT_PARTS: Record<string, string[]> = {
  heat: ['heat'], cold: ['cold'], electricity: ['electricity'], toxin: ['toxin'],
  blast: ['cold', 'heat'], corrosive: ['electricity', 'toxin'], gas: ['heat', 'toxin'], magnetic: ['cold', 'electricity'],
  radiation: ['electricity', 'heat'], viral: ['cold', 'toxin'],
}
// every elemental status combo a modded companion weapon can carry: up to \`count\` types with no base element reused
// exclude: a base element the weapon's mods can't use (Diriga's Electricity comes from Arc Coil)
export function elementCombos(count: number, exclude?: string): string[][] {
  const types = Object.keys(ELEMENT_PARTS)
  const out: string[][] = []
  const walk = (start: number, picked: string[], used: Set<string>) => {
    if (picked.length) out.push(picked)
    if (picked.length === count) return
    for (let index = start; index < types.length; index++) {
      const parts = ELEMENT_PARTS[types[index]]
      if (parts.some((part) => used.has(part) || part === exclude)) continue
      walk(index + 1, [...picked, types[index]], new Set([...used, ...parts]))
    }
  }
  walk(0, [], new Set())
  return out
}

// statuses the build applies on its own: its damage types (when it has status chance) and anything it procs
export function ownStatusTypes(result: CalcResult): string[] {
  const types = new Set<string>()
  if (result.statusChance > 0) for (const row of result.damageTypes) types.add(row.damageType)
  for (const dot of result.dots) if (dot.procsPerSecond > 0) types.add(dot.damageType)
  return [...types].filter((type) => STATUS_TYPES.includes(type)).sort()
}

// those statuses at max stacks (a full Heat strip if Heat is up), counted as the target's statuses for CO / Galvanized
export const primedDebuffs = (types: string[]): Debuffs => ({
  stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, types.includes(statusType) ? STATUS_EFFECTS[statusType].maxStacks ?? 10 : 0])),
  heatArmorStrip: types.includes('heat') ? 0.5 : 0, corrosiveProjections: 0, otherArmorReduction: 0, damageVulnerability: 0, liftedOrKnockedDown: false,
  statusTypeSource: 'debuffs',
})

interface PrimingPick { companion: Companion | null; types: string[]; own: string[]; score: number }
// the best companion and weapon combo for this build, scored on the build as it is
function searchPriming(snapshot: Snapshot, warframe: WarframeState | undefined, corrosiveProjections: number): PrimingPick {
  const own = ownStatusTypes(rescore(snapshot, warframe, corrosiveProjections))
  const scoreTypes = (types: string[]) => rescore({ ...snapshot, debuffs: primedDebuffs(types) }, warframe, corrosiveProjections).peakHit
  let best: PrimingPick = { companion: null, types: own, own, score: scoreTypes(own) }
  for (const companion of COMPANIONS) {
    for (const combo of [[], ...elementCombos(companion.free, companion.exclude)]) {
      const types = [...new Set([...own, ...companion.fixed, ...combo])].sort()
      const score = scoreTypes(types)
      if (score > best.score * (1 + 1e-9)) best = { companion, types, own, score }
    }
  }
  return best
}

const FRAME_ARCANES = arcanes.filter((arcane) => arcane.type === 'Warframe Arcane')

// arcanes go through the frame build too, so Molt Augmented's Strength counts
function searchArcanes(snapshot: Snapshot, spec: FrameSpec, loadout: FrameLoadout): { ids: string[]; score: number }[] {
  const scoreWith = (ids: string[]) => scoreEval(snapshot, evaluateFrame({ ...spec, arcaneIds: ids }, loadout))
  const none = scoreWith([])
  // only the ones that do anything alone are worth pairing
  const useful = FRAME_ARCANES.map((arcane) => ({ id: arcane.uniqueName, score: scoreWith([arcane.uniqueName]) })).filter((option) => option.score > none * 1.0001)
  const results: { ids: string[]; score: number }[] = [{ ids: [], score: none }, ...useful.map((option) => ({ ids: [option.id], score: option.score }))]
  for (let i = 0; i < useful.length; i++) {
    for (let j = i + 1; j < useful.length; j++) results.push({ ids: [useful[i].id, useful[j].id], score: scoreWith([useful[i].id, useful[j].id]) })
  }
  return results.sort((a, b) => b.score - a.score)
}

// one teammate at a time: the frame whose own ally-reaching abilities add the most on top of what's already there
function searchAllies(snapshot: Snapshot, base: WarframeState, count: number, allowSituational: boolean, corrosiveProjections: number): { state: WarframeState; allies: CapSetup['allies']; situational: string[] } {
  let state = base
  const melee = snapshot.build.weapon.category === 'Melee'
  const allies: CapSetup['allies'] = []
  const situational: string[] = []
  for (let round = 0; round < count; round++) {
    const current = rescore(snapshot, state, corrosiveProjections).peakHit
    let best: { state: WarframeState; frame: string; abilities: string[]; score: number; flags: string[] } | null = null
    for (const frame of frameNames) {
      // a path without situational abilities stays that way through its allies
      const groups = ownGroups(frame, true)
        .map((group) => ({ ...group, options: group.options.filter((ability) => (allowSituational || !ability.situational) && searchable(ability, melee)) }))
        .filter((group) => group.options.length > 0)
      if (!groups.length) continue
      for (const own of combos(groups, 200)) {
        if (!own.length) continue
        const next: WarframeState = { ...state, casts: [...state.casts, ...own.map((ability) => ({ id: ability.id, by: 'ally' as const, ...(ability.stacks ? { stacks: ability.stacks.default } : {}) }))] }
        const score = rescore(snapshot, next, corrosiveProjections).peakHit
        if (!best || score > best.score) best = { state: next, frame, abilities: own.map((ability) => ability.name), score, flags: own.flatMap((ability) => (ability.situational ? [\`\${ability.name} (ally): \${ability.situational}\`] : [])) }
      }
    }
    if (!best || best.score <= current * 1.0001) break
    state = best.state
    allies.push({ frame: best.frame, abilities: best.abilities })
    situational.push(...best.flags)
  }
  return { state, allies, situational }
}

// the Warframe panel's setup split into the Warframe steps: its arcanes, + its shards, + its abilities, + allies
function panelStates(panel: WarframeState | undefined) {
  if (!panel) return null
  const own = panel.casts.filter((cast) => cast.by !== 'ally')
  const describe = (casts: AbilityCast[]) => casts.map((cast) => ({ name: abilitiesById.get(cast.id)?.name ?? cast.id, by: cast.by }))
  const arcaneNames = (panel.arcanes ?? []).map((slot) => arcanes.find((arcane) => arcane.uniqueName === slot.arcaneId)?.name ?? slot.arcaneId)
  const noShards: WarframeState = { ...panel, abilityStrength: panel.abilityStrength - (panel.shardStrength ?? 0), shardStrength: 0, shards: undefined }
  const shardText = panel.shards && (panel.shardStrength || Object.values(panel.shards).some(Boolean)) ? ['from the panel'] : []
  return {
    frameArcanes: { state: { ...noShards, casts: [] }, setup: { frame: panel.frameName, casts: [], arcanes: arcaneNames, allies: [] } },
    shards: { state: { ...panel, casts: [] }, setup: { frame: panel.frameName, casts: [], arcanes: arcaneNames, shards: shardText, allies: [] } },
    frame: { state: { ...panel, casts: own }, setup: { frame: panel.frameName, casts: describe(own), arcanes: arcaneNames, shards: shardText, allies: [] } },
    allies: {
      state: panel,
      setup: {
        frame: panel.frameName, casts: describe(own), arcanes: arcaneNames, shards: shardText,
        allies: panel.casts.filter((cast) => cast.by === 'ally').map((cast) => ({ frame: abilitiesById.get(cast.id)?.warframe ?? '?', abilities: [abilitiesById.get(cast.id)?.name ?? cast.id] })),
      },
    },
  }
}

// the whole ladder, step by step (onStep fires as each one finishes so the table fills in)
// the whole ladder. onStep fires as each step finishes so the table fills in, onPaths once at the end with the
// Warframe paths and which one to show first
export function runCapLadder(request: CapRequest, onStep: (result: CapStepResult) => void, onPaths: (paths: CapPath[], defaultPath: number) => void = () => {}) {
  const weapon = weaponsById.get(request.weaponId)!
  const attack = weapon.attacks[request.attackIndex] ?? weapon.attacks[0]
  const isMelee = weapon.category === 'Melee'
  const { scenario } = request
  const riven = request.riven ? rivenMod(weapon, request.riven) : null
  const lockedMods = riven ? [{ mod: riven, rank: riven.fusionLimit, conditionalStacks: 0 }] : []
  // headshots: never on AoE, and off for melee unless asked (most melee can't land them reliably)
  const canHeadshot = !attack.isAoE && (!isMelee || request.meleeHeadshots)
  const target: TargetSettings = { ...scenario.target, headshot: false }
  const headTarget: TargetSettings = { ...scenario.target, headshot: canHeadshot }
  // melee at max combo: Blood Rush / Weeping Wounds / heavies are part of the weapon's investment
  const noFrameBuffs: Buffs = { roar: 0, combo: maxComboFor(weapon.name), gladiatorWarframePieces: 0 }
  const clean = cleanDebuffs(scenario.debuffs)
  const maxed = maxedDebuffs()

  const optimize = (stepTarget: TargetSettings, debuffs: Debuffs, buffs: Buffs) => {
    const constraints: OptimizeConstraints = {
      lockedMods, beamWidth: request.thorough ? 16 : 8,
      excludedArcaneIds: request.allowCompression ? [] : COMPRESSION_ID,
      scenario: { target: stepTarget, armor: scenario.armor, debuffs, buffs },
    }
    return optimizeAttack(weapon, attack, PEAK_OBJECTIVE, true, request.heavyMode, constraints)
  }
  const snapshot = (build: OptimizedBuild, debuffs: Debuffs, warframe?: WarframeState): Snapshot =>
    ({ build, target: headTarget, armor: scenario.armor, debuffs, buffs: { ...noFrameBuffs, warframe } })
  const emit = (stepIndex: number, pathIndex: number | null, build: OptimizedBuild, setup: CapSetup | null, debuffs: Debuffs, headshot = canHeadshot) =>
    onStep({ stepIndex, pathIndex, peakHit: build.result.peakHit, peakDotTick: build.result.peakDotTick, entry: toEntry(build), setup, headshot, debuffed: debuffs !== clean, debuffs })
  // Warframe setups get the mods re-optimized for them, best one wins
  // cp: Corrosive Projection auras on the frame build, they go in with the step's debuffs
  const refine = <T extends { state?: WarframeState; setup: CapSetup | null; cp?: number }>(candidates: T[], debuffs: Debuffs) => {
    let best: (T & { build: OptimizedBuild }) | null = null
    for (const candidate of candidates) {
      const stepDebuffs = candidate.cp ? { ...debuffs, corrosiveProjections: debuffs.corrosiveProjections + candidate.cp } : debuffs
      const build = optimize(headTarget, stepDebuffs, { ...noFrameBuffs, warframe: candidate.state })
      if (!best || build.result.peakHit > best.build.result.peakHit) best = { ...candidate, build }
    }
    return best!
  }
  // solo priming: the build's own statuses + the best companion. what the build applies depends on its mods, so I pick
  // the companion, re-optimize the mods for those debuffs, then re-pick on the new build. every reported number uses
  // the statuses the reported build really applies
  const solo = <T extends { state?: WarframeState; setup: CapSetup | null; cp?: number; build: OptimizedBuild }>(base: T) => {
    const cp = base.cp ?? 0
    const consistent = (build: OptimizedBuild, state: WarframeState | undefined) => {
      const pick = searchPriming(snapshot(build, clean), state, cp)
      return { build: { ...build, result: rescore({ ...snapshot(build, clean), debuffs: primedDebuffs(pick.types) }, state, cp) }, pick }
    }
    let best = consistent(base.build, base.state)
    let pick = best.pick
    for (let pass = 0; pass < 2; pass++) {
      const next = refine([base], primedDebuffs(pick.types))
      const scored = consistent(next.build, next.state)
      if (scored.build.result.peakHit > best.build.result.peakHit) best = scored
      if (scored.pick.types.join() === pick.types.join()) break
      pick = scored.pick
    }
    const priming = { companion: best.pick.companion?.name ?? 'none needed', types: best.pick.types, own: best.pick.own }
    return { ...base, build: best.build, debuffs: primedDebuffs(best.pick.types), setup: base.setup ? { ...base.setup, priming } : base.setup, priming }
  }
  const soloBest = <T extends { state?: WarframeState; setup: CapSetup | null; cp?: number; build: OptimizedBuild }>(candidates: T[]) =>
    candidates.map(solo).reduce((best, next) => (next.build.result.peakHit > best.build.result.peakHit ? next : best))
  const describe = (setup: CapSetup) =>
    \`\${setup.frame}: \${setup.casts.map((cast) => (cast.by === 'helminth' ? \`\${cast.name} (Helminth)\` : cast.name)).join(', ') || 'nothing'}\`

  // 1-3: the weapon, headshot, then solo priming (shared by every path)
  const modsBuild = optimize(target, clean, noFrameBuffs)
  emit(0, null, modsBuild, null, clean, false)
  const headBuild = optimize(headTarget, clean, noFrameBuffs)
  emit(1, null, headBuild, null, clean)
  const primedHead = solo({ setup: null, build: headBuild })
  const primingOnly = (priming: CapSetup['priming']): CapSetup => ({ frame: '', casts: [], arcanes: [], allies: [], priming })
  emit(2, null, primedHead.build, primingOnly(primedHead.priming), primedHead.debuffs)

  if (request.frameMode === 'panel') {
    const panel = panelStates(scenario.buffs.warframe)
    if (!panel) {
      for (const stepIndex of [3, 4, 5]) emit(stepIndex, 0, primedHead.build, null, primedHead.debuffs)
      const debuffBuild = optimize(headTarget, maxed, noFrameBuffs)
      emit(6, 0, debuffBuild, null, maxed)
      emit(7, 0, debuffBuild, null, maxed)
      onPaths([{ index: 0, label: 'No Warframe set in the panel', situational: [], finalPeak: debuffBuild.result.peakHit }], 0)
      return
    }
    const panelArcanes = solo({ ...panel.frameArcanes, build: primedHead.build })
    emit(3, 0, panelArcanes.build, panelArcanes.setup, panelArcanes.debuffs)
    const panelShards = solo({ ...panel.shards, build: panelArcanes.build })
    emit(4, 0, panelShards.build, panelShards.setup, panelShards.debuffs)
    const panelFrame = solo({ ...panel.frame, build: panelShards.build })
    emit(5, 0, panelFrame.build, panelFrame.setup, panelFrame.debuffs)
    emit(6, 0, refine([panel.frame], maxed).build, panel.frame.setup, maxed)
    const withAllies = refine([{ state: panel.allies.state, setup: panel.allies.setup }], maxed)
    emit(7, 0, withAllies.build, panel.allies.setup, maxed)
    const flags = panel.frame.state.casts.flatMap((cast) => {
      const ability = abilitiesById.get(cast.id)
      return ability?.situational ? [\`\${ability.name}: \${ability.situational}\`] : []
    })
    onPaths([{ index: 0, label: \`Your Warframe panel (\${panel.frame.setup.frame})\`, situational: flags, finalPeak: withAllies.build.result.peakHit }], 0)
    return
  }

  // 4-5, shared: arcanes then shards on any Warframe with nothing cast. the frame is only there to hold them
  // (and its mods for Violet's Energy), so it's "any Warframe"
  const arcaneNamesOf = (ids: string[]) => ids.map((id) => arcanes.find((arcane) => arcane.uniqueName === id)!.name)
  // an exalted weapon only exists on its own frame, and its damage follows that frame's Strength (Molt Augmented counts)
  const exaltedFrame = exaltedRuleFor(weapon)?.warframe
  const holder = frameByName(exaltedFrame ?? anyFrame())
  const holderSpec: FrameSpec = { frame: holder, subsume: null, casts: [], allyStrength: request.allyStrength, arcaneIds: [], shards: [] }
  const emptyLoadout: FrameLoadout = { regular: [], aura: [], exilus: null }
  const holderLoad = (spec: FrameSpec, loadout: FrameLoadout): FrameLoad => ({
    frame: spec.frame.name, allyStrength: request.allyStrength, casts: [], subsume: null, arcaneIds: spec.arcaneIds,
    shards: spec.shards.length ? spec.shards : undefined,
    mods: { regular: loadout.regular.map((mod) => mod.name), aura: loadout.aura.map((mod) => mod.name), exilus: loadout.exilus?.name ?? null },
  })
  const holderSetup = (spec: FrameSpec, loadout: FrameLoadout, evaluated: FrameEval | null): CapSetup => ({
    frame: exaltedFrame ?? 'Any Warframe', casts: [], arcanes: arcaneNamesOf(spec.arcaneIds), allies: [],
    ...(spec.shards.length ? { shards: shardNames(spec.shards), mods: describeLoadout(loadout), energy: evaluated?.energy, strength: evaluated?.strength } : {}),
    load: holderLoad(spec, loadout),
  })
  const arcaneOptions = searchArcanes(snapshot(primedHead.build, primedHead.debuffs), holderSpec, emptyLoadout).slice(0, request.thorough ? 4 : 2)
  const sharedArcanes = soloBest(arcaneOptions.map((option) => {
    const spec = { ...holderSpec, arcaneIds: option.ids }
    const evaluated = evaluateFrame(spec, emptyLoadout)
    return { spec, loadout: emptyLoadout, state: evaluated.state, cp: evaluated.corrosiveProjections, build: primedHead.build, setup: holderSetup(spec, emptyLoadout, null) }
  }))
  emit(3, null, sharedArcanes.build, sharedArcanes.setup, sharedArcanes.debuffs)
  const holderShards = searchShards(snapshot(sharedArcanes.build, sharedArcanes.debuffs), sharedArcanes.spec, request.thorough ? 4 : 2)
  const sharedShards = soloBest(holderShards.map((pick) => ({
    spec: pick.spec, loadout: pick.loadout, state: pick.evaluated.state, cp: pick.evaluated.corrosiveProjections, build: sharedArcanes.build,
    setup: holderSetup(pick.spec, pick.loadout, pick.evaluated),
  })))
  emit(4, null, sharedShards.build, sharedShards.setup, sharedShards.debuffs)

  // 6-8 per Warframe path, screened on the shared step-5 build
  const sharedSnapshot = snapshot(sharedShards.build, sharedShards.debuffs)
  const frames = searchFrames(sharedSnapshot, request.allyStrength)
  // the shortlist gets real frame mods (with the shared shards and arcanes on), then the weapon mods re-optimized
  const shortlist = frames.slice(0, request.thorough ? 12 : 8)
  const plainBest = frames.find((candidate) => !candidate.situational.length)
  if (plainBest && !shortlist.includes(plainBest)) shortlist.push(plainBest)
  const refined = shortlist.map((candidate) => {
    const spec: FrameSpec = { ...candidate.spec, arcaneIds: sharedShards.spec.arcaneIds, shards: sharedShards.spec.shards }
    const picked = optimizeFrameMods(spec, (evaluated) => scoreEval(sharedSnapshot, evaluated))
    return solo({
      candidate, spec, loadout: picked.loadout, state: picked.evaluated.state, cp: picked.evaluated.corrosiveProjections,
      setup: withLoadout(candidate.setup, spec, picked.loadout, picked.evaluated), build: sharedShards.build,
    })
  }).sort((a, b) => b.build.result.peakHit - a.build.result.peakHit)
  const singleFrame = new Set(refined.map((option) => option.setup.frame)).size === 1
  const chosen: typeof refined = []
  const seenFrames = new Set<string>()
  for (const option of refined) {
    if (chosen.length >= 5) break
    // distinct frames, except when there's only one frame (exalted weapons): then distinct setups
    const key = singleFrame ? describe(option.setup) : \`\${option.setup.frame}|\${option.candidate.situational.length > 0}\`
    if (seenFrames.has(key)) continue
    // one frame: a setup that hits the same as a kept one with fewer abilities is the same setup
    if (singleFrame && chosen.some((kept) => sameHit(kept.build.result.peakHit, option.build.result.peakHit) && kept.candidate.picked <= option.candidate.picked)) continue
    seenFrames.add(key)
    chosen.push(option)
  }
  // the best plain one always makes the list
  const plainRefined = refined.find((option) => !option.candidate.situational.length)
  if (plainRefined && !chosen.includes(plainRefined)) {
    if (chosen.length >= 5) chosen.pop() // still 5 paths, the last situational one makes room
    chosen.push(plainRefined)
  }

  const paths: CapPath[] = []
  chosen.forEach((option, pathIndex) => {
    // shards and arcanes re-picked for this frame (Strength and Energy matter now), frame mods re-picked with each shard set
    const shardPicks = searchShards(snapshot(option.build, option.debuffs), option.spec, request.thorough ? 4 : 2)
    const withShardPick = soloBest([option, ...shardPicks.map((pick) => ({
      ...option, spec: pick.spec, loadout: pick.loadout, state: pick.evaluated.state, cp: pick.evaluated.corrosiveProjections,
      setup: withLoadout(option.setup, pick.spec, pick.loadout, pick.evaluated),
    }))])
    const arcanePicks = searchArcanes(snapshot(withShardPick.build, withShardPick.debuffs), withShardPick.spec, withShardPick.loadout).slice(0, request.thorough ? 4 : 2)
    const withFrame = soloBest(arcanePicks.map((arcaneOption) => {
      const spec = { ...withShardPick.spec, arcaneIds: arcaneOption.ids }
      const evaluated = evaluateFrame(spec, withShardPick.loadout)
      return {
        ...withShardPick, spec, state: evaluated.state, cp: evaluated.corrosiveProjections,
        setup: { ...withLoadout(withShardPick.setup, spec, withShardPick.loadout, evaluated), shards: shardNames(spec.shards), arcanes: arcaneNamesOf(spec.arcaneIds) },
      }
    }))
    emit(5, pathIndex, withFrame.build, withFrame.setup, withFrame.debuffs)
    const debuffed = refine([withFrame], maxed)
    emit(6, pathIndex, debuffed.build, debuffed.setup, maxed)
    const allies = searchAllies(snapshot(debuffed.build, maxed), debuffed.state, request.allyCount, option.candidate.situational.length > 0, debuffed.cp ?? 0)
    const withAllies = refine([{ ...debuffed, state: allies.state, setup: { ...debuffed.setup, allies: allies.allies, load: debuffed.setup.load && { ...debuffed.setup.load, casts: allies.state.casts } } }], maxed)
    emit(7, pathIndex, withAllies.build, withAllies.setup, maxed)
    paths.push({ index: pathIndex, label: describe(option.setup), situational: [...option.candidate.situational, ...allies.situational], finalPeak: withAllies.build.result.peakHit })
  })
  // melee prefers a path without situational abilities, ranged takes the best (flagged if it's situational)
  const ranked = [...paths].sort((a, b) => b.finalPeak - a.finalPeak)
  const preferred = isMelee ? ranked.find((path) => !path.situational.length) ?? ranked[0] : ranked[0]
  onPaths(paths, preferred?.index ?? 0)
}
`,M=`// a real Warframe mod build for the Damage Cap ladder: 8 slots, aura(s) and exilus, the ability augments locked in, and the
// rest picked from the frame mods that change weapon damage somewhere (Strength, Max Energy for Violet shards, squad auras,
// Gladiator / Nira / Vigilante pieces that count toward weapon set bonuses, Umbral pieces that enhance Umbral Intensify).
// conditionals are off (Final Act's low health, Archon Intensify's heal), Growing Power is assumed up like in the panel
import { arcanes, getWarframeMods, isAuraMod } from '../data'
import { modConflict } from '../calc/modConflicts'
import { maxConditionalStacks } from '../calc/parseMod'
import { warframeStateFor, warframeTotals, type EquippedWarframeMod } from '../calc/warframeStats'
import { abilitiesById, type AbilityCast, type WarframeState } from '../data/warframeAbilities'
import type { ShardSlot } from '../data/archonShards'
import type { Mod, Warframe } from '../types'

export const REGULAR_SLOTS = 8

export interface FrameSpec {
  frame: Warframe
  subsume: { warframe: string; ability: string } | null
  casts: AbilityCast[] // own, subsumed and allies'
  allyStrength: number
  arcaneIds: string[]
  shards: ShardSlot[]
}

export interface FrameLoadout {
  regular: Mod[] // augments first
  aura: Mod[]
  exilus: Mod | null
}

export interface FrameEval {
  state: WarframeState
  corrosiveProjections: number
  strength: number
  energy: number
}

// the frame-side incompatibilities (wiki infoboxes), kept here so the weapon conflict table doesn't change
const FRAME_GROUPS = [
  ['Intensify', 'Umbral Intensify', 'Archon Intensify', 'Precision Intensify'],
  ['Flow', 'Primed Flow', 'Archon Flow'],
]
const frameConflict = (a: Mod, b: Mod) =>
  Boolean(modConflict(a, b)) || FRAME_GROUPS.some((group) => group.includes(a.name) && group.includes(b.name))

// sets whose frame pieces do something for weapons (or for Umbral Intensify)
const DAMAGE_SETS = ['Umbra', 'Gladiator', 'Nira', 'Vigilante']

const equip = (mod: Mod): EquippedWarframeMod => ({ mod, rank: mod.fusionLimit, conditionalStacks: 0 })
const arcaneSlot = (arcaneId: string) => {
  const arcane = arcanes.find((candidate) => candidate.uniqueName === arcaneId)!
  const rank = arcane.levelStats.length - 1
  return { arcane, rank, conditionalStacks: maxConditionalStacks(arcane.levelStats, rank) }
}

export const loadoutMods = (loadout: FrameLoadout) => [...loadout.regular, ...loadout.aura, ...(loadout.exilus ? [loadout.exilus] : [])]

export function evaluateFrame(spec: FrameSpec, loadout: FrameLoadout): FrameEval {
  const build = {
    frame: spec.frame,
    mods: loadoutMods(loadout).map(equip),
    arcanes: spec.arcaneIds.map(arcaneSlot),
    extraStrength: 0,
    extraArmor: 0,
    teammateStrength: spec.allyStrength,
    casts: spec.casts,
    shards: spec.shards,
  }
  const totals = warframeTotals(build)
  return { state: warframeStateFor(build, totals), corrosiveProjections: totals.corrosiveProjections, strength: totals.abilityStrength, energy: totals.energy }
}

// the augments the casts need, as mods this frame (or its subsume) can equip
export function augmentMods(spec: FrameSpec): Mod[] {
  const frameMods = getWarframeMods(spec.frame, spec.subsume)
  const names = new Set(spec.casts.flatMap((cast) => {
    const augment = cast.by !== 'ally' ? abilitiesById.get(cast.id)?.augment : undefined
    return augment ? [augment] : []
  }))
  return frameMods.filter((mod) => names.has(mod.name))
}

// the mods worth trying on this frame: anything that changes a damage-side number on its own, or a damage set's piece
const poolCache = new Map<string, Mod[]>()
function candidatePool(spec: FrameSpec): Mod[] {
  const key = \`\${spec.frame.uniqueName}|\${spec.subsume?.warframe ?? ''}:\${spec.subsume?.ability ?? ''}\`
  const cached = poolCache.get(key)
  if (cached) return cached
  const empty: FrameLoadout = { regular: [], aura: [], exilus: null }
  const signature = (loadout: FrameLoadout) => {
    const build = { frame: spec.frame, mods: loadoutMods(loadout).map(equip), arcanes: [], extraStrength: 0, extraArmor: 0, teammateStrength: 1, casts: [] }
    const totals = warframeTotals(build)
    return JSON.stringify([totals.abilityStrength, totals.energy, totals.auraDamage, totals.weakpointCritChance, totals.corrosiveProjections])
  }
  const base = signature(empty)
  const pool = getWarframeMods(spec.frame, spec.subsume).filter((mod) => {
    if (mod.modSet && DAMAGE_SETS.includes(mod.modSet)) return true
    const solo: FrameLoadout = isAuraMod(mod) ? { ...empty, aura: [mod] } : { ...empty, regular: [mod] }
    return signature(solo) !== base
  })
  poolCache.set(key, pool)
  return pool
}

const loadoutKey = (loadout: FrameLoadout) => loadoutMods(loadout).map((mod) => mod.name).sort().join('|')

// put one mod in: auras in the aura slot(s), exilus-capable ones in the exilus slot first, else a regular slot
function place(loadout: FrameLoadout, mod: Mod, auraSlots: number, regularSlots: number): FrameLoadout | null {
  if (loadoutMods(loadout).some((other) => frameConflict(other, mod))) return null
  if (isAuraMod(mod)) return loadout.aura.length < auraSlots ? { ...loadout, aura: [...loadout.aura, mod] } : null
  if (mod.isExilus && !loadout.exilus) return { ...loadout, exilus: mod }
  return loadout.regular.length < regularSlots ? { ...loadout, regular: [...loadout.regular, mod] } : null
}

// beam search over the frame's slots. one move = one mod, or every missing piece of a set at once (Umbral Intensify
// only gets its x1.75 with all 3 Umbral pieces, the other two do nothing alone)
export function optimizeFrameMods(
  spec: FrameSpec,
  score: (evaluated: FrameEval) => number,
  beamWidth = 6,
  regularSlots = REGULAR_SLOTS, // fewer for the reference-Strength pass (slots the augments would take)
): { loadout: FrameLoadout; evaluated: FrameEval; score: number } {
  const auraSlots = Math.max(1, spec.frame.auraPolarities.length)
  const pool = candidatePool(spec)
  const locked = augmentMods(spec)
  const start: FrameLoadout = { regular: locked.slice(0, REGULAR_SLOTS), aura: [], exilus: null }
  const rate = (loadout: FrameLoadout) => {
    const evaluated = evaluateFrame(spec, loadout)
    return { loadout, evaluated, score: score(evaluated) }
  }
  let best = rate(start)
  let beam = [best]
  const seen = new Set([loadoutKey(start)])
  const sets = [...new Set(pool.flatMap((mod) => (mod.modSet && DAMAGE_SETS.includes(mod.modSet) ? [mod.modSet] : [])))]
  for (let round = 0; round < regularSlots + auraSlots + 1 && beam.length; round++) {
    const next: typeof beam = []
    for (const current of beam) {
      const moves: FrameLoadout[] = []
      for (const mod of pool) {
        const placed = place(current.loadout, mod, auraSlots, regularSlots)
        if (placed) moves.push(placed)
      }
      for (const set of sets) {
        const missing = pool.filter((mod) => mod.modSet === set && !loadoutMods(current.loadout).some((other) => other.name === mod.name))
        if (missing.length < 2) continue
        let placed: FrameLoadout | null = current.loadout
        for (const mod of missing) placed = placed && place(placed, mod, auraSlots, regularSlots)
        if (placed) moves.push(placed)
      }
      for (const loadout of moves) {
        const key = loadoutKey(loadout)
        if (seen.has(key)) continue
        seen.add(key)
        next.push(rate(loadout))
      }
    }
    // ties: fewer mods first, so filler that does nothing doesn't sneak in
    next.sort((a, b) => b.score - a.score || loadoutMods(a.loadout).length - loadoutMods(b.loadout).length)
    beam = next.slice(0, beamWidth)
    if (beam[0] && beam[0].score > best.score * (1 + 1e-9)) best = beam[0]
  }
  return best
}

export const describeLoadout = (loadout: FrameLoadout) => [
  ...loadout.regular.map((mod) => mod.name),
  ...loadout.aura.map((mod) => \`\${mod.name} (aura)\`),
  ...(loadout.exilus ? [\`\${loadout.exilus.name} (exilus)\`] : []),
]
`,N=`// the leaderboard JSON, fetched once per page load and only when a tab needs it (Compare, Compare Weapons)
import { expandLeaderboard, type Leaderboard, type LeaderboardFile } from './leaderboardTypes'

let leaderboardPromise: Promise<Leaderboard | null> | null = null
export const loadLeaderboard = () =>
  (leaderboardPromise ??= fetch('./leaderboard.json')
    .then((response) => (response.ok ? (response.json() as Promise<LeaderboardFile>) : null))
    .then((file) => (file ? expandLeaderboard(file) : null))
    .catch(() => null))
`,P=`// public/leaderboard.json is stored compact and expanded into LeaderboardEntry when the Leaderboard / Compare tabs load it.
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

// one entry for the file. \`upgradeIndex\` / \`weaponIndex\` add to the shared tables as they go
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
`,oe=`// everything the leaderboard does for one weapon: every attack x every ranking. lives here (not in the build script)
// so it's part of the engine fingerprint in scripts/leaderboardFingerprint.ts, changing it reruns every weapon
import { evaluateSeed, optimizeAttack, type OptimizedBuild, type SeedBuild } from './optimize'
import { raisesFireRate } from '../calc/parseMod'
import { BOARDS, boardKey } from './objectives'
import { SCENARIO_HEADSHOT } from './scenario'
import { heavyComboFor } from '../data/heavyAttacks'
import type { LeaderboardStats, StoredEntry } from './leaderboardTypes'
import type { Weapon } from '../types'

// guns on a headshot board aim for the head, melee keeps the body-shot scenario
const scenarioFor = (weapon: Weapon, headshot?: boolean) => (headshot && weapon.category !== 'Melee' ? SCENARIO_HEADSHOT : null)
const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits

// mods stay as [uniqueName, name, rank, stacks] here, the build script turns them into indexes into the shared table.
// fresh runs keep every stat, the file only keeps what the leaderboard rows show
export interface WeaponEntry extends Omit<StoredEntry, 'stats'> {
  stats: LeaderboardStats
}

export function toEntry(build: OptimizedBuild): WeaponEntry {
  const { result } = build
  const totalModded = result.damageTypes.reduce((total, row) => total + row.modded, 0)
  return {
    weaponId: build.weapon.uniqueName,
    weaponName: build.weapon.name,
    category: build.weapon.category,
    type: build.weapon.type,
    attack: build.attack.name,
    incarnonForm: /incarnon/i.test(build.attack.name),
    // time-to-kill scores are 1 / seconds (0.02 for 50 s), so small ones keep significant digits instead of 2 decimals
    score: Math.abs(build.score) < 100 ? Number(build.score.toPrecision(5)) : round(build.score, 2),
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
      singleHit: round(result.hit.average * result.beamMerge, 1), // a beam's merged tick
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

// board key -> this weapon's entries on it
// seeds: builds found in the Compare tab (scripts/leaderboard-seeds.json). each one is scored the leaderboard's way and
// only replaces the search's build when it scores higher, so a seed can never make an entry worse
// onlyBoards: just these boards (build-leaderboard --boards), the rest come back empty and the script keeps the old ones
export function optimizeWeapon(weapon: Weapon, seeds: SeedBuild[] = [], onlyBoards?: string[]): Record<string, WeaponEntry[]> {
  const boards = Object.fromEntries(BOARDS.filter((board) => !onlyBoards || onlyBoards.includes(board.key)).map((board) => [board.key, [] as WeaponEntry[]]))
  // event-only attacks (reload explosions, turret expiry) don't fire at the fire rate, so they're skipped.
  const attacks = weapon.attacks.filter(
    // headshot-only parts (Vectis Incarnon's orb explosion) never happen in the leaderboard's body-shot scenario
    (attack) => Object.values(attack.damage).some((amount) => amount > 0) && !/reload|expiry|turret/i.test(attack.name) && !attack.headshotOnly,
  )
  // every attack (component) gets its own listing: slam, heavy slam, heavy attack, alt-fire, Incarnon form...
  // whole shots come after their parts in the data, so the parts' builds are there to try on the whole shot
  const found = new Map<string, Map<string, OptimizedBuild>>()
  for (const attack of attacks) {
    const builds = new Map<string, OptimizedBuild>()
    found.set(attack.name, builds)
    for (const { key, objective, allowFireRateMods, heavyMode, heavyOnly, headshot } of BOARDS) {
      if (onlyBoards && !onlyBoards.includes(key)) continue
      // heavies use up the combo, so spamming them at max combo isn't real DPS. they only compete for single hits.
      // same for alt-fires that need a gauge filled first (Trumna's grenade: 5 kills each): one volley, not a fire rate
      if ((attack.heavy || attack.altGate) && objective.usesFireRate) continue
      // the full-heavy board only holds multi-hit Heavy Attacks
      if (heavyOnly && !(attack.heavyMultiplier && heavyComboFor(weapon.name))) continue
      builds.set(key, optimizeAttack(weapon, attack, objective, allowFireRateMods, heavyMode, scenarioFor(weapon, headshot) ? { scenario: scenarioFor(weapon, headshot) } : undefined))
    }
    // the search is a heuristic, so the no-fire-rate build can come out ahead. it's a legal build either way
    for (const { key, objective, allowFireRateMods } of BOARDS) {
      const without = builds.get(boardKey(objective.id, false))
      if (allowFireRateMods && objective.usesFireRate && without && without.score > (builds.get(key)?.score ?? 0)) builds.set(key, without)
    }
    // a whole shot is at least as good as each part's best build on it: the search can walk into a weaker corner
    // (Orvius's charged throw + bounce came out below the throw alone), so every part's build gets a turn
    const partSeeds: SeedBuild[] = (attack.parts ?? []).flatMap((part) => [...(found.get(part)?.entries() ?? [])].map(([board, build]) => ({
      weaponId: weapon.uniqueName, attack: attack.name, board,
      mods: build.mods.map(({ mod }) => mod.uniqueName), arcane: build.arcane?.arcane.uniqueName ?? null,
      perks: build.perks.map(({ perk }) => ({ tier: perk.tier, name: perk.name })), bonusElement: build.bonusElement,
    })))
    for (const seed of [...seeds, ...partSeeds]) {
      if (seed.weaponId !== weapon.uniqueName || seed.attack !== attack.name) continue
      const spec = BOARDS.find((candidate) => candidate.key === seed.board)
      if (!spec || !builds.has(spec.key)) continue
      const seeded = evaluateSeed(weapon, attack, spec.objective, spec.heavyMode ?? 'biggestHit', seed, scenarioFor(weapon, spec.headshot) ?? undefined)
      // "no fire rate" boards stay that way
      if (!seeded || (!spec.allowFireRateMods && (seeded.mods.some(({ mod, rank }) => raisesFireRate(mod.levelStats, rank)) || (seeded.arcane && raisesFireRate(seeded.arcane.arcane.levelStats))))) continue
      if (seeded.score > builds.get(spec.key)!.score) builds.set(spec.key, seeded)
    }
    for (const [key, build] of builds) if (build.score > 0) boards[key].push(toEntry(build))
  }
  return boards
}
`,F=`// which mods are worth trying for an attack, and which ones can't be equipped together
import { modsConflict } from '../calc/modConflicts'
import { parseUpgrade, raisesFireRate, type ModEffect } from '../calc/parseMod'
import { BANE_TARGET } from '../calc/constants'
import type { Mod } from '../types'

// effects that can raise damage in the neutral scenario. faction banes, headshot/weak point bonuses and
// utility stats can't, so mods with only those never make the pool. against a real target (Damage Cap, Compare) the
// bane for its faction and, on headshots, the weak point mods and Acuity get in too
export interface PoolTarget {
  faction: string
  headshot: boolean
}
const HEADSHOT_STATS = ['headshotMultiplier', 'weakpointDamage', 'weakpointCritChance']
const HEAVY_ONLY_STATS = ['heavyCritChance', 'heavyDamage', 'heavyWindUpSpeed']
// which attack the pool is for: heavy-only stats need a heavy, Seismic Wave a slam, Power Throw a throw
export interface PoolAttack {
  isHeavy: boolean
  name: string
  finisher?: boolean
}
const usefulEffect = (effect: ModEffect, includeFireRate: boolean, { isHeavy, name, finisher }: PoolAttack, target?: PoolTarget) => {
  // magazine/reload mods only matter for sustained/time-window objectives
  switch (effect.kind) {
    case 'damageType':
    case 'slashOnCrit':
    case 'slashOnImpact':
    case 'damageMultiplier':
    case 'heavyScaledCritChance':
    case 'flatStat':
    case 'forcedProcChance':
    case 'duplicateOnCrit':
    case 'napalm': // Nightwatch Napalm, only does anything on the rocket explosion
      return true
    case 'faction':
      return Boolean(target && BANE_TARGET[target.faction] === effect.faction)
    case 'stat':
      if (effect.value <= 0) return false
      if (['fireRate', 'magazineCapacity', 'reloadSpeed'].includes(effect.stat)) return includeFireRate
      if (effect.stat === 'heavyWindUpSpeed') return isHeavy && includeFireRate
      if (HEAVY_ONLY_STATS.includes(effect.stat)) return isHeavy
      if (effect.stat === 'slamDamage') return /slam/i.test(name)
      if (effect.stat === 'throwDamage') return /throw$/i.test(name)
      if (effect.stat === 'finisherDamage') return Boolean(finisher)
      if (HEADSHOT_STATS.includes(effect.stat)) return Boolean(target?.headshot)
      // heavy efficiency only changes what's left after the hit, not the hit itself
      return effect.stat !== 'heavyEfficiency'
    default:
      return false
  }
}

export function damageModPool(
  compatibleMods: Mod[], includeFireRate: boolean, attack: PoolAttack = { isHeavy: false, name: '' }, allowFireRateMods = true,
  target?: PoolTarget,
): Mod[] {
  // one per name (the highest-rank copy), like the in-game rule that same-named mods don't stack
  const byName = new Map<string, Mod>()
  for (const mod of compatibleMods) {
    const existing = byName.get(mod.name)
    if (!existing || mod.fusionLimit > existing.fusionLimit) byName.set(mod.name, mod)
  }
  return [...byName.values()].filter((mod) => {
    const parsed = parseUpgrade(mod.levelStats, mod.fusionLimit)
    // Acuity locks multishot and only pays off on headshots, which the neutral scenario doesn't do
    if (!target?.headshot && parsed.effects.some((effect) => effect.kind === 'lockMultishot')) return false
    if (!allowFireRateMods && raisesFireRate(mod.levelStats, mod.fusionLimit)) return false
    return [...parsed.effects, ...parsed.conditionals.map((conditional) => conditional.effect)].some((effect) =>
      usefulEffect(effect, includeFireRate, attack, target),
    )
  })
}

// same rules as the calculator's mod browser (src/calc/modConflicts.ts)
export const conflicts = (a: Mod, b: Mod) => modsConflict(a, b)
`,I=`import type { CalcResult } from '../calc/damage'
import type { HeavyMode } from '../data/heavyAttacks'

// what the leaderboard can rank by. each one is optimized separately, since the best build for sustained DPS
// (magazine/reload mods matter) isn't the best one for a single hit (fire rate doesn't matter at all)
export type ObjectiveId = 'sustained' | 'window3' | 'window10' | 'window30' | 'single' | 'attack' | 'ttk'

export interface Objective {
  id: ObjectiveId
  label: string
  unit: string
  description: string
  usesFireRate: boolean // fire rate, magazine and reload mods only matter when this is true
  score: (result: CalcResult) => number
}

export const TIME_WINDOWS = [3, 10, 30] as const

export const OBJECTIVES: Objective[] = [
  {
    id: 'sustained',
    label: 'Sustained DPS',
    unit: 'DPS',
    description: 'Average DPS over a 10 s fight on one enemy: reloads, status ticks as they land (Heat stacking included), DoT ticks after the fight ends not counted',
    usesFireRate: true,
    score: (result) => result.sustainedDps,
  },
  ...TIME_WINDOWS.map((seconds) => ({
    id: \`window\${seconds}\` as ObjectiveId,
    label: \`Damage in \${seconds} s\`,
    unit: \`in \${seconds} s\`,
    description: \`Total damage dealt in the first \${seconds} seconds of firing, reloads and DoT ticks inside the window included\`,
    usesFireRate: true,
    score: (result: CalcResult) => result.damageInWindow(seconds),
  })),
  {
    id: 'single',
    label: 'Single damage instance',
    unit: 'per hit',
    description: 'One hit from one projectile (or one melee swing, or one merged beam tick), crits averaged in, DoTs not included. Guns hit the head (weak point mods and Acuity in play, AoE can\\'t headshot), melee hits the body',
    usesFireRate: false,
    // a beam's extra beams merge into one tick on the target, so its single instance is the whole merged tick
    score: (result) => result.hit.average * result.beamMerge,
  },
  {
    // what a heavy / glaive detonation actually does: Glaive Prime's detonation lives on its forced Slash proc,
    // and Melee Duplicate's second strike is its own damage instance, so neither shows up in the single-hit score
    id: 'attack',
    label: 'Whole attack (hit + procs)',
    unit: 'per attack',
    description: 'Everything one attack does to the target: every pellet (and Melee Duplicate strike), crits averaged in, plus the full DoT of every proc it lands (Slash bleed, Heat burn...). One target, no fire rate',
    usesFireRate: false,
    score: (result) => result.attackTotal,
  },
]

// the Boss board's ranking: how fast one build kills a boss (target.pool). higher score = faster, so it's stored as 1 / seconds
// (past 10 minutes the time is extrapolated, see damage.ts timeToReach). the page shows the seconds back
export const TTK_OBJECTIVE: Objective = {
  id: 'ttk',
  label: 'Time to kill',
  unit: 's to kill',
  description: 'Seconds to strip the boss\\'s shields and empty its health, solo: expected damage over time with reloads, Incarnon refills and DoT ticks as they land',
  usesFireRate: true,
  score: (result) => (result.timeToKill && Number.isFinite(result.timeToKill) && result.timeToKill > 0 ? 1 / result.timeToKill : 0),
}
export const ttkSeconds = (score: number) => (score > 0 ? 1 / score : Infinity)

export const objectiveById = (id: ObjectiveId) => (id === 'ttk' ? TTK_OBJECTIVE : OBJECTIVES.find((objective) => objective.id === id)!)

// every precomputed ranking. the DPS-type ones get a second board optimized without fire rate / attack speed mods
export interface BoardSpec {
  key: string
  objective: Objective
  allowFireRateMods: boolean
  heavyMode?: HeavyMode
  heavyOnly?: boolean // only multi-hit Heavy Attacks get an entry, the page falls back to the normal board for the rest
  headshot?: boolean // guns score this board on headshots (scenario.ts SCENARIO_HEADSHOT), melee doesn't
}
export const boardKey = (id: ObjectiveId, allowFireRateMods: boolean) => (allowFireRateMods ? id : \`\${id}-nofr\`)
// "Count the full heavy": multi-hit Heavy Attacks scored with every hit added up
export const FULL_HEAVY_BOARD = 'single-fullheavy'
export const BOARDS: BoardSpec[] = [
  ...OBJECTIVES.flatMap((objective) =>
    [true, ...(objective.usesFireRate ? [false] : [])].map((allowFireRateMods) => ({
      key: boardKey(objective.id, allowFireRateMods),
      objective,
      allowFireRateMods,
      headshot: objective.id === 'single',
    })),
  ),
  { key: FULL_HEAVY_BOARD, objective: objectiveById('single'), allowFireRateMods: true, heavyMode: 'fullCombo', heavyOnly: true },
]
`,L=`// finds a strong build for one attack + objective in the fixed leaderboard scenario.
// beam search over a pruned mod pool, then single swaps, Incarnon perks, arcane, and elemental slot order.
// it's a heuristic, not a proof of the best build, but it's checked against hand-built meta builds.
import { resolveCoBehavior } from '../calc/conditionOverload'
import { calculate, statusTrigger, type CalcResult, type SelectedPassive } from '../calc/damage'
import type { HeavyMode } from '../data/heavyAttacks'
import { BONUS_ELEMENT_RANGE, BONUS_ELEMENTS, hasBonusElement, passivesFor, type BonusElement } from '../data/passives'
import { getIncarnonTiers, scenarioPerkStacks, type SelectedPerk } from '../calc/incarnon'
import { defaultConditionalStacks, parseUpgrade, raisesFireRate, utilityValue } from '../calc/parseMod'
import { getCompatibleArcanes, getCompatibleMods } from '../data'
import type { Arcane, Attack, Buffs, Debuffs, EquippedArcane, EquippedMod, Mod, TargetSettings, Weapon } from '../types'
import { conflicts, damageModPool } from './modPool'
import { modCatch } from '../calc/modTieBreak'
import type { Objective } from './objectives'
import { SCENARIO_BUFFS, SCENARIO_DEBUFFS, SCENARIO_TARGET } from './scenario'

const SLOT_COUNT = 8
const BEAM_WIDTH = 8
const MAX_SWAP_PASSES = 4
const MAX_ELEMENT_ORDERS = 120 // 5 elemental mods = 120 orders, more than that I just keep the found order

export interface OptimizedBuild {
  weapon: Weapon
  attack: Attack
  score: number
  result: CalcResult
  mods: EquippedMod[] // slot order matters for element combining
  arcane: EquippedArcane | null
  perks: SelectedPerk[]
  passives: SelectedPassive[]
  bonusElement: BonusElement | null
}

// mods and arcanes go in at max rank with conditionals at the scenario's stacks (src/calc/parseMod.ts triggerUptime):
// max for most, off for headshot-hit triggers (body shots), half for melee kills on a gun and armor thresholds
// noKills = the boss board: kill triggers sit at 0
// bodyShots = false on a headshot target: headshot-hit triggers come on too
export const equipMod = (mod: Mod, isMelee: boolean, noKills = false, bodyShots = true): EquippedMod => ({
  mod, rank: mod.fusionLimit, conditionalStacks: defaultConditionalStacks(mod.levelStats, mod.fusionLimit, { isMelee, bodyShots, noKills }),
})
export const equipArcane = (arcane: Arcane, isMelee: boolean, noKills = false, bodyShots = true): EquippedArcane => {
  const rank = arcane.levelStats.length - 1
  return { arcane, rank, conditionalStacks: defaultConditionalStacks(arcane.levelStats, rank, { isMelee, bodyShots, noKills }) }
}

const isElementalMod = (equipped: EquippedMod) =>
  parseUpgrade(equipped.mod.levelStats, equipped.rank).effects.some(
    (effect) => effect.kind === 'damageType' && !['impact', 'puncture', 'slash'].includes(effect.damageType),
  )

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield items
    return
  }
  for (let i = 0; i < items.length; i++) {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest]
  }
}

// the Compare tab's rules for one build path. the leaderboard never passes any, so its search is unchanged
export interface OptimizeConstraints {
  lockedMods?: EquippedMod[] // always equipped (a riven goes here too), they still count toward the 8 slots
  excludedModNames?: string[]
  lockedArcane?: EquippedArcane | 'none' | null // null = let the search pick
  excludedArcaneIds?: string[]
  lockedPerks?: Record<string, string | null> // tier -> perk name (null = nothing in that tier). unlisted tiers are searched
  excludedPerkNames?: string[]
  // crit chance limits on the final build. soft at first (the search needs a gradient to walk), flagged if missed
  maxCritChance?: number | null
  minCritChance?: number | null
  // the Calculator's target/debuffs/buffs instead of the leaderboard's neutral scenario
  scenario?: { target: TargetSettings; armor: number; debuffs: Debuffs; buffs: Buffs } | null
  beamWidth?: number
  // skip the target's extra mods (its bane, weak point mods). set internally for the second run, see the end of optimizeAttack
  neutralPool?: boolean
  // one target that never dies (the boss board): on-kill conditionals and kill-based passives off
  noKills?: boolean
  // set internally on the status-gated perk retries (end of optimizeAttack) so they don't retry again
  noPerkRetry?: boolean
}

// how far a result is from the crit limits, 0 = inside them
export const critViolation = (critChance: number, constraints?: OptimizeConstraints) =>
  Math.max(0, critChance - (constraints?.maxCritChance ?? Infinity)) + Math.max(0, (constraints?.minCritChance ?? -Infinity) - critChance)

// a build found elsewhere (the Compare tab), to be scored the leaderboard's way: same scenario, same passives,
// conditionals at the scenario's stacks. lets the leaderboard pick up builds its own search walks past
export interface SeedBuild {
  weaponId: string
  attack: string
  board: string
  mods: string[] // uniqueNames, slot order
  arcane: string | null
  perks: { tier: string; name: string }[]
  bonusElement?: BonusElement | null
}

export function evaluateSeed(weapon: Weapon, attack: Attack, objective: Objective, heavyMode: HeavyMode, seed: SeedBuild,
  scenario = { target: SCENARIO_TARGET, armor: 0, debuffs: SCENARIO_DEBUFFS, buffs: SCENARIO_BUFFS }): OptimizedBuild | null {
  const isMelee = weapon.category === 'Melee'
  const bodyShots = !scenario.target.headshot
  const compatible = new Map(getCompatibleMods(weapon).map((mod) => [mod.uniqueName, mod]))
  const mods = seed.mods.map((id) => compatible.get(id))
  // anything that no longer fits (data changed, wrong weapon) just means the seed is skipped
  if (mods.some((mod) => !mod) || mods.length > SLOT_COUNT) return null
  const equipped = mods.map((mod) => equipMod(mod!, isMelee, false, bodyShots))
  if (equipped.some((a, index) => equipped.some((b, other) => other > index && conflicts(a.mod, b.mod)))) return null
  const arcaneData = seed.arcane ? getCompatibleArcanes(weapon).find((option) => option.uniqueName === seed.arcane) : null
  if (seed.arcane && !arcaneData) return null
  const tiers = getIncarnonTiers(weapon.name) ?? []
  const perks: SelectedPerk[] = []
  for (const { tier, name } of seed.perks) {
    const perk = tiers.find((candidate) => candidate.tier === tier)?.perks.find((option) => option.name === name)
    if (!perk) return null
    perks.push({ perk, stacks: scenarioPerkStacks(perk, { isMelee, bodyShots }) })
  }
  const arcane = arcaneData ? equipArcane(arcaneData, isMelee, false, bodyShots) : null
  const passives = passivesFor(weapon.name).map((passive) => ({ passive, stacks: passive.condition ? passive.scenarioStacks ?? passive.maxStacks ?? 1 : 1 }))
  const bonusElement = hasBonusElement(weapon.name) ? seed.bonusElement ?? null : null
  const result = calculate({
    weapon, attack, mods: equipped, arcane, coBehavior: resolveCoBehavior(weapon, attack), incarnonPerks: perks, passives, bonusElement, heavyMode,
    target: scenario.target, armor: scenario.armor, debuffs: scenario.debuffs, buffs: scenario.buffs,
  })
  return { weapon, attack, score: objective.score(result), result, mods: equipped, arcane, perks, passives, bonusElement }
}

export function optimizeAttack(
  weapon: Weapon, attack: Attack, objective: Objective, allowFireRateMods = true, heavyMode: HeavyMode = 'biggestHit',
  constraints?: OptimizeConstraints,
): OptimizedBuild {
  const isMelee = weapon.category === 'Melee'
  const locked = constraints?.lockedMods ?? []
  const lockedNames = new Set(locked.map((equipped) => equipped.mod.name))
  const excludedNames = new Set(constraints?.excludedModNames ?? [])
  // a real target (Damage Cap, Compare) also lets its bane and, on headshots, weak point mods into the pool
  const scenarioTarget = constraints?.neutralPool ? undefined : constraints?.scenario?.target
  const pool = damageModPool(
    getCompatibleMods(weapon), objective.usesFireRate, { isHeavy: Boolean(attack.heavy), name: attack.name, finisher: attack.finisher }, allowFireRateMods,
    scenarioTarget ? { faction: scenarioTarget.faction, headshot: scenarioTarget.headshot } : undefined,
  )
    .filter((mod) => !constraints || (!excludedNames.has(mod.name) && !lockedNames.has(mod.name)))
    .map((mod) => equipMod(mod, isMelee, constraints?.noKills, !constraints?.scenario?.target.headshot))
  // "no fire rate mods" rankings skip fire rate arcanes too
  const excludedArcanes = new Set(constraints?.excludedArcaneIds ?? [])
  const arcaneOptions = getCompatibleArcanes(weapon)
    .filter((option) => allowFireRateMods || !raisesFireRate(option.levelStats))
    .filter((option) => !excludedArcanes.has(option.uniqueName))
    .map((option) => equipArcane(option, isMelee, constraints?.noKills, !constraints?.scenario?.target.headshot))
  const excludedPerks = new Set(constraints?.excludedPerkNames ?? [])
  const lockedPerks = constraints?.lockedPerks ?? {}
  const incarnonTiers = (getIncarnonTiers(weapon.name) ?? []).map((tier) => ({ ...tier, perks: tier.perks.filter((perk) => !excludedPerks.has(perk.name)) }))
  const coBehavior = resolveCoBehavior(weapon, attack)
  const scenario = constraints?.scenario ?? { target: SCENARIO_TARGET, armor: 0, debuffs: SCENARIO_DEBUFFS, buffs: SCENARIO_BUFFS }
  const beamWidth = constraints?.beamWidth ?? BEAM_WIDTH
  const slotCount = SLOT_COUNT - locked.length

  // Incarnon conditionals at the scenario's stacks (incarnon.ts scenarioPerkStacks), like mod conditionals
  const perkContext = { isMelee, bodyShots: !scenario.target.headshot, noKills: constraints?.noKills }
  const atScenario = (perk: SelectedPerk['perk']): SelectedPerk => ({ perk, stacks: scenarioPerkStacks(perk, perkContext) })
  let arcane: EquippedArcane | null = constraints?.lockedArcane && constraints.lockedArcane !== 'none' ? constraints.lockedArcane : null
  // locked tiers are set once up front and never revisited
  let perks: SelectedPerk[] = incarnonTiers.flatMap(({ tier, perks: options }) => {
    const perk = lockedPerks[tier] ? options.find((option) => option.name === lockedPerks[tier]) : undefined
    return perk ? [atScenario(perk)] : []
  })
  // passives at the scenario's stacks, Kuva/Tenet/Coda element picked below (at the max 60%)
  const passives: SelectedPassive[] = passivesFor(weapon.name).map((passive) => ({
    passive, stacks: !passive.condition ? 1 : constraints?.noKills && /kill/i.test(passive.condition) ? 0 : passive.scenarioStacks ?? passive.maxStacks ?? 1,
  }))
  let bonusElement: BonusElement | null = null

  const run = (mods: EquippedMod[]) =>
    calculate({
      weapon, attack, mods: locked.length ? [...locked, ...mods] : mods, arcane, coBehavior, incarnonPerks: perks, passives, bonusElement, heavyMode,
      target: scenario.target, armor: scenario.armor, debuffs: scenario.debuffs, buffs: scenario.buffs,
    })
  // outside the crit limits the score drops off steeply but smoothly, so the search can still tell which way is better
  // ties go to the mod without a catch (Vital Sense over Bladed Rounds, Serration over Heavy Caliber): a sliver off the
  // search score per conditional / Niche mod. far too small to beat any real difference
  const evaluate = (mods: EquippedMod[]) => {
    const result = run(mods)
    const score = objective.score(result) * (1 - 1e-7 * mods.reduce((total, { mod }) => total + modCatch(mod), 0))
    if (!constraints) return score
    const miss = critViolation(result.critChance, constraints)
    return miss > 0 ? score * Math.exp(-20 * miss) * 1e-3 : score
  }
  const fits = (mods: EquippedMod[], candidate: EquippedMod) =>
    !mods.some((equipped) => conflicts(equipped.mod, candidate.mod)) && !locked.some((equipped) => conflicts(equipped.mod, candidate.mod))

  // ---- 0. bonus element: try each one (the element changes which mods are good, so it's picked again later) ----
  const pickBonusElement = (mods: EquippedMod[]) => {
    if (!hasBonusElement(weapon.name)) return
    let bestElement: BonusElement | null = null
    let bestScore = -1
    for (const damageType of BONUS_ELEMENTS) {
      bonusElement = { damageType, value: BONUS_ELEMENT_RANGE.max }
      const score = evaluate(mods)
      if (score > bestScore) {
        bestScore = score
        bestElement = bonusElement
      }
    }
    bonusElement = bestElement
  }
  pickBonusElement([])

  // ---- 1. beam search: grow builds one mod at a time, keep the best few at each size ----
  let beam = [{ mods: [] as EquippedMod[], score: evaluate([]) }]
  for (let slot = 0; slot < slotCount; slot++) {
    const next = new Map<string, { mods: EquippedMod[]; score: number }>()
    for (const state of beam) {
      for (const candidate of pool) {
        if (!fits(state.mods, candidate)) continue
        const mods = [...state.mods, candidate]
        const key = mods.map((equipped) => equipped.mod.uniqueName).sort().join('|')
        const score = evaluate(mods)
        if ((next.get(key)?.score ?? -1) < score) next.set(key, { mods, score })
      }
    }
    if (!next.size) break // ran out of compatible mods
    beam = [...next.values()].sort((a, b) => b.score - a.score).slice(0, beamWidth)
  }
  let best = beam[0]

  // ---- 2. single swaps until nothing improves (catches pairs the beam missed) ----
  const swapPass = () => {
    for (let pass = 0; pass < MAX_SWAP_PASSES; pass++) {
      let improved = false
      for (let index = 0; index < best.mods.length; index++) {
        const others = best.mods.filter((_, other) => other !== index)
        for (const candidate of pool) {
          if (best.mods.some((equipped) => equipped.mod.uniqueName === candidate.mod.uniqueName) || !fits(others, candidate)) continue
          const mods = [...best.mods]
          mods[index] = candidate
          const score = evaluate(mods)
          if (score > best.score * (1 + 1e-9)) {
            best = { mods, score }
            improved = true
          }
        }
      }
      if (!improved) break
    }
  }

  // ---- 3. Incarnon perks: best option per evolution tier (conditional parts left off) ----
  const pickPerks = () => {
    for (const { tier, perks: options } of incarnonTiers) {
      if (tier in lockedPerks) continue
      // baseline is "no perk in this tier", otherwise re-checking the perk picked last pass only ties and gets dropped
      let bestPerk: SelectedPerk | null = null
      const withoutTier = perks.filter((selected) => !options.includes(selected.perk))
      perks = withoutTier
      let bestScore = evaluate(best.mods)
      for (const perk of options) {
        perks = [...withoutTier, atScenario(perk)]
        const score = evaluate(best.mods)
        if (score > bestScore * (1 + 1e-9)) {
          bestScore = score
          bestPerk = atScenario(perk)
        }
      }
      perks = bestPerk ? [...withoutTier, bestPerk] : withoutTier
      best = { ...best, score: evaluate(best.mods) }
    }
  }

  // ---- 4. arcane: try each compatible one ----
  const pickArcane = () => {
    if (constraints?.lockedArcane) {
      best = { ...best, score: evaluate(best.mods) }
      return
    }
    let bestArcane: EquippedArcane | null = null
    let bestScore = -1
    const utility = (option: EquippedArcane | null) => (option ? utilityValue(option.arcane.levelStats, option.rank, !objective.usesFireRate) : 0)
    for (const option of [null, ...arcaneOptions]) {
      arcane = option
      const score = evaluate(best.mods)
      // a tie (Merciless vs Deadhead on body shots) goes to the one with headshot / reload value on top
      const tied = bestScore > 0 && Math.abs(score - bestScore) <= bestScore * 1e-6
      if ((score > bestScore && !tied) || (tied && utility(option) > utility(bestArcane))) {
        bestScore = Math.max(score, bestScore)
        bestArcane = option
      }
    }
    arcane = bestArcane
    best = { ...best, score: bestScore }
  }

  // ---- 5. elemental slot order (elements combine in slot order) ----
  const orderElements = () => {
    const elementSlots = best.mods.map((equipped, index) => (isElementalMod(equipped) ? index : -1)).filter((index) => index >= 0)
    if (elementSlots.length < 2) return
    let checked = 0
    for (const order of permutations(elementSlots.map((index) => best.mods[index]))) {
      if (++checked > MAX_ELEMENT_ORDERS) break
      const mods = [...best.mods]
      elementSlots.forEach((slotIndex, orderIndex) => (mods[slotIndex] = order[orderIndex]))
      const score = evaluate(mods)
      if (score > best.score * (1 + 1e-9)) best = { mods, score }
    }
  }

  const repickBonusElement = () => {
    if (!hasBonusElement(weapon.name)) return
    pickBonusElement(best.mods)
    best = { ...best, score: evaluate(best.mods) }
  }

  repickBonusElement()
  pickPerks()
  pickArcane()
  swapPass()
  orderElements()
  repickBonusElement()
  swapPass()
  pickPerks()
  pickArcane()

  // the reported score is the real one, not the penalized search score
  const result = run(best.mods)
  const found: OptimizedBuild = { weapon, attack, score: objective.score(result), result, mods: [...locked, ...best.mods], arcane, perks, passives, bonusElement }
  // a bigger pool can walk the beam into a worse corner (Exalted Blade vs Grineer: the bane crowds out a better crit
  // build early), so with a real target I also search the plain pool and keep whichever ends up better
  const searchScore = (build: OptimizedBuild) => {
    const miss = critViolation(build.result.critChance, constraints)
    return miss > 0 ? build.score * Math.exp(-20 * miss) * 1e-3 : build.score
  }
  let winner = found
  if (scenarioTarget && (scenarioTarget.faction !== 'None' || scenarioTarget.headshot)) {
    const plain = optimizeAttack(weapon, attack, objective, allowFireRateMods, heavyMode, { ...constraints, neutralPool: true, noPerkRetry: true })
    if (searchScore(plain) > searchScore(winner) * (1 + 1e-9)) winner = plain
  }
  // perks that only work with a status the build brings itself (Furis's Stormburst needs Electricity, Latron's Riddled Target
  // Puncture). the perk pass runs on finished mods, and with no Electricity in them Stormburst does nothing (damage.ts turns
  // it off), so it never got picked and the mods never had a reason to add Electricity: Furis's leaderboard build was 619k,
  // Stormburst + Electricity is 1.42M. so every status-gated perk that didn't make it gets its own search with it locked in
  if (!constraints?.noPerkRetry) {
    for (const { tier, perks: options } of incarnonTiers) {
      if (tier in lockedPerks) continue
      for (const perk of options) {
        if (winner.perks.some((selected) => selected.perk === perk)) continue
        if (!perk.statements.some((statement) => statement.condition && statement.effect && statusTrigger(statement.condition))) continue
        const retry = optimizeAttack(weapon, attack, objective, allowFireRateMods, heavyMode, {
          ...constraints, lockedPerks: { ...lockedPerks, [tier]: perk.name }, noPerkRetry: true,
        })
        if (searchScore(retry) > searchScore(winner) * (1 + 1e-9)) winner = retry
      }
    }
  }
  return winner
}
`,R=`// the Rivens page's god-roll finder: which riven stats raise this attack the most once the other 7 mods are rebuilt
// around it. a riven is never worth much on its own (a Heat riven is worth less next to Hellfire, Multishot less next
// to Galvanized Chamber), so every candidate goes through the full optimizer with the riven locked in.
//  1. screen: each stat alone on a 2-stat + curse riven, at the roll you picked
//  2. combine: every 2- and 3-stat riven from the best screened stats (at most 3 elements in that shortlist, at most one
//     spliced stat per riven, like the game)
//  3. curses: the best riven's build with each curse swapped in, to see which ones cost nothing
// pure data in and out so it runs in a Web Worker (src/optimizer/rivenWorker.ts)
import { weaponsById } from '../data'
import { calculate } from '../calc/damage'
import { resolveCoBehavior } from '../calc/conditionOverload'
import { RIVEN_DISPOSITION, RIVEN_MOD_ID, canBeNegative, canBePositive, isSpliced, rivenMod, rivenPool, rivenRange, rivenTypeFor, statName, type RivenStat, type RivenType } from '../calc/riven'
import { optimizeAttack, type OptimizedBuild } from './optimize'
import { BOARDS } from './objectives'
import { toEntry, type WeaponEntry } from './leaderboardWeapon'
import { SCENARIO_BUFFS, SCENARIO_DEBUFFS, SCENARIO_TARGET } from './scenario'
import type { CompareScenario } from './compare'

export interface RivenSearchRequest {
  weaponId: string
  attackIndex: number
  board: string // leaderboard board key: 'sustained', 'window3', 'single'...
  scenario: CompareScenario | null // null = the leaderboard's neutral scenario
  roll: 'max' | 'average'
  // Incarnon evolutions to hold fixed, tier -> perk name (null = nothing in that tier). left out = the optimizer picks
  perks?: Record<string, string | null> | null
}

export interface RivenStatScore {
  tag: string
  name: string
  value: number // the roll it was tested at (display units)
  gain: number // vs no riven, 0.1 = +10%
  spliced: boolean
}

export interface RivenCandidate {
  stats: RivenStat[] // positives, then the curse
  score: number
  gain: number // vs no riven
  entry: WeaponEntry // the build around it (riven listed as RIVEN_MOD_ID)
}

export interface CurseScore { tag: string; name: string; value: number; change: number } // change in score, -0.02 = 2% worse

export interface RivenSearchResult {
  baseline: { score: number; entry: WeaponEntry }
  stats: RivenStatScore[] // screening, best first
  twoStat: RivenCandidate[]
  threeStat: RivenCandidate[]
  curses: CurseScore[] // for the best riven, least harmful first
  harmlessCurse: string
}

export type RivenProgress = { done: number; total: number; label: string }

// stats that never move a damage number in the calc (or need a scenario this search doesn't use)
const NO_DAMAGE = /AmmoMax|ProjectileSpeed|PunctureDepth|RecoilReduction|ZoomFov|MeleeRangeInc|ParryAngle|ComboDuration|SlideAttackCrit|MagazineReloadHolstered|AmmoEfficiency|ComboPointsOnHit|ComboInitialBonus|Finisher|SlamDamage/
const isFaction = (tag: string) => /FactionDamage/.test(tag)
const isElementTag = (tag: string) => /(Fire|Freeze|Electricity|Toxin|Gas|Corrosive|Viral|Radiation|Blast|Magnetic)DamageMod$/.test(tag)
const isWeakPoint = (tag: string) => /Weakpoint/.test(tag)
// a curse with nothing to hurt, used while the positives are searched (the "+ curse" layouts roll higher)
export const harmlessCurseFor = (type: RivenType) => (type === 'Melee' ? 'WeaponMeleeRangeIncMod' : 'WeaponZoomFovMod')

// a positive's god roll is the top of its range, a curse's is the mildest end (closest to 0)
const pick = (range: [number, number], roll: 'max' | 'average', negative: boolean) => {
  if (roll === 'average') return (range[0] + range[1]) / 2
  if (!negative) return range[1]
  return Math.abs(range[0]) < Math.abs(range[1]) ? range[0] : range[1]
}

// fills in the values for a set of tags, in the layout they make together
export function rollRiven(type: RivenType, positives: string[], curse: string | null, roll: 'max' | 'average'): RivenStat[] {
  const stats: RivenStat[] = [...positives.map((tag) => ({ tag, value: 0, negative: false })), ...(curse ? [{ tag: curse, value: 0, negative: true }] : [])]
  return stats.map((stat) => {
    const range = rivenRange(type, RIVEN_DISPOSITION, stats, stat)!
    return { ...stat, value: Number(pick(range, roll, stat.negative).toFixed(1)) }
  })
}

const combinations = <T>(items: T[], size: number): T[][] =>
  size === 0 ? [[]] : items.flatMap((item, index) => combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]))

export function searchRivens(request: RivenSearchRequest, onProgress: (progress: RivenProgress) => void = () => {}): RivenSearchResult {
  const weapon = weaponsById.get(request.weaponId)!
  const attack = weapon.attacks[request.attackIndex] ?? weapon.attacks[0]
  const type = rivenTypeFor(weapon)
  if (!type) throw new Error(\`\${weapon.name} can't take a riven\`)
  const spec = BOARDS.find((candidate) => candidate.key === request.board)!
  const scenario = request.scenario ?? { target: SCENARIO_TARGET, armor: 0, debuffs: SCENARIO_DEBUFFS, buffs: SCENARIO_BUFFS }
  const curse = harmlessCurseFor(type)
  const name = (tag: string) => statName(rivenPool(type).find((def) => def.tag === tag)!)

  const optimizeWith = (stats: RivenStat[] | null): OptimizedBuild => {
    const riven = stats ? rivenMod(weapon, { stats, polarity: 'madurai', drain: 18 }) : null
    return optimizeAttack(weapon, attack, spec.objective, spec.allowFireRateMods, spec.heavyMode ?? 'biggestHit', {
      lockedMods: riven ? [{ mod: riven, rank: riven.fusionLimit, conditionalStacks: 0 }] : [],
      lockedPerks: request.perks ?? undefined,
      scenario: request.scenario,
    })
  }
  // a riven dropped into a build found for something else, no searching: the riven goes first (where the optimizer puts
  // locked mods) and, on a full riven-less build, takes the slot of whichever mod it hurts least to lose
  const scoreIn = (other: OptimizedBuild, stats: RivenStat[]): OptimizedBuild => {
    const riven = rivenMod(weapon, { stats, polarity: 'madurai', drain: 18 })!
    const rest = other.mods.filter((equipped) => equipped.mod.uniqueName !== RIVEN_MOD_ID)
    const options = rest.length >= 8 ? rest.map((_, drop) => rest.filter((__, index) => index !== drop)) : [rest]
    let best: OptimizedBuild | null = null
    for (const others of options) {
      const mods = [{ mod: riven, rank: riven.fusionLimit, conditionalStacks: 0 }, ...others]
      const result = calculate({
        weapon, attack, mods, arcane: other.arcane, coBehavior: resolveCoBehavior(weapon, attack), incarnonPerks: other.perks,
        passives: other.passives, bonusElement: other.bonusElement, heavyMode: spec.heavyMode ?? 'biggestHit',
        target: scenario.target, armor: scenario.armor, debuffs: scenario.debuffs, buffs: scenario.buffs,
      })
      const score = spec.objective.score(result)
      if (!best || score > best.score) best = { ...other, mods, result, score }
    }
    return best!
  }
  // the optimizer is a beam search, and a riven with two elements can walk it into a weak corner (Phenmor with Gas +
  // Heat + Multishot came out below no riven at all). so every candidate also tries the builds already found for its
  // smaller pieces with this riven dropped in, and keeps the best. a 3-stat riven can't come out below its 2-stat parts
  const found = new Map<string, OptimizedBuild>()
  const keyOf = (tags: string[]) => [...tags].sort().join('+')
  const bestFor = (tags: string[], rolled: RivenStat[]): OptimizedBuild => {
    let best = optimizeWith(rolled)
    const subsets = tags.length === 1 ? [[] as string[]] : combinations(tags, tags.length - 1)
    for (const subset of subsets) {
      const other = found.get(keyOf(subset))
      if (!other) continue
      const tried = scoreIn(other, rolled)
      if (tried.score > best.score) best = tried
    }
    found.set(keyOf(tags), best)
    return best
  }

  const pool = rivenPool(type).filter((def) => !NO_DAMAGE.test(def.tag) && canBePositive(def.tag))
    .filter((def) => !isFaction(def.tag) || (scenario.target.faction !== 'None' && def.text.includes(scenario.target.faction)))
    .filter((def) => !isWeakPoint(def.tag) || scenario.target.headshot)
    .filter((def) => !(weapon.category === 'Melee' && /FireIterations/.test(def.tag)))
  // a rough total for the progress bar: baseline + screening + ~80 combos, fixed once the shortlist is known
  let total = pool.length + 1 + 80 + 1
  let done = 0
  const step = (label: string) => onProgress({ done: ++done, total, label })

  const baseline = optimizeWith(null)
  found.set('', baseline)
  step('No riven')

  const stats: RivenStatScore[] = pool.map((def) => {
    const rolled = rollRiven(type, [def.tag], curse, request.roll)
    const build = bestFor([def.tag], rolled)
    step(\`Testing \${statName(def)}\`)
    return { tag: def.tag, name: statName(def), value: rolled[0].value, gain: build.score / baseline.score - 1, spliced: isSpliced(type, def.tag) }
  }).sort((a, b) => b.gain - a.gain)

  // the shortlist to combine: elements stand in for each other (a second one mostly just combines with the first), so at
  // most the 3 best of them, then the best of everything else, 8 in all. combined two and three at a time, at most one
  // spliced stat per riven
  const helpful = stats.filter((stat) => stat.gain > 0.001)
  const elements = helpful.filter((stat) => isElementTag(stat.tag)).slice(0, 3)
  const others = helpful.filter((stat) => !isElementTag(stat.tag)).slice(0, 8 - elements.length)
  const shortlist = [...elements, ...others].sort((a, b) => b.gain - a.gain).slice(0, 8).map((stat) => stat.tag)
  const valid = (tags: string[]) => tags.filter((tag) => isSpliced(type, tag)).length <= 1
  const pairs = combinations(shortlist, 2).filter(valid)
  const triples = combinations(shortlist, 3).filter(valid)
  total = done + pairs.length + triples.length + 1
  const builds = new Map<RivenCandidate, OptimizedBuild>()
  const run = (tags: string[]): RivenCandidate => {
    const rolled = rollRiven(type, tags, curse, request.roll)
    const build = bestFor(tags, rolled)
    step(tags.map(name).join(' + '))
    const candidate = { stats: rolled, score: build.score, gain: build.score / baseline.score - 1, entry: toEntry(build) }
    builds.set(candidate, build)
    return candidate
  }
  const byScore = (a: RivenCandidate, b: RivenCandidate) => b.score - a.score
  const allPairs = pairs.map(run).sort(byScore)
  const allTriples = triples.map(run).sort(byScore)
  const twoStat = allPairs.slice(0, 6)
  const threeStat = allTriples.slice(0, 6)

  // curses on the best riven: same build and same positive rolls, only the curse changes. the curse's own layout
  // weight is the same for every curse, so this is purely "what does this stat do when it's negative"
  const best = [...allPairs, ...allTriples].sort(byScore)[0]
  const curses: CurseScore[] = []
  if (best) {
    const bestBuild = builds.get(best)!
    const positives = best.stats.filter((stat) => !stat.negative)
    const positiveTags = positives.map((stat) => stat.tag)
    const score = (rolled: RivenStat[]) => scoreIn({ ...bestBuild, mods: bestBuild.mods }, rolled).score
    const reference = score(best.stats)
    for (const def of rivenPool(type)) {
      if (!canBeNegative(type, def.tag) || positiveTags.includes(def.tag)) continue
      const curseRoll = rollRiven(type, positiveTags, def.tag, 'average').at(-1)!
      const rolled = [...positives, curseRoll]
      curses.push({ tag: def.tag, name: statName(def), value: curseRoll.value, change: score(rolled) / reference - 1 })
    }
    curses.sort((a, b) => b.change - a.change)
    step('Curses')
  }

  return { baseline: { score: baseline.score, entry: toEntry(baseline) }, stats, twoStat, threeStat, curses, harmlessCurse: name(curse) }
}
`,z=`// runs the Rivens page's god-roll search off the main thread, it's ~100 optimizer runs
import { searchRivens, type RivenProgress, type RivenSearchRequest, type RivenSearchResult } from './rivenSearch'

export type RivenMessage =
  | { type: 'progress'; id: number; progress: RivenProgress }
  | { type: 'done'; id: number; result: RivenSearchResult }
  | { type: 'error'; id: number; message: string }

self.onmessage = (event: MessageEvent<{ id: number; request: RivenSearchRequest }>) => {
  const { id, request } = event.data
  try {
    const result = searchRivens(request, (progress) => self.postMessage({ type: 'progress', id, progress } satisfies RivenMessage))
    self.postMessage({ type: 'done', id, result } satisfies RivenMessage)
  } catch (error) {
    self.postMessage({ type: 'error', id, message: String(error) } satisfies RivenMessage)
  }
}
`,B=`// the fixed setup every leaderboard build is scored against. the leaderboard is precomputed, so this has to be
// one neutral scenario: no faction, no armor, body shots, conditionals at max, and Condition Overload/Galvanized
// counting only the status types the build itself deals (base physical + modded elements)
import { STATUS_TYPES } from '../calc/constants'
import type { Buffs, Debuffs, TargetSettings } from '../types'

export const SCENARIO_DESCRIPTION =
  'Neutral target (no faction, no armor, body shots; gun single hits are headshots so weak point builds like Acuity show up), mod/arcane conditionals at max stacks (headshot-hit triggers off, headshot-kill triggers like Deadhead on, melee-kill triggers on guns and armor thresholds like Bulwark at half; ties go to the arcane with headshot/reload value), Condition Overload/Galvanized count only the build\\'s own damage types, melee Normal Attacks as the best stance combo of their class on repeat (wiki stance tables: hits, damage multipliers and length at 1.0 attack speed), melee at max combo (12x) with heavy attacks (glaive detonations included) ranked by single hit or whole attack only, rank 30 with enough Forma (capacity ignored), no rivens, exalted weapons at 100% Ability Strength (pseudo-exalted ones at the 12x combo).'

export const SCENARIO_TARGET: TargetSettings = {
  faction: 'None',
  layer: 'health',
  enemyId: null,
  baseLevel: 1,
  level: 1,
  steelPath: false,
  manualArmor: 0,
  headshot: false,
  headshotMultiplier: null,
  headcrit: null,
}

// the Single damage instance board aims for the head with guns: a single hit is the one number where weak point builds (Primary /
// Secondary Acuity: "+350% Weak Point Critical Chance. Multishot cannot be modified.") matter. melee stays on body hits
export const SCENARIO_HEADSHOT_TARGET: TargetSettings = { ...SCENARIO_TARGET, headshot: true }

export const SCENARIO_DEBUFFS: Debuffs = {
  stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, 0])),
  heatArmorStrip: 0,
  corrosiveProjections: 0,
  otherArmorReduction: 0,
  damageVulnerability: 0,
  liftedOrKnockedDown: false,
  statusTypeSource: 'build',
}

// melee at max combo (clamped per weapon: 12x, Venka Prime 13x, Dex Nikana 11x). Blood Rush builds hold max combo
// in a real fight, and heavies are usually thrown at max combo too
export const SCENARIO_COMBO = 13
export const SCENARIO_BUFFS: Buffs = { roar: 0, combo: SCENARIO_COMBO, gladiatorWarframePieces: 0 }

export const SCENARIO_HEADSHOT = { target: SCENARIO_HEADSHOT_TARGET, armor: 0, debuffs: SCENARIO_DEBUFFS, buffs: SCENARIO_BUFFS }
`,V=t(),H=`src/optimizer/optimize.ts`,U=`src/calc/simulate.ts`,W=`src/calc/damage.ts`,G=[{id:`leaderboard`,title:`Leaderboard rebuild`,where:`Leaderboard, Compare, Data Analysis`,summary:`Precomputes the best build for every weapon attack on every ranking, offline, and only redoes the weapons whose inputs changed.`,complexity:String.raw`O\!\left(\frac{|W_s|\,\bar A\,|\mathcal B|\;T_{opt}}{p}\right)`,sources:[{file:`scripts/build-leaderboard.ts`,symbol:`main`},{file:`scripts/build-leaderboard.ts`,symbol:`runShard`},{file:`scripts/build-leaderboard.ts`,symbol:`writeFile`},{file:`scripts/leaderboardFingerprint.ts`},{file:`src/optimizer/leaderboardWeapon.ts`,symbol:`optimizeWeapon`},{file:`src/optimizer/objectives.ts`,symbol:`BOARDS`}],steps:[`Fingerprint: one engine hash over the generic code every weapon runs through (comment lines and whitespace stripped), and one hash per weapon over its own data plus the outputs of every lookup it hits (the parsed mods it can equip, its passives, Incarnon perks, stance...).`,`A weapon is stale when the engine hash or its own hash changed (or it was named with --only). --boards limits the re-optimizing to some boards and keeps the rest from the old file.`,`Stale weapons are dealt round-robin to one worker process per core (max 12), each running a pre-bundled copy of the script.`,`Per weapon: every attack that does damage (reload/expiry/turret events and headshot-only parts skipped) × every board goes through the build optimizer. Heavies and gated alt-fires skip the fire-rate boards. Guns on the Single damage instance board are scored on headshots.`,`On fire-rate boards, the build found without fire-rate mods replaces the normal one if it scores higher (the search is a heuristic).`,`Whole shots ("A + B") are re-scored with every build found for their parts, plus any saved Compare seeds; a seed only replaces the entry if it scores higher.`,`Kept and new entries are merged, each board is sorted by score, and the file is written compact: mods, arcanes and weapons become indexes into shared tables.`],equations:[{name:`Total work`,tex:String.raw`T = \frac{1}{p}\sum_{w \in W_s}\;\sum_{a \in A_w}\;\sum_{b \in \mathcal{B}} T_{opt}(w, a, b)`,complexity:String.raw`O\!\left(|W_s|\,\bar A\,|\mathcal B|\,T_{opt} / p\right)`,note:`W_s = stale weapons, A_w = the weapon's attacks, 𝓑 = boards (11 today), p = worker processes. T_opt is the build optimizer below.`},{name:`Staleness test`,tex:String.raw`\text{stale}(w) \iff H_{engine} \neq H'_{engine} \;\lor\; H_w \neq H'_w \;\lor\; w \in \text{--only}, \qquad H = \operatorname{sha256}(\cdot)_{[0,16)}`,complexity:String.raw`O(|\text{source}| + \sum_w |\text{lookups}_w|)`},{name:`Fire-rate fallback and seeds`,tex:String.raw`E_b(w,a) = \operatorname*{arg\,max}_{x \,\in\, \{x_b,\; x_{b\text{-nofr}}\} \,\cup\, \{\text{seed}(s) : s \in \text{parts}(a) \cup \text{seeds}\}} f_b(x)`,complexity:String.raw`O(|\text{seeds}|\cdot C)`},{name:`Merge and sort`,tex:String.raw`\text{board}_b = \operatorname{sort}_{\downarrow f}\big(\text{kept}_b \cup \text{new}_b\big)`,complexity:String.raw`O\!\left(\textstyle\sum_b N_b \log N_b\right)`}]},{id:`optimizer`,title:`Build optimizer (beam search)`,where:`Leaderboard, Compare, Rivens, Damage Cap, Boss board`,summary:`Finds a strong 8-mod build plus arcane, Incarnon evolutions, bonus element and element order for one attack and one goal. A heuristic, not an exhaustive search: checked against hand-built meta builds.`,complexity:String.raw`O\big((SB|P| + 2RS|P| + 2|\mathcal A| + 2\textstyle\sum_t|E_t| + 120)\,C\,(1+g)\big)`,sources:[{file:H,symbol:`optimizeAttack`},{file:H,symbol:`SLOT_COUNT`},{file:H,symbol:`BEAM_WIDTH`},{file:H,symbol:`MAX_SWAP_PASSES`},{file:H,symbol:`MAX_ELEMENT_ORDERS`},{file:H,symbol:`critViolation`},{file:`src/optimizer/modPool.ts`,symbol:`damageModPool`},{file:`src/optimizer/modPool.ts`,symbol:`usefulEffect`}],steps:[`Pool: one copy per mod name (highest rank), only mods with an effect that can raise this goal's number (fire rate / magazine / reload only on time-based goals, banes only against their faction, weak point mods and Acuity only on headshots, heavy-only stats only on heavies).`,`Bonus element (Kuva / Tenet / Coda): each element tried at the max value.`,`Beam search: grow builds one mod at a time, keep the best B = {{src/optimizer/optimize.ts#BEAM_WIDTH}} distinct mod sets at each size, for S = {{src/optimizer/optimize.ts#SLOT_COUNT}} slots. Incompatible pairs (same family, exclusive mods) are skipped.`,`Then, twice over: re-pick the bonus element, pick the best evolution per Incarnon tier, pick the arcane (ties go to the one with headshot / reload value), single-mod swaps until nothing improves (up to {{src/optimizer/optimize.ts#MAX_SWAP_PASSES}} passes), and try every slot order of the elemental mods (they combine in slot order), up to {{src/optimizer/optimize.ts#MAX_ELEMENT_ORDERS}} orders.`,`Against a real target (faction or headshot), the whole search runs again on the plain pool and the better one wins: a bane can crowd out a better crit build early.`,`Status-gated evolutions that weren't picked (Furis's Stormburst needs Electricity) each get a full search with the evolution locked in, since the mods never had a reason to add the status it needs.`],equations:[{name:`Search score`,tex:String.raw`s(M) = f(M)\,\Big(1 - 10^{-7}\!\sum_{m \in M}\kappa(m)\Big)\cdot\begin{cases}1 & \mu = 0\\[2pt] 10^{-3}\,e^{-20\mu} & \mu > 0\end{cases},\qquad \mu = \max(0, c - c_{max}) + \max(0, c_{min} - c)`,complexity:`O(C)`,note:`f = the goal's score from one damage calc, κ = 1 per catch (conditional or Niche mod) so ties go to the cleaner mod, μ = how far the crit chance c is outside the Compare tab's crit limits. The penalty is steep but smooth so the search still has a slope.`},{name:`Beam step`,tex:String.raw`\mathcal{B}_{k+1} = \operatorname{top}_{B}\Big\{\, M \cup \{m\} \;:\; M \in \mathcal{B}_k,\; m \in P,\; m \perp M \,\Big\},\qquad B = {{src/optimizer/optimize.ts#BEAM_WIDTH}},\; k < S = {{src/optimizer/optimize.ts#SLOT_COUNT}}`,complexity:String.raw`O(S\,B\,|P|\cdot C)`,note:`Builds are keyed by their sorted mod set, so the same set reached in two orders counts once.`},{name:`Swap pass`,tex:String.raw`M \leftarrow M[i \mapsto m] \;\text{ if }\; s(M[i \mapsto m]) > s(M)(1 + 10^{-9}),\qquad i \le S,\; m \in P,\; \le R = {{src/optimizer/optimize.ts#MAX_SWAP_PASSES}} \text{ passes}`,complexity:String.raw`O(R\,S\,|P|\cdot C)`},{name:`Evolutions, arcane, element order`,tex:String.raw`e_t^* = \operatorname*{arg\,max}_{e \in E_t \cup \{\varnothing\}} s(M \mid e),\quad a^* = \operatorname*{arg\,max}_{a \in \mathcal{A} \cup \{\varnothing\}} s(M \mid a),\quad \sigma^* = \operatorname*{arg\,max}_{\sigma \in \mathfrak{S}_k} s(\sigma M)`,complexity:String.raw`O\big((\textstyle\sum_t |E_t| + |\mathcal A| + \min(k!, 120))\cdot C\big)`,note:`k = elemental mods in the build, so 5 elements = 120 orders.`},{name:`Retries`,tex:String.raw`x^* = \operatorname*{arg\,max}\big\{x,\; x_{\text{plain pool}},\; x_{e_1 \text{ locked}},\dots, x_{e_g \text{ locked}}\big\}`,complexity:String.raw`O\big((1 + [\text{real target}] + g)\,T_{opt}\big)`,note:`g = status-gated evolutions not picked by the first search.`}]},{id:`damage-cap`,title:`Damage Cap ladder`,where:`Damage Cap`,summary:`How much has to stack up for one hit to pass the damage limit, as a ladder of steps that each add one layer and re-optimize for the biggest single instance.`,complexity:String.raw`O\big(8\,T_{opt} + |F|\,K\,C + \tbinom{n+4}{5}\, T_{frame}\big)`,sources:[{file:`src/optimizer/damageCap.ts`,symbol:`runCapLadder`},{file:`src/optimizer/damageCap.ts`,symbol:`combos`},{file:`src/optimizer/damageCap.ts`,symbol:`searchFrames`},{file:`src/optimizer/damageCap.ts`,symbol:`searchShards`},{file:`src/optimizer/damageCap.ts`,symbol:`searchPriming`},{file:`src/optimizer/damageCap.ts`,symbol:`searchAllies`},{file:`src/optimizer/frameBuild.ts`,symbol:`optimizeFrameMods`}],steps:[`1. Mods, weapon arcane and Incarnon, optimized for the peak hit against a level 9,999 Steel Path Heavy Gunner. 2. + headshot (never on AoE, off for melee unless asked).`,`3. + solo priming: the statuses the build applies itself plus a companion's (Diriga stands in for every primer). Companion picked, mods re-optimized for those debuffs, companion picked again on the new build.`,`4. + Warframe arcanes and 5. + Archon Shards on "any Warframe" with nothing cast: every Tauforged 5-shard multiset, each with a quick frame mod search, then the best few searched properly.`,`6. + your Warframe: every frame's own modeled abilities (every combination of one option per ability, capped at 400) plus one Helminth subsume, screened at a reference Strength; the shortlist gets a real frame mod build (beam search over 8 slots + aura + exilus, sets placed whole) and the weapon mods re-optimized.`,`7. + enemy debuffs maxed, 8. + allies: one teammate at a time, the frame that adds the most on top.`],equations:[{name:`Peak hit (what each step maximizes)`,tex:String.raw`\text{peak} = D_{\text{vs target, no crit}}\cdot\big(1 + \lceil c\rceil (M - 1)\big)\cdot \text{beamMerge}\cdot\text{batteryScale}`,complexity:`O(C)`,note:`The top crit tier, not the average: the cap is about the biggest number one hit can show.`},{name:`Ability setups per frame`,tex:String.raw`|\text{setups}| = \min\Big(400,\; \prod_{g \in G} \big(|O_g| + [g \text{ optional}]\big)\Big) \times |\text{subsumes}|`,complexity:String.raw`O(|F|\cdot K \cdot C)`,note:`F = frames, K = setups per frame after the cap.`},{name:`Archon Shard sets`,tex:String.raw`\#\text{multisets} = \binom{n + 5 - 1}{5}`,complexity:String.raw`O\big(\tbinom{n+4}{5}\, T_{frame}\big)`,note:`n = shard options that can matter for this weapon class, 5 slots, order doesn't matter.`},{name:`Frame mod beam`,tex:String.raw`\mathcal{L}_{r+1} = \operatorname{top}_{6}\big\{\, \text{place}(L, m) : L \in \mathcal{L}_r,\; m \in P_f \cup \text{sets}\,\big\},\quad r \le 8 + \text{aura} + 1`,complexity:String.raw`O\big((8 + a)\cdot 6 \cdot |P_f| \cdot C\big)`}]},{id:`riven`,title:`Riven god-roll search`,where:`Rivens`,summary:`Which riven stats raise an attack the most once the other 7 mods are rebuilt around it. Every candidate riven goes through the full optimizer with the riven locked in.`,complexity:String.raw`O\big((1 + |S_r| + 84 + |K_r|)\,T_{opt}\big)`,sources:[{file:`src/optimizer/rivenSearch.ts`,symbol:`searchRivens`},{file:`src/optimizer/rivenSearch.ts`,symbol:`rollRiven`}],steps:[`Baseline: the attack's best build with no riven.`,`Screen: each stat alone on a 2-stat + curse riven, at the max or average roll, full optimizer run each.`,`Shortlist: at most the 3 best elements (a second element mostly just combines with the first) and the best of everything else, 8 in all.`,`Combine: every 2- and 3-stat riven from the shortlist with at most one spliced stat. Each also tries the builds already found for its smaller parts with the riven dropped in, so a 3-stat riven never scores below its 2-stat parts.`,`Curses: the best riven's build with each curse swapped in, same positives, to see which curses cost nothing.`],equations:[{name:`Candidates`,tex:String.raw`|R| = \binom{8}{2} + \binom{8}{3} = 28 + 56 = 84 \;(\text{minus rivens with two spliced stats})`,complexity:String.raw`O(84\, T_{opt})`},{name:`Riven value`,tex:String.raw`v(r) = \frac{\max\big(f(x^*_r),\; \max_{r' \subset r} f(x^*_{r'} \oplus r)\big)}{f(x^*_\varnothing)} - 1`,complexity:String.raw`O(2^{|r|}\,C)`,note:`x*_r = the optimizer's build with riven r locked, x ⊕ r = an existing build with r dropped into its weakest slot.`}]},{id:`boss`,title:`Boss time-to-kill and damage attenuation`,where:`Leaderboard (Boss board)`,summary:`Ranks builds by seconds to strip a Steel Path boss's shields and health, solo, with the wiki's damage attenuation model on top of normal damage.`,complexity:String.raw`O\big(T_{opt}^{est} + \tfrac{T_{max}}{\Delta t}\,\bar n\big)`,sources:[{file:`src/optimizer/bossLeaderboard.ts`,symbol:`optimizeWeaponBoss`},{file:`src/optimizer/bossLeaderboard.ts`,symbol:`BOSS_ATTENUATION`},{file:U,symbol:`attenuationBins`},{file:U,symbol:`attenuatedTimeToKill`},{file:U,symbol:`BIN`},{file:U,symbol:`LAMBDA`},{file:W,symbol:`timeToReach`},{file:W,symbol:`calculate`},{file:W,symbol:`SHOTGUN_COMPENSATION`}],steps:[`The search scores builds on a quick estimate (attenuation applied to the average rate), then the winner is re-scored with the exact bin simulation. Score = 1 / seconds.`,`Per trigger, Reinhard tone mapping caps one shot's damage softly at MDPT; a bucket B tracks the mapped damage of the last second and scales everything down by MDPS / B when it's over.`,`The caps are shares of the boss's max health (health only, no shields): {{src/optimizer/bossLeaderboard.ts#BOSS_ATTENUATION}}. The per-trigger 5% is on both Hemocyte's and Lephantis's wiki pages; the per-second 20% only on Hemocyte's. Multi-pellet weapons get {{src/calc/damage.ts#SHOTGUN_COMPENSATION}}× the per-trigger cap (the standardized model's ShotgunCompensation; where it applies is my guess). The boards are marked untested.`,`Steps of Δt = {{src/calc/simulate.ts#BIN}} s out to 600 s. DoT ticks go into the bucket but skip the per-trigger step. Merged attacks (Onos's beam + blast) map each part's hits separately.`,`Without attenuation, time to reach an amount: secant steps from the steady rate, then a few halvings over the killing shot's interval. Past 10 minutes it's extrapolated so weak builds still have a slope.`],equations:[{name:`Per-trigger mapping (Reinhard)`,tex:String.raw`\hat d = \frac{M_t\, D}{D + M_t},\qquad D = \bar h\cdot\text{multishot},\qquad M_t = \text{perTrigger}\cdot HP\cdot k_{sg},\quad k_{sg} = \begin{cases}{{src/calc/damage.ts#SHOTGUN_COMPENSATION}} & \text{base multishot} > 1\\ 1 & \text{otherwise}\end{cases}`,complexity:`O(1)`},{name:`Rate bucket (damped follower)`,tex:String.raw`B'' + 2\lambda B' + \lambda^2 B = \lambda^2 Q,\quad \lambda = {{src/calc/simulate.ts#LAMBDA}},\qquad d_{out} = \hat d\cdot\min\!\Big(1, \frac{M_s}{B}\Big),\quad M_s = \text{perSecond}\cdot HP`,complexity:String.raw`O(T_{max}/\Delta t)`,note:`Q = mapped damage over the last 1 s. B jumps up to Q when Q > B and decays toward it otherwise.`},{name:`Time to reach (no attenuation)`,tex:String.raw`t_{n+1} = t_n + \frac{A - D(t_n)}{\dot D},\;\; n < N_{sec};\qquad \text{then bisect } [t_k - \tfrac1r,\, t_k] \text{ five times}`,complexity:String.raw`O\big((N_{sec} + 5)\cdot N_{shots}\big)`}]},{id:`compare`,title:`Compare build paths`,where:`Compare › Build Paths`,summary:`Runs the build optimizer once per path (a set of rules: locked or banned mods, a riven, a fixed arcane or evolution, crit limits) per goal, so different build philosophies can be compared side by side.`,complexity:String.raw`O(|\text{paths}|\cdot|\text{boards}|\cdot T_{opt})`,sources:[{file:`src/optimizer/compare.ts`,symbol:`runPath`},{file:`src/optimizer/compare.ts`,symbol:`constraintsFor`}],steps:[`Each path becomes optimizer constraints: locked mods (a riven too), excluded mods, locked or excluded arcane and evolutions, min / max crit chance.`,`"Thorough" doubles the beam width (8 → 16). Runs in a Web Worker so the page stays responsive.`],equations:[{name:`One cell`,tex:String.raw`x_{p,b} = \operatorname{optimize}\big(w, a, b \mid \text{constraints}(p)\big),\qquad B = \begin{cases}16 & \text{thorough}\\ 8 & \text{otherwise}\end{cases}`,complexity:String.raw`O(S\,B\,|P|\cdot C)`}]},{id:`advisor`,title:`Build Advisor`,where:`Calculator`,summary:`How much each stat is worth to this exact build right now, the best real mod for it, which slots carry the least, and greedy build paths. Everything is measured by running the calc with one more or one less mod.`,complexity:String.raw`O\big((|\Lambda| + S + |P| + 3 S |P|)\cdot C\big)`,sources:[{file:`src/calc/advisor.ts`,symbol:`advise`},{file:`src/calc/advisor.ts`,symbol:`greedyPath`},{file:`src/calc/advisor.ts`,symbol:`pathWithArcane`},{file:`src/calc/advisor.ts`,symbol:`buildPaths`},{file:`src/calc/advisor.ts`,symbol:`rankingScorer`},{file:`src/calc/advisor.ts`,symbol:`DOT_WEIGHT_OFF_DOT_WEAPON`}],steps:[`Lever weights: each stat (damage, crit, each element, faction...) is added at one typical mod's worth (or the biggest mod still available for it) and the score change is read off.`,`Slot values: the build with each mod vs without it.`,`Best and cheapest real mod per stat: added to a free slot, or swapped for the weakest slot when the build is full; cheapest = most gain per capacity point.`,`Over-stacking: a stat with 2+ mods where swapping one of them for the best mod of another stat makes the build bigger.`,`Build paths: greedy, one slot at a time, always the mod that adds the most right now; then the best arcane, then the mods again with it in, until it settles. Three forks: pure greedy, crit only, status only.`,`Status DoTs count at {{src/calc/advisor.ts#DOT_WEIGHT_OFF_DOT_WEAPON}}× in the rankings unless the weapon is built for them (25%+ base status, a beam, or forced procs).`],equations:[{name:`Lever weight`,tex:String.raw`w_\ell = \frac{f(M \oplus \delta_\ell) - f(M)}{f(M)}`,complexity:String.raw`O(|\Lambda|\cdot C)`,note:`Damage is a product of buckets, so adding to a bucket that's already big moves the product less: that's over-stacking in numbers.`},{name:`Slot contribution`,tex:String.raw`\gamma_m = \frac{f(M)}{f(M \setminus \{m\})} - 1`,complexity:String.raw`O(S\cdot C)`},{name:`Greedy path`,tex:String.raw`M_{k+1} = M_k \cup \Big\{\operatorname*{arg\,max}_{m \in P,\, m \perp M_k} f(M_k \cup \{m\})\Big\}`,complexity:String.raw`O(S\,|P|\cdot C)\text{ per pass}`}]},{id:`damage`,title:`Damage calculation`,where:`Every page`,summary:`One attack, one build, one target: base damage through mods, element combining, quantization, crit, multishot, armor and faction, status procs and DoTs, then magazine and reload. Everything else on the site calls this.`,complexity:String.raw`O(L + T + N_{shots})`,sources:[{file:W,symbol:`calculateOnce`},{file:W,symbol:`calculate`},{file:W,symbol:`quantize`},{file:`src/calc/target.ts`,symbol:`scaleArmor`},{file:`src/calc/target.ts`,symbol:`armorDamageMultiplier`},{file:`src/calc/constants.ts`,symbol:`COMBINED_ELEMENTS`}],steps:[`Collect every mod, arcane, passive, Warframe ability, combo and Incarnon effect into stat buckets. Conditionals at the scenario's stacks (per-shell stacks like Felarx's Mounting Momentum capped at the base form's magazine).`,`Damage types: physical types scaled by their own mods, elements added in slot order and combined two at a time, each final type quantized to 1/32 of base damage.`,`Crit (tiers above 100%, headcrit, Cold's crit damage), faction, multishot, fire rate.`,`Target: armor (scaled by level, clamped, stripped by Heat / Corrosive / Corrosive Projection), faction weaknesses, headshot, vulnerability.`,`Status: procs per second split by each type's share of damage, DoT ticks per proc, Heat stacks refreshing together.`,`Magazine and reload (shell-by-shell where it applies), Incarnon battery and refill, then the sustained and time-window numbers via the shot simulator.`],equations:[{name:`Quantization`,tex:String.raw`q(p) = \frac{\operatorname{sgn}(p)\,\big\lfloor 32|p| + 0.5\big\rfloor}{32},\qquad D_t = q\!\left(p_t\right)\cdot D_{base}(1 + \beta)`,complexity:`O(T)`,note:`p_t = the type's share of base damage after its mods, β = base damage mods (Serration...).`},{name:`Crit`,tex:String.raw`\bar m_{crit} = 1 + c\,(M - 1),\qquad m_{\text{low tier}} = 1 + \lfloor c\rfloor (M-1),\qquad m_{\text{high tier}} = 1 + \lceil c\rceil (M-1)`,complexity:`O(1)`,note:`Above 100% crit the lowest tier is the "normal" hit and the next tier up is the "crit". M includes headcrit (×2 on the base) and Cold's bonus.`},{name:`Armor`,tex:String.raw`A(q) = \operatorname{clamp}\!\Big(A_0\big(\ell + (h - \ell)\,s\big),\,200,\,2700\Big),\;\; \ell = 1 + 0.005\,q^{1.75},\; h = 1 + 0.4\,q^{0.75},\; s = \operatorname{smoothstep}\!\Big(\tfrac{q - 70}{10}\Big)`,complexity:`O(1)`},{name:`Armor damage multiplier`,tex:String.raw`\text{DM}(A) = 1 - 0.9\sqrt{A / 2700}`,complexity:`O(1)`},{name:`Status procs`,tex:String.raw`\lambda_t = s \cdot n_{hit} \cdot r \cdot \frac{w_t}{\sum_u w_u}`,complexity:`O(T)`,note:`s = status chance, n_hit = hits per attack, r = fire rate, w_t = the type's modded damage (separate elements excluded).`}]},{id:`simulate`,title:`Time windows and sustained DPS`,where:`Calculator, Leaderboard`,summary:`Damage over a stretch of time: shots on the fire rate, magazine and reload, status procs ticking on their own clocks. A deterministic expected version for the optimizer and a Monte Carlo version for the bad-luck / good-luck range.`,complexity:String.raw`O(N_{shots}\cdot T\cdot \bar k)`,sources:[{file:U,symbol:`shotTimes`},{file:U,symbol:`expectedDamage`},{file:U,symbol:`simulateDamage`},{file:U,symbol:`heatExpiries`},{file:U,symbol:`ticksInside`}],steps:[`Shot times from t = 0: a full magazine at the fire rate, then a reload, and so on, until the window closes.`,`Each shot adds its expected direct damage and, per status type, its expected procs' DoT ticks that land inside the window (and before the proc expires).`,`Heat: every stack refreshes on a new Heat proc, so stacks die together only when no new Heat proc lands within one duration.`,`Monte Carlo: crits and procs rolled per pellet with a seeded mulberry32 RNG, runs capped at ~400k pellet rolls (60–300 runs).`],equations:[{name:`Shot times`,tex:String.raw`t_{k+1} = t_k + \frac1r + R\cdot\big[(k+1) \bmod m = 0\big]`,complexity:String.raw`O(N_{shots})`},{name:`Expected damage in a window`,tex:String.raw`E[D(T)] = \sum_{k} \Big(\bar h + \sum_{t} \pi_t\, \bar\tau_t \cdot \#\{\, j : t_k + \phi_t + j < \min(T,\; t_k + d_t) \,\}\Big)`,complexity:String.raw`O(N_{shots}\cdot T\cdot \bar k)`,note:`π_t = expected procs of type t per shot, τ̄_t = average tick, φ_t = first tick delay, d_t = duration, k̄ = ticks per proc.`}]},{id:`incarnon`,title:`Incarnon battery and refill`,where:`Calculator, Leaderboard`,summary:`Incarnon forms fire a fixed battery of charges, then have to be refilled from the normal form with weak point hits. The refill counts as the form's "reload".`,complexity:`O(1)`,sources:[{file:W,symbol:`INCARNON_SWAP_RELOADS`},{file:W,symbol:`calculateOnce`},{file:`src/data/reloads.ts`,symbol:`SHELL_BY_SHELL_RELOAD`}],steps:[`Charges come back per weak point hit (wiki: "each charge producing 3 rounds" on Vasto). Every normal-form bullet is assumed to land on a weak point (Torid / Angstrum count direct hits): the best case.`,`Hits land at the normal form's own rate (its fire rate mods count) times its projectiles, reloads included.`,`Switching forms takes {{src/calc/damage.ts#INCARNON_SWAP_RELOADS}}× the base form's reload each way (reload speed mods don't shorten it).`,`Ammo Efficiency (mods, arcanes, evolutions) never stretches the charges: they aren't ammo.`,`The refill's reloads are the base form's: shell-by-shell weapons (Felarx, Strun) reload shell by shell with the base form's modded magazine. The swap uses the listed reload stat.`],equations:[{name:`Refill time`,tex:String.raw`t_{refill} = \frac{Q / \rho}{(1 + g)\; r_{norm}\; n_{proj}} + t_{reloads} + 2\cdot {{src/calc/damage.ts#INCARNON_SWAP_RELOADS}}\cdot R_{base}`,complexity:`O(1)`,note:`Q = charges, ρ = rounds per hit, g = charge gain bonus (Incarnon Efficiency), t_reloads = the base form's own reloads while filling (shell by shell where it applies), R_base = the listed reload.`},{name:`Sustained DPS of the form`,tex:String.raw`\text{DPS} = \frac{D_{battery}}{t_{fire} + t_{refill}}`,complexity:`O(1)`}]},{id:`percentile`,title:`Weapon standing (percentiles)`,where:`Compare › Weapons, Rivens`,summary:`Where a weapon's base numbers sit among its own subtype (shotguns vs shotguns, glaives vs glaives), from the unmodded attack data.`,complexity:String.raw`O(n)\text{ per stat}`,sources:[{file:`src/calc/weaponProfile.ts`,symbol:`standing`},{file:`src/calc/weaponProfile.ts`,symbol:`MIN_GROUP`},{file:`src/calc/weaponProfile.ts`,symbol:`rankGroup`}],steps:[`Each weapon counts once per pool, by its first attack (or first Incarnon attack for the Incarnon pool). Exalted weapons are left out.`,`A subtype with fewer than {{src/calc/weaponProfile.ts#MIN_GROUP}} weapons falls back to the whole category.`,`Ties count half, so a value most weapons share reads as typical, not the lowest. "Highest" / "lowest" only when few weapons share the value.`],equations:[{name:`Share beaten`,tex:String.raw`\text{beats}(v) = \frac{\#\{u < v\} + \max(0,\, \#\{u = v\} - 1)/2}{n - 1}`,complexity:`O(n)`,note:`Flipped (counts u > v) for stats where lower is better, like reload time.`}]},{id:`enervate`,title:`Secondary Enervate average crit`,where:`Calculator, Data Analysis`,summary:`Enervate adds +10% crit per hit and resets after 6 big crits. The calc averages crit over a whole build-up-and-reset cycle as a small Markov chain.`,complexity:String.raw`O(K\cdot J)`,sources:[{file:W,symbol:`enervateAverageCrit`}],steps:[`State = (hit number k, big crits so far j). A big crit (orange or red) happens with chance crit − 100% once crit is past 100%.`,`The 6th big crit ends the cycle. Run until the remaining probability mass is under 10⁻¹².`],equations:[{name:`Chain`,tex:String.raw`c_k = c_0 + 0.1k,\quad p_k = \operatorname{clamp}(c_k - 1, 0, 1),\quad \pi_{k+1,j} = \pi_{k,j}(1 - p_k) + \pi_{k,j-1}\,p_k \;\; (j < 6)`,complexity:String.raw`O(K\cdot J),\; J = 6`},{name:`Average crit`,tex:String.raw`\bar c = \frac{\sum_k c_k \sum_j \pi_{k,j}}{\sum_k \sum_j \pi_{k,j}}`,complexity:`O(K)`,note:`Past 200% every hit is a big crit, so it resets every 6 hits: (0 + 10 + … + 50%) / 6 = +25%.`}]},{id:`analysis`,title:`Data Analysis statistics`,where:`Experimental › Data Analysis`,summary:`Arsenal-wide summaries: medians, histograms, release-update buckets, Prime uplift and how well base stats predict leaderboard score.`,complexity:String.raw`O(n \log n)`,sources:[{file:`src/components/DataExplorer.tsx`,symbol:`median`},{file:`src/components/DataExplorer.tsx`,symbol:`spearman`},{file:`src/components/DataExplorer.tsx`,symbol:`pickShot`},{file:`src/components/DataExplorer.tsx`,symbol:`applyEvolutions`},{file:`src/components/DataExplorer.tsx`,symbol:`ERA_SIZE`},{file:`src/components/DataExplorer.tsx`,symbol:`rowsFor`}],steps:[`Per weapon, one shot per attack mode (normal, alt-fire / special, Incarnon, melee heavy): merged parts summed, the hardest-hitting one when there are several.`,`Incarnon weapons get the base-stat lines of the evolutions the leaderboard picked for that attack.`,`Unmodded DPS: each weapon run through the damage calculation with no mods and no arcane, only its innate passives and those evolutions, sustained DPS on the neutral target (one whole heavy for melee heavies). The subtype section uses only this; the leaderboard section is the only place with modded builds.`,`Release trends bucket the wiki's "Introduced" update into groups of {{src/components/DataExplorer.tsx#ERA_SIZE}} updates.`],equations:[{name:`Median`,tex:String.raw`\tilde x = \begin{cases} x_{((n+1)/2)} & n \text{ odd}\\ \tfrac12\big(x_{(n/2)} + x_{(n/2+1)}\big) & n \text{ even}\end{cases}`,complexity:String.raw`O(n\log n)`},{name:`Spearman rank correlation`,tex:String.raw`\rho = \frac{\sum_i (R_i - \bar R)(S_i - \bar S)}{\sqrt{\sum_i (R_i - \bar R)^2 \sum_i (S_i - \bar S)^2}}`,complexity:String.raw`O(n\log n)`,note:`R, S = ranks of the base stat and the score, ties share their average rank.`},{name:`Prime uplift`,tex:String.raw`\Delta = \operatorname{median}_{(b,\,p)}\Big(\frac{x_p}{x_b} - 1\Big)`,complexity:`O(n log n)`}]},{id:`about-sync`,title:`This page's sync check`,where:`About`,summary:`Every write-up here cites the functions it describes and is stamped with a hash of them. When the code changes, the write-up is flagged as out of date and the project's checks fail until it's reread and restamped.`,complexity:String.raw`O(|\text{source}|)`,sources:[{file:`src/about/sync.ts`}],steps:[`Each cited function is cut out of its file by bracket matching from its declaration; comment-only lines and whitespace are dropped so rewording a comment doesn't count.`,`Numbers written as placeholders are read out of the code when the page renders, so a changed constant updates itself.`],equations:[{name:`Stamp`,tex:String.raw`h = \operatorname{FNV1a}_{32}\Big(\textstyle\bigoplus_{s \in \text{sources}} \operatorname{normalize}(\operatorname{extract}(s))\Big),\qquad \text{stale} \iff h \ne h_{verified}`,complexity:String.raw`O(|\text{source}|)`}]}];function K(e){return e.split(`
`).map(e=>e.trim()).filter(e=>e&&!e.startsWith(`//`)).join(`
`).replace(/\s+/g,` `)}function q(e,t){let n=e.search(RegExp(`(?:function\\*?|const|let|class|interface|type)\\s+${t}\\b`));if(n<0)return null;let r=0;for(let t=n;t<e.length;t++){let i=e[t];if(`([{`.includes(i))r++;else if(`)]}`.includes(i))r--;else if(i===`
`&&r<=0&&!/(=>|[=(,:?+\-*/|&])\s*$/.test(e.slice(n,t)))return e.slice(n,t)}return e.slice(n)}function se(e){let t=2166136261;for(let n=0;n<e.length;n++)t^=e.charCodeAt(n),t=Math.imul(t,16777619);return(t>>>0).toString(16).padStart(8,`0`)}function ce(e,t){let n=[];return{hash:se(e.map(({file:e,symbol:r})=>{let i=t(e),a=i===null?null:r?q(i,r):i;return a===null&&n.push(r?`${e}#${r}`:e),K(a??``)}).join(`
\0
`)),missing:n}}var le=/\{\{([^#}]+)#([A-Za-z_$][\w$]*)\}\}/g;function ue(e,t){if(!e)return null;let n=e.match(RegExp(`(?:const|let)\\s+${t}\\s*(?::[^=]+)?=\\s*([^\\n;]+)`));return n?n[1].replace(/\s*\/\/.*$/,``).replace(/\bas const\b/,``).trim():null}function J(e,t,n){return e.replace(le,(e,r,i)=>{let a=ue(t(r),i);return a===null&&n?.push(`${r}#${i}`),a??`?`})}var Y={leaderboard:`1d5da096`,optimizer:`d3a60601`,"damage-cap":`e121e1ae`,riven:`bcedefbd`,boss:`2f183160`,compare:`6c5a0a5a`,advisor:`7694965c`,damage:`404351fd`,simulate:`1b0e5a9b`,incarnon:`0c963c87`,percentile:`e894b8bf`,enervate:`4b57406d`,analysis:`9b7dcc27`,"about-sync":`f43c485c`},X=e(),de=Object.assign({"/scripts/build-leaderboard.ts":r,"/scripts/leaderboardFingerprint.ts":i,"/src/about/algorithms.ts":a,"/src/about/sync.ts":o,"/src/calc/abilityDamage.ts":s,"/src/calc/advisor.ts":c,"/src/calc/capacity.ts":l,"/src/calc/conditionOverload.ts":u,"/src/calc/constants.ts":ee,"/src/calc/damage.ts":te,"/src/calc/damageCap.ts":ne,"/src/calc/evolved.ts":re,"/src/calc/incarnon.ts":ie,"/src/calc/kill.ts":ae,"/src/calc/mechanicTags.ts":d,"/src/calc/modConflicts.ts":f,"/src/calc/modSets.ts":p,"/src/calc/modTieBreak.ts":m,"/src/calc/nicheMods.ts":h,"/src/calc/parseMod.ts":g,"/src/calc/riven.ts":_,"/src/calc/rivenHints.ts":v,"/src/calc/simulate.ts":y,"/src/calc/specialLines.ts":b,"/src/calc/target.ts":x,"/src/calc/warframeStats.ts":S,"/src/calc/weaponProfile.ts":C,"/src/components/DataExplorer.tsx":w,"/src/data/reloads.ts":T,"/src/optimizer/attackKinds.ts":E,"/src/optimizer/bossLeaderboard.ts":D,"/src/optimizer/capWorker.ts":O,"/src/optimizer/compare.ts":k,"/src/optimizer/compareWorker.ts":A,"/src/optimizer/damageCap.ts":j,"/src/optimizer/frameBuild.ts":M,"/src/optimizer/leaderboardLoader.ts":N,"/src/optimizer/leaderboardTypes.ts":P,"/src/optimizer/leaderboardWeapon.ts":oe,"/src/optimizer/modPool.ts":F,"/src/optimizer/objectives.ts":I,"/src/optimizer/optimize.ts":L,"/src/optimizer/rivenSearch.ts":R,"/src/optimizer/rivenWorker.ts":z,"/src/optimizer/scenario.ts":B}),Z=e=>de[`/${e}`]??null,fe=Y;function Q({tex:e,display:t=!1}){let r=(0,V.useMemo)(()=>n.renderToString(J(e,Z),{displayMode:t,throwOnError:!1}),[e,t]);return t?(0,X.jsx)(`div`,{className:`formula-tex`,dangerouslySetInnerHTML:{__html:r}}):(0,X.jsx)(`span`,{dangerouslySetInnerHTML:{__html:r}})}function $(e){let{hash:t,missing:n}=ce(e.sources,Z);return{current:!n.length&&fe[e.id]===t,missing:n}}function pe({algorithm:e,index:t}){let{current:n,missing:r}=(0,V.useMemo)(()=>$(e),[e]);return(0,X.jsxs)(`details`,{className:`algo`,children:[(0,X.jsxs)(`summary`,{children:[(0,X.jsx)(`span`,{className:`algo-rank`,children:t+1}),(0,X.jsx)(`span`,{className:`algo-title`,children:e.title}),(0,X.jsx)(`span`,{className:`algo-cost`,children:(0,X.jsx)(Q,{tex:e.complexity})}),(0,X.jsx)(`span`,{className:`algo-status ${n?`ok`:`stale`}`,children:n?`✓ matches code`:`⚠ code changed`})]}),(0,X.jsxs)(`div`,{className:`algo-body`,children:[(0,X.jsxs)(`p`,{className:`muted algo-where`,children:[`Used on: `,e.where]}),!n&&(0,X.jsxs)(`p`,{className:`algo-warning`,children:[r.length?`Some of the code this describes is gone (${r.join(`, `)}). `:`The code this describes changed since this was last checked against it. `,`The steps below may be out of date.`]}),(0,X.jsx)(`p`,{children:J(e.summary,Z)}),(0,X.jsx)(`ol`,{className:`algo-steps`,children:e.steps.map(e=>(0,X.jsx)(`li`,{children:J(e,Z)},e))}),e.equations.map(e=>(0,X.jsxs)(`details`,{className:`algo-eq`,children:[(0,X.jsxs)(`summary`,{children:[e.name,e.complexity&&(0,X.jsx)(`span`,{className:`algo-cost`,children:(0,X.jsx)(Q,{tex:e.complexity})})]}),(0,X.jsx)(Q,{tex:e.tex,display:!0}),e.note&&(0,X.jsx)(`p`,{className:`muted`,children:J(e.note,Z)})]},e.name)),(0,X.jsxs)(`p`,{className:`muted algo-sources`,children:[`Code: `,e.sources.map(e=>e.symbol?`${e.file.split(`/`).pop()} › ${e.symbol}`:e.file.split(`/`).pop()).join(`, `)]})]})]})}function me(){let e=(0,V.useMemo)(()=>G.filter(e=>!$(e).current).length,[]);return(0,X.jsxs)(`div`,{className:`analysis`,children:[(0,X.jsxs)(`section`,{className:`panel`,children:[(0,X.jsx)(`h2`,{children:`About`}),(0,X.jsx)(`p`,{children:`A personal tool and project for exploring Warframe's weapon database in a comprehensive way: every weapon, mod, arcane and Incarnon evolution run through the game's damage math, optimized, ranked and compared. Weapon and mod data come from @wfcd/items, mechanics from the Warframe wiki.`})]}),(0,X.jsxs)(`section`,{className:`panel`,children:[(0,X.jsxs)(`div`,{className:`row spread`,children:[(0,X.jsx)(`h2`,{children:`How it works`}),(0,X.jsx)(`span`,{className:`algo-status ${e?`stale`:`ok`}`,children:e?`⚠ ${e} of ${G.length} out of date`:`✓ all ${G.length} match the code`})]}),(0,X.jsx)(`p`,{className:`muted`,children:`Every algorithm the site runs, biggest first. Open one for its steps, then each equation for the math and its time complexity. Each write-up is tied to the functions it describes: when that code changes the write-up is flagged here until it's rechecked, and numbers like the beam width are read straight out of the code.`}),(0,X.jsxs)(`p`,{className:`muted`,children:[`Notation: `,(0,X.jsx)(Q,{tex:`C`}),` = one damage calculation, `,(0,X.jsx)(Q,{tex:`T_{opt}`}),` = one build optimizer run, `,(0,X.jsx)(Q,{tex:`|P|`}),` = the mod pool,`,` `,(0,X.jsx)(Q,{tex:`S`}),` = mod slots, `,(0,X.jsx)(Q,{tex:`B`}),` = beam width, `,(0,X.jsx)(Q,{tex:`T`}),` = damage types, `,(0,X.jsx)(Q,{tex:`L`}),` = mod lines.`]}),(0,X.jsx)(`div`,{className:`algo-list`,children:G.map((e,t)=>(0,X.jsx)(pe,{algorithm:e,index:t},e.id))})]})]})}export{me as default};