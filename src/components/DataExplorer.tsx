// Experimental > Data Analysis: poking at the whole arsenal at once. base stats straight from the weapon data, how much
// Enervate is really worth, how weapons changed across updates, and what the leaderboard's best builds actually pick
import { useEffect, useMemo, useState } from 'react'
import { mods, weapons } from '../data'
import introducedJson from '../data/introduced.json'
import { enervateAverageCrit } from '../calc/damage'
import { loadLeaderboard } from '../optimizer/leaderboardLoader'
import type { Leaderboard, LeaderboardEntry } from '../optimizer/leaderboardTypes'
import { Bars, Histogram, Lines, Scatter, SERIES, Tile } from './charts'
import type { Attack, Weapon } from '../types'
import { subtypeOf } from '../calc/weaponProfile'
import { getIncarnonTiers, perkAppliesTo, scenarioPerkStacks } from '../calc/incarnon'

const modsByName = new Map(mods.map((mod) => [mod.name, mod]))
const weaponsByName = new Map(weapons.map((weapon) => [weapon.name, weapon]))
const evolutionLines = (row: Row) => (row.evolutions.length ? ['Evolutions (base stats include them):', ...row.evolutions] : [])
// tooltip name: the weapon, plus which attack when it isn't the plain one
const rowLabel = (row: { name: string; attack: string }) => (row.attack === weaponsByName.get(row.name)?.attacks[0]?.name ? row.name : `${row.name} · ${row.attack}`)
const CATEGORIES = ['Primary', 'Secondary', 'Melee'] as const
type Category = (typeof CATEGORIES)[number]
const COLOR: Record<Category, string> = { Primary: SERIES[0], Secondary: SERIES[1], Melee: SERIES[2] }
const pct = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`
const big = (value: number) => (value >= 1e6 ? `${+(value / 1e6).toPrecision(3)}M` : value >= 1e3 ? `${+(value / 1e3).toPrecision(3)}k` : `${+value.toPrecision(3)}`)
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length / 2
  return sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2
}

// one row per weapon: its first attack (the plain fire / Normal Attack; merged "A + B" rows and heavies come later in the list).
// exalted weapons are abilities, not something you pick, so they're out
interface Row { name: string; attack: string; evolutions: string[]; category: Category; type: string; subtype: string; crit: number; critMultiplier: number; status: number; damage: number; fireRate: number; incarnon: boolean; era: number | null }
const totalDamage = (damage: Record<string, unknown>) => Object.values(damage).reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)

// the wiki's Introduced is an update number ("19.0.7", "Vanilla"), a few old ones are named instead ("Update: The Silver Grove 2").
// those named ones are all Update 17-18 (2015-16), so they land in the same 5-update bucket either way
const INTRODUCED = introducedJson as Record<string, string>
function updateNumber(version: string | undefined): number | null {
  if (!version) return null
  if (/vanilla/i.test(version)) return 0
  const number = version.match(/^(\d+)/)
  return number ? +number[1] : 18
}
const ERA_SIZE = 5
const eraLabel = (era: number) => (era === 0 ? 'U0–4' : `U${era}–${era + ERA_SIZE - 1}`)

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
interface Evolved { crit: number; critMultiplier: number; status: number; damageScale: number; picked: string[] }
function applyEvolutions(weapon: Weapon, attack: Attack, entry: LeaderboardEntry | undefined): Evolved {
  const out: Evolved = { crit: attack.critChance, critMultiplier: attack.critMultiplier, status: attack.statusChance, damageScale: 1, picked: [] }
  const tiers = getIncarnonTiers(weapon.name)
  if (!tiers || !entry?.perks?.length) return out
  const isMelee = weapon.category === 'Melee'
  const isIncarnonAttack = /incarnon/i.test(attack.name)
  const base = { damage: 0, critChance: 0, critMultiplier: 0, statusChance: 0, multishot: 0 }
  const set: Partial<Record<'critChance' | 'statusChance' | 'critMultiplier', number>> = {}
  for (const { tier, name } of entry.perks) {
    const perk = tiers.find((one) => one.tier === tier)?.perks.find((one) => one.name === name)
    if (!perk) continue
    out.picked.push(`${tier}: ${name}`)
    const stacks = scenarioPerkStacks(perk, { isMelee, bodyShots: true })
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
  for (const key of ['single', 'sustained']) for (const entry of board?.boards[key] ?? []) entries.set(`${entry.weaponName}|${entry.attack}`, entry)
  return list.filter((weapon) => !weapon.exalted && (CATEGORIES as readonly string[]).includes(weapon.category) && weapon.attacks.length).flatMap((weapon) => {
    const shot = pickShot(weapon, mode)
    if (!shot) return []
    const attack = shot.attack
    const update = updateNumber(INTRODUCED[weapon.name])
    const evolved = applyEvolutions(weapon, attack, entries.get(`${weapon.name}|${attack.name}`))
    return [{
      name: weapon.name, attack: attack.name, evolutions: evolved.picked, category: weapon.category as Category, type: weapon.type, subtype: subtypeOf(weapon) ?? `Other ${weapon.category.toLowerCase()}`,
      crit: evolved.crit, critMultiplier: evolved.critMultiplier, status: evolved.status, damage: shotDamage(weapon, attack) * evolved.damageScale,
      fireRate: attack.fireRate, incarnon: weapon.attacks.some((other) => other.name.includes('Incarnon Form')),
      era: update === null ? null : Math.floor(update / ERA_SIZE) * ERA_SIZE,
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
      <Subtypes rows={rows} board={board} />
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
                <Tile label="Average crit chance" value={pct(mean(group.map((row) => row.crit)), 1)} sub={`median ${pct(median(group.map((row) => row.crit)))}`} />
                <Tile label="Average crit multiplier" value={`${mean(group.map((row) => row.critMultiplier)).toFixed(2)}x`} sub={`median ${median(group.map((row) => row.critMultiplier)).toFixed(1)}x`} />
                <Tile label="Average status chance" value={pct(mean(group.map((row) => row.status)), 1)} sub={`median ${pct(median(group.map((row) => row.status)))}`} />
                <Tile label="Average base damage" value={big(mean(group.map((row) => row.damage)))} sub={`median ${big(median(group.map((row) => row.damage)))}`} />
              </div>
            </div>
          )
        })}
      </div>
      <p className="muted">Average damage sits well above the median everywhere: a handful of launchers, bows and snipers hit for hundreds or thousands per shot and pull the average up.</p>

      <div className="chart-grid">
        <Histogram title={`${category} base crit chance`} values={inCategory.map((row) => row.crit)} binSize={0.05} max={0.6} fmt={(value) => pct(value)} xLabel="crit chance (last bar is 55%+)" color={COLOR[category]} />
        <Histogram title={`${category} base status chance`} values={inCategory.map((row) => row.status)} binSize={0.05} max={0.6} fmt={(value) => pct(value)} xLabel="status chance (last bar is 55%+)" color={COLOR[category]} />
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
  { key: 'critMultiplier', label: 'Crit multi' }, { key: 'status', label: 'Status' }, { key: 'damage', label: 'Damage' }, { key: 'fireRate', label: 'Fire rate' }, { key: 'score', label: 'Median score' }]
function Subtypes({ rows, board }: { rows: Row[]; board: Leaderboard | null | undefined }) {
  const [picked, setPicked] = useState('Shotgun')
  // click a header to sort by it (biggest first), again to flip, a third time back to the category grouping
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean } | null>(null)
  const [chosenKey, setBoardKey] = useState('sustained')
  const boardKey = usableBoard(board, chosenKey)
  const best = useMemo(() => bestPerWeapon(board, boardKey), [board, boardKey])
  const scoreByName = new Map(best.map((entry) => [entry.weaponName, entry]))
  const scoreName = BOARD_CHOICES.find((choice) => choice.key === boardKey)!.label
  const groups: SubtypeStats[] = [...new Set(rows.map((row) => `${row.category}/${row.subtype}`))].map((key) => {
    const members = rows.filter((row) => `${row.category}/${row.subtype}` === key)
    return { name: members[0].subtype, category: members[0].category, members, crit: median(members.map((row) => row.crit)),
      critMultiplier: median(members.map((row) => row.critMultiplier)), status: median(members.map((row) => row.status)),
      damage: median(members.map((row) => row.damage)), fireRate: median(members.map((row) => row.fireRate)) }
  }).sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || b.members.length - a.members.length)
  const medianScore = (group: SubtypeStats) => median(group.members.map((row) => scoreByName.get(row.name)?.score).filter((score): score is number => score !== undefined))
  const group = groups.find((one) => one.name === picked) ?? groups[0]
  const sortValue = (one: SubtypeStats, key: SortKey): number | string => key === 'name' ? one.name : key === 'count' ? one.members.length : key === 'score' ? (board ? medianScore(one) : 0) : one[key]
  const sorted = !sort ? groups : [...groups].sort((a, b) => {
    const left = sortValue(a, sort.key)
    const right = sortValue(b, sort.key)
    const order = typeof left === 'string' ? left.localeCompare(right as string) : left - (right as number)
    return sort.descending ? -order : order
  })
  const categoryRows = rows.filter((row) => row.category === group.category)
  const versus = (value: number, overall: number, format: (v: number) => string) => `${value >= overall ? '+' : ''}${format(value - overall)} vs all ${group.category.toLowerCase()}`
  const entries = group.members.map((row) => ({ row, entry: scoreByName.get(row.name) })).filter((pair): pair is { row: Row; entry: LeaderboardEntry } => !!pair.entry)
  const tally = (names: string[]) => {
    const counts = new Map<string, number>()
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }
  const share = (count: number) => count / Math.max(1, entries.length)
  return (
    <section className="panel">
      <div className="row spread">
        <h2>By weapon subtype</h2>
        <select value={boardKey} onChange={(event) => setBoardKey(event.target.value)}>{BOARD_CHOICES.map((choice) => <option key={choice.key} value={choice.key}>Scores: {choice.label}</option>)}</select>
      </div>
      <p className="muted">
        Guns split by type (rifles, shotguns, bows, snipers, launchers, spearguns, pistols, dual pistols, thrown), melee by the wiki's weapon classes
        (glaives, heavy blades, nikanas...). Medians throughout. Click a column header to sort by it, click a row to dig into that subtype.
      </p>
      <Scatter title="Every subtype: median crit vs median status" xLabel="median crit chance" yLabel="median status chance" xFmt={(value) => pct(value)} yFmt={(value) => pct(value)}
        series={CATEGORIES.map((one) => ({ name: one, color: COLOR[one], points: groups.filter((one2) => one2.category === one).map((one2) => ({ x: one2.crit, y: one2.status, label: `${one2.name} (${one2.members.length})` })) }))}
        note="Each dot is a whole subtype. Hover for its name and size." />
      <div className="table-scroll">
        <table className="stat-table clickable">
          <thead><tr>{SORT_COLUMNS.map((column) => (
            <th key={column.key} className="sortable" onClick={() => setSort(sort?.key !== column.key ? { key: column.key, descending: column.key !== 'name' }
              : sort.descending === (column.key !== 'name') ? { key: column.key, descending: !sort.descending } : null)}>
              {column.label}{sort?.key === column.key ? (sort.descending ? ' ▼' : ' ▲') : ''}
            </th>))}<th>Best weapon</th></tr></thead>
          <tbody>{sorted.map((one) => {
            const top = one.members.map((row) => scoreByName.get(row.name)).filter((entry): entry is LeaderboardEntry => !!entry).sort((a, b) => b.score - a.score)[0]
            return (
              <tr key={`${one.category}${one.name}`} className={one === group ? 'picked' : ''} onClick={() => setPicked(one.name)}>
                <td><i className="swatch" style={{ background: COLOR[one.category] }} />{one.name}</td><td>{one.members.length}</td><td>{pct(one.crit)}</td><td>{one.critMultiplier.toFixed(1)}x</td>
                <td>{pct(one.status)}</td><td>{big(one.damage)}</td><td>{one.fireRate.toFixed(2)}</td><td>{board ? big(medianScore(one)) : '…'}</td><td>{top?.weaponName ?? '–'}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>

      <h3>{group.name} · {group.members.length} {group.category.toLowerCase()} weapon{group.members.length === 1 ? '' : 's'}</h3>
      <div className="tiles">
        <Tile label="median crit chance" value={pct(group.crit)} sub={versus(group.crit, median(categoryRows.map((row) => row.crit)), (value) => `${(value * 100).toFixed(0)} pts`)} />
        <Tile label="median crit multiplier" value={`${group.critMultiplier.toFixed(1)}x`} sub={versus(group.critMultiplier, median(categoryRows.map((row) => row.critMultiplier)), (value) => `${value.toFixed(1)}x`)} />
        <Tile label="median status chance" value={pct(group.status)} sub={versus(group.status, median(categoryRows.map((row) => row.status)), (value) => `${(value * 100).toFixed(0)} pts`)} />
        <Tile label="median base damage" value={big(group.damage)} sub={`all ${group.category.toLowerCase()}: ${big(median(categoryRows.map((row) => row.damage)))}`} />
        <Tile label={`median ${scoreName}`} value={board ? big(medianScore(group)) : '…'} sub={`all ${group.category.toLowerCase()}: ${board ? big(median(best.filter((entry) => entry.category === group.category).map((entry) => entry.score))) : '…'}`} />
        <Tile label="Incarnon available" value={`${group.members.filter((row) => row.incarnon).length} / ${group.members.length}`} />
      </div>
      <div className="chart-grid">
        <Histogram title={`${group.name} base crit chance`} values={group.members.map((row) => row.crit)} binSize={0.05} max={0.6} fmt={(value) => pct(value)} xLabel="crit chance (last bar is 55%+)" color={COLOR[group.category]} />
        <Histogram title={`${group.name} base status chance`} values={group.members.map((row) => row.status)} binSize={0.05} max={0.6} fmt={(value) => pct(value)} xLabel="status chance (last bar is 55%+)" color={COLOR[group.category]} />
      </div>
      <Scatter title={`${group.name}: crit vs status`} xLabel="crit chance" yLabel="status chance" xFmt={(value) => pct(value)} yFmt={(value) => pct(value)} xMax={0.6} yMax={0.6}
        series={[{ name: group.name, color: COLOR[group.category], points: group.members.map((row) => ({ x: row.crit, y: row.status, label: rowLabel(row), extra: evolutionLines(row) })) }]} />
      {board && entries.length > 0 && (
        <>
          <Bars title={`Top ${group.name.toLowerCase()} weapons, ${scoreName}`} fmt={big} labelWidth={180}
            rows={[...entries].sort((a, b) => b.entry.score - a.entry.score).slice(0, 12).map(({ entry }) => ({ label: entry.weaponName, value: entry.score, detail: entry.incarnonForm ? 'Incarnon form' : entry.attack }))} />
          <div className="chart-grid">
            <Bars title="Most picked mods (share of builds)" fmt={(value) => pct(value)}
              rows={tally(entries.flatMap(({ entry }) => [...new Set(entry.mods.map((mod) => mod.name))])).slice(0, 10).map(([label, count]) => ({ label, value: share(count), detail: `${count} of ${entries.length} builds` }))} />
            <Bars title="Arcane picks" fmt={(value) => pct(value)}
              rows={tally(entries.map(({ entry }) => entry.arcane?.name ?? 'No arcane')).slice(0, 6).map(([label, count]) => ({ label, value: share(count), detail: `${count} of ${entries.length} builds` }))} />
          </div>
        </>
      )}
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
  const percents = (text: string) => [...text.matchAll(/\+(\d+(?:\.\d+)?)% Critical Chance/g)].map((match) => +match[1] / 100)
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
        <Tile label="0% base crit" value={pct(withEnervate(0))} sub={`+${pct(withEnervate(0))} from Enervate`} />
        <Tile label={`median secondary (${pct(medianBase)} base)`} value={pct(withEnervate(medianBase))} sub={`+${pct(withEnervate(medianBase) - medianBase)} from Enervate`} />
        <Tile label={`highest base: ${highBase?.name ?? '–'} (${pct(highBase?.crit ?? 0)})`} value={pct(withEnervate(highBase?.crit ?? 0))} sub={`+${pct(withEnervate(highBase?.crit ?? 0) - (highBase?.crit ?? 0))} from Enervate`} />
        <Tile label="0% vs 60% base, with Enervate" value={`${pct(withEnervate(0))} vs ${pct(withEnervate(0.6))}`} sub="a 60 point base gap shrinks to this" />
      </div>
      <Lines title="Average crit chance with Enervate, by base crit" x={baseCrits} xFmt={(value) => pct(value)} yFmt={(value) => pct(value)} xLabel="weapon's base crit chance (no other crit mods)"
        series={[{ name: 'With Enervate', color: SERIES[1], values: baseCrits.map(withEnervate) },
          { name: 'Flat crit Enervate adds', color: SERIES[0], dashed: true, values: baseCrits.map((base) => withEnervate(base) - base) }]}
        note="Every 10 points of base crit only adds about 5 points after Enervate, because the higher start just means the stacks pass 100% and reset sooner. Base crit barely matters once Enervate is on." />
      <Lines title="Enervate vs crit mods, by base crit chance" x={baseCrits} xFmt={(value) => pct(value)} yFmt={(value) => pct(value)} xLabel="weapon's base crit chance"
        series={[{ name: 'Enervate alone', color: SERIES[1], values: baseCrits.map((base) => enervateAverageCrit(base, 0.1, 6)) },
          { name: `${gambit.name} + Galvanized Crosshairs`, color: SERIES[0], values: baseCrits.map((base) => base * (1 + gambit.value + crosshairs)) },
          { name: `${gambit.name} alone`, color: SERIES[2], values: baseCrits.map((base) => base * (1 + gambit.value)) },
          { name: 'Creeping Bullseye (Critical Deceleration)', color: '#9085e9', dashed: true, values: baseCrits.map((base) => base * (1 + bullseye)) }]}
        note={<>The mods multiply your base ({gambit.name} +{pct(gambit.value)}, Galvanized Crosshairs +{pct(crosshairs)} while aiming at 5 weak point kill stacks,
          +{pct(gambit.value + crosshairs)} together), so they're worth more the higher the base is. Enervate adds roughly the same flat chunk whatever the base,
          so it wins on low-crit guns: it beats both mods together below {crossover === undefined ? 'over 60%' : `about ${pct(crossover)}`} base crit,{' '}
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
        <Tile label="median crit, Update 0–19" value={pct(median(firstHalf.map((row) => row.crit)))} sub={`${firstHalf.length} weapons`} />
        <Tile label="median crit, Update 30+" value={pct(median(secondHalf.map((row) => row.crit)))} sub={`${secondHalf.length} weapons`} />
        <Tile label="median status, Update 0–19" value={pct(median(firstHalf.map((row) => row.status)))} />
        <Tile label="median status, Update 30+" value={pct(median(secondHalf.map((row) => row.status)))} />
      </div>
      <Lines title="Median base crit and status chance by release" x={eras} xTickLabels xFmt={eraLabel} yFmt={(value) => pct(value)}
        series={[{ name: 'Crit chance', color: SERIES[0], values: eras.map((era) => median(inEra(era).map((row) => row.crit))) },
          { name: 'Status chance', color: SERIES[1], values: eras.map((era) => median(inEra(era).map((row) => row.status))) }]} />
      <Lines title="Median crit multiplier by release" x={eras} xTickLabels xFmt={eraLabel} yFmt={(value) => `${value.toFixed(1)}x`} yMin={1}
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
      <Bars title="Biggest base damage jumps, Prime over the original" fmt={(value) => `+${pct(value)}`}
        rows={pairs.map(([base, prime]) => ({ label: prime.name, value: base.damage > 0 ? prime.damage / base.damage - 1 : 0, detail: `${big(base.damage)} → ${big(prime.damage)}` }))
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
  const modRows = tally(builds.flatMap((entry) => [...new Set(entry.mods.map((mod) => mod.name))])).slice(0, 15).map(([label, count]) => ({ label, value: share(count), detail: `${count} of ${builds.length} builds` }))
  const arcaneRows = tally(builds.map((entry) => entry.arcane?.name ?? 'No arcane')).slice(0, 8).map(([label, count]) => ({ label, value: share(count), detail: `${count} of ${builds.length} builds` }))
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
        <Tile label="builds where the Incarnon form wins" value={pct(share(incarnonWins))} sub={`${incarnonWins} weapons`} />
        <Tile label="top 10 that are Incarnon" value={`${top10.filter((entry) => entry.incarnonForm).length} / 10`} />
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
      {joined.length > 0 && <Scatter title={`Base crit chance vs ${scoreName}`} xLabel="base crit chance" yLabel={scoreName} logY xFmt={(value) => pct(value)} yFmt={big}
        series={[{ name: category, color: COLOR[category], points: joined.map((pair) => ({ x: pair.row.crit, y: pair.entry.score, label: rowLabel(pair.row), extra: evolutionLines(pair.row) })) }]}
        note="Log scale on the score, the top weapons are orders of magnitude above the bottom ones." />}
    </section>
  )
}
