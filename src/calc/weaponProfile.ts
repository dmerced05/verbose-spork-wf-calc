// where a weapon's base numbers sit among its own category (primaries vs primaries, melee vs melee), plus the plain
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
  const group = subtype ? `${weapon.category}/${subtype}` : weapon.category
  const base = group !== weapon.category && poolFor(group, kind).count < MIN_GROUP ? weapon.category : group
  // a non-first attack (throw, heavy, alt-fire) goes against the same attack of its type, then of its category, and
  // only falls back to normal attacks when too few weapons have one
  if (kind === 'normal' && attack && attack !== weapon.attacks[0]) {
    for (const candidate of [`${group}#${attack.name}`, `${weapon.category}#${attack.name}`]) {
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
  const cached = pools.get(`${category}|${kind}`)
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
  pools.set(`${category}|${kind}`, pool)
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
  if (subtype) return SUBTYPE_WORDS[subtype] ?? `${subtype.toLowerCase()}s`
  return category === 'Melee' ? 'melee weapons' : category === 'Secondary' ? 'secondaries' : 'primaries'
}
export const categorySize = (category: string, kind: PoolKind = 'normal', pool?: Pool) => (pool ?? poolFor(category, kind)).count

const pct = (value: number) => `${Math.round(value * 1000) / 10}%`
const fmt = (value: number) => (value >= 100 ? Math.round(value).toLocaleString() : (Math.round(value * 100) / 100).toString())
export const metricText = (key: MetricKey, value: number | null) => {
  if (value === null) return '–'
  if (key === 'critChance' || key === 'statusChance') return pct(value)
  if (key === 'critMultiplier' || key === 'multishot') return `${fmt(value)}x`
  if (key === 'reload') return `${fmt(value)}s`
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
// `metrics` / `kind`: Compare Weapons passes evolved Incarnon numbers and which pool to rank them in
export function profileLines(weapon: Weapon, attack: Attack, metrics: AttackMetrics = attackMetrics(weapon, attack), kind: PoolKind = 'normal', pool?: Pool): ProfileLine[] {
  const rankIn = rankGroup(weapon, kind, attack)
  const byAttack = groupAttackName(rankIn)
  const group = kind === 'incarnon' ? `Incarnon forms of ${categoryWord(rankIn)}` : byAttack ? `${categoryWord(rankIn)} (their ${byAttack})` : categoryWord(rankIn)
  const lines: ProfileLine[] = []
  const keys: MetricKey[] = ['rawDps', 'hit', 'critChance', 'critMultiplier', 'statusChance', 'fireRate', 'multishot', 'magazine', 'reload']
  for (const key of keys) {
    if (weapon.category === 'Melee' && (key === 'multishot' || key === 'hit')) continue
    const item = standing(rankIn, key, metrics[key], kind, pool)
    if (!item || item.label === 'average') continue
    const label = key === 'fireRate' && weapon.category === 'Melee' ? 'Attack speed' : METRIC_LABELS[key]
    const words = standingWords(key, item)
    const where = item.best || item.worst ? `of all ${categorySize(rankIn, kind, pool)} ${group}` : `for ${group} (better than ${Math.min(99, Math.round(item.percentile * 100))}%)`
    lines.push({
      text: `${label} ${metricText(key, metrics[key])}: ${words} ${where}.`,
      tone: item.percentile >= 0.6 ? 'good' : item.percentile <= 0.4 ? 'bad' : 'neutral',
    })
  }
  const split = damageSplit(attack)
  const topPhysical = split.physical[0]
  if (topPhysical && topPhysical.share >= 0.6) lines.push({ text: `Mostly ${topPhysical.type} (${pct(topPhysical.share)} of its damage).`, tone: 'neutral' })
  if (split.elements.length) lines.push({ text: `Starts with ${split.elements.map((row) => `${row.type} (${pct(row.share)})`).join(', ')}: element mods combine with it.`, tone: 'neutral' })
  const co = resolveCoBehavior(weapon, attack)
  if (co.mode === 'multiply') lines.push({ text: 'Multiplicative Condition Overload: every status type on the enemy multiplies its damage.', tone: 'good' })
  if (attack.continuous) lines.push({ text: 'Beam: multishot merges into bigger ticks, so damaging statuses scale with it twice.', tone: 'neutral' })
  if (attack.isAoE) lines.push({ text: 'Area damage: no headshots.', tone: 'neutral' })
  // sort: the standout good, then the bad, then the rest
  const order = { good: 0, bad: 1, neutral: 2 }
  return lines.sort((a, b) => order[a.tone] - order[b.tone])
}
