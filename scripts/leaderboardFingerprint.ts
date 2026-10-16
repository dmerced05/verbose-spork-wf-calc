// fingerprints for the incremental leaderboard rebuild (scripts/build-leaderboard.ts).
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
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
const hash = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 16)

// drop comment-only lines and whitespace. only whole-line comments, a trailing // could be inside a string
const normalizeSource = (source: string) =>
  source
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')
    .replace(/\s+/g, ' ')

export function engineFingerprint(): string {
  const parts = ENGINE_FILES.map((file) => `${file}:${normalizeSource(readFileSync(new URL(file, ROOT), 'utf8'))}`)
  for (const [name, module, tables] of MIXED_MODULES) {
    const exported = Object.fromEntries(Object.entries(module).filter(([key]) => !tables.includes(key)))
    parts.push(`${name}:${normalizeSource(stable(exported))}`)
  }
  // single helpers from otherwise per-item modules that damage.ts calls directly
  parts.push(`helpers:${normalizeSource([scopeApplies, perkAppliesTo].map(String).join('|'))}`)
  return hash(parts.join('\n'))
}

// one mod/arcane as the optimizer and calc see it: data + what it parses to at max rank + its set bonus
const upgradeHashes = new Map<string, string>()
function upgradeFingerprint(upgrade: Mod | Arcane, rank: number): string {
  const key = `${upgrade.uniqueName}@${rank}`
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
