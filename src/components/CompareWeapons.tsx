// the Compare Weapons tab: two weapons of the same category side by side. base stats with where each sits among its
// category, what the leaderboard's best builds do with them, and plain lines on what sets them apart
import { useEffect, useMemo, useState } from 'react'
import { weapons, weaponsById } from '../data'
import { mechanicTags } from '../calc/mechanicTags'
import {
  LOWER_IS_BETTER, METRIC_LABELS, attackMetrics, categorySize, categoryWord, groupAttackName, groupMembers, isIncarnonAttack, subtypeOf, metricText, profileLines, rankGroup, standing,
  type AttackMetrics, type MetricKey, type PoolKind,
} from '../calc/weaponProfile'
import { resolveCoBehavior } from '../calc/conditionOverload'
import { getIncarnonTiers, type IncarnonTier } from '../calc/incarnon'
import { defaultAttackIndex, evolve, incarnonPool, leaderboardPicks, type Picks } from '../calc/evolved'
import { rivenTypeFor } from '../calc/riven'
import { loadLeaderboard } from '../optimizer/leaderboardLoader'
import type { Leaderboard } from '../optimizer/leaderboardTypes'
import type { Attack, Weapon } from '../types'
import { EvolutionPicker } from './EvolutionPicker'
import { SearchSelect } from './SearchSelect'
import { Thumb } from './Thumb'
import { Tip } from './Tip'

const ROWS: MetricKey[] = ['hit', 'damage', 'multishot', 'critChance', 'critMultiplier', 'statusChance', 'fireRate', 'rawDps', 'magazine', 'reload']
const BOARD_ROWS = [
  { key: 'sustained', label: 'Sustained DPS' },
  { key: 'window3', label: 'Damage in 3 s' },
  { key: 'single', label: 'Single hit' },
]
const options = weapons.map((weapon) => ({ id: weapon.uniqueName, label: `${weapon.name} (${weapon.category})` }))
const byName = (name: string) => weapons.find((weapon) => weapon.name === name)?.uniqueName
const short = (value: number) => {
  if (!Number.isFinite(value)) return '∞'
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e4) return `${(value / 1e3).toFixed(1)}K`
  return value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1)
}
const pct = (value: number) => `${Math.round(value * 100)}%`
const ratioText = (a: number, b: number) => (b > 0 && a > 0 ? (a >= b ? `${(a / b).toFixed(2)}x` : `${(b / a).toFixed(2)}x`) : '')

interface Side {
  weapon: Weapon
  attack: Attack
  metrics: AttackMetrics
  kind: PoolKind // which pool its percentiles come from
  tiers: IncarnonTier[] | null
  picks: Picks
  fromLeaderboard: boolean // picks are the leaderboard's, not the user's
  shares: { type: string; share: number }[] // damage split, evolutions included
}

// the attack with its evolutions on (src/calc/evolved.ts), ranked in the Incarnon pool when it's a form
function sideFor(weapon: Weapon, attack: Attack, userPicks: Picks | null, boardPicks: Picks | null, rankIncarnon: boolean): Side {
  const picks = userPicks ?? boardPicks ?? {}
  const { metrics, shares } = evolve(weapon, attack, picks)
  return {
    weapon, attack, metrics, tiers: getIncarnonTiers(weapon.name), picks, shares, fromLeaderboard: !userPicks && Boolean(boardPicks && Object.keys(boardPicks).length),
    kind: rankIncarnon && isIncarnonAttack(attack) ? 'incarnon' : 'normal',
  }
}

export function CompareWeapons() {
  const [aId, setAId] = useState(byName('Phenmor') ?? weapons[0].uniqueName)
  const [bId, setBId] = useState(byName('Braton Prime') ?? weapons[1].uniqueName)
  const [aAttack, setAAttack] = useState(() => defaultAttackIndex(weaponsById.get(byName('Phenmor') ?? weapons[0].uniqueName)!))
  const [bAttack, setBAttack] = useState(() => defaultAttackIndex(weaponsById.get(byName('Braton Prime') ?? weapons[1].uniqueName)!))
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null)
  // evolutions picked by hand, per side. null = the leaderboard's picks for that attack
  const [picksA, setPicksA] = useState<Picks | null>(null)
  const [picksB, setPicksB] = useState<Picks | null>(null)
  const [rankIncarnon, setRankIncarnon] = useState(true)
  useEffect(() => { void loadLeaderboard().then(setLeaderboard) }, [])

  const a = weaponsById.get(aId)!
  const b = weaponsById.get(bId)!
  const category = a.category
  // the second pick is locked to the first one's category: a melee swing next to a rifle shot doesn't say anything
  const bOptions = useMemo(() => options.filter((option) => weaponsById.get(option.id)!.category === category && option.id !== aId), [category, aId])
  const pickA = (id: string | null) => {
    if (!id) return
    const next = weaponsById.get(id)!
    setAId(id)
    setAAttack(defaultAttackIndex(next))
    setPicksA(null)
    if (weaponsById.get(bId)!.category !== next.category || bId === id) {
      // closest weapon by raw DPS in the new category, so there's always something sensible to compare against
      const target = attackMetrics(next, next.attacks[0]).rawDps
      const closest = weapons.filter((weapon) => weapon.category === next.category && weapon.uniqueName !== id && !weapon.exalted && weapon.attacks[0])
        .sort((x, y) => Math.abs(attackMetrics(x, x.attacks[0]).rawDps - target) - Math.abs(attackMetrics(y, y.attacks[0]).rawDps - target))[0]
      if (closest) setBId(closest.uniqueName)
      setBAttack(closest ? defaultAttackIndex(closest) : 0)
      setPicksB(null)
    }
  }
  const pickB = (id: string | null) => {
    if (!id) return
    setBId(id)
    setBAttack(defaultAttackIndex(weaponsById.get(id)!))
    setPicksB(null)
  }

  // the leaderboard's evolutions for this attack (sustained board), the starting point for the pickers
  const boardPicks = (weapon: Weapon, attack: Attack) => leaderboardPicks(leaderboard, weapon, attack)
  // each side ranks in its own subtype (a shotgun against shotguns even when the other pick is a rifle)
  // "Glaive · Melee", "Shotgun · Primary": what the pick is, so it's clear which group it's ranked in
  const typeLabel = (weapon: Weapon) => [subtypeOf(weapon) ?? (weapon.category === 'Melee' ? 'Melee (no class listed)' : weapon.type), weapon.category].filter((part, index, all) => all.indexOf(part) === index).join(' · ')
  const groupOf = (side: Side) => rankGroup(side.weapon, side.kind, side.attack)
  const poolOf = (side: Side) => (side.kind === 'incarnon' ? incarnonPool(leaderboard, groupOf(side)) : undefined)
  const rankText = (side: Side) => {
    const group = groupOf(side)
    const byAttack = groupAttackName(group)
    return `${side.weapon.name} against ${categorySize(group, side.kind, poolOf(side))} ${side.kind === 'incarnon' ? 'Incarnon forms of ' : ''}${categoryWord(group)}${byAttack ? ` (their ${byAttack})` : ''}`
  }
  const attackA = a.attacks[aAttack] ?? a.attacks[0]
  const attackB = b.attacks[bAttack] ?? b.attacks[0]
  const sideA = sideFor(a, attackA, picksA, boardPicks(a, attackA), rankIncarnon)
  const sideB = sideFor(b, attackB, picksB, boardPicks(b, attackB), rankIncarnon)
  const anyIncarnon = isIncarnonAttack(attackA) || isIncarnonAttack(attackB)
  // melee has no multishot or magazine, and rows both sides leave empty (Incarnon forms don't reload) are dropped
  const rows = ROWS.filter((key) => !(category === 'Melee' && (key === 'multishot' || key === 'hit')))
    .filter((key) => sideA.metrics[key] !== null || sideB.metrics[key] !== null)

  // leaderboard: this attack's best build, and where the weapon's best attack ranks among its category
  const boardFor = (side: Side, key: string) => {
    const entries = leaderboard?.boards[key]
    if (!entries) return null
    const entry = entries.find((candidate) => candidate.weaponId === side.weapon.uniqueName && candidate.attack === side.attack.name)
    if (!entry) return null
    const bestByWeapon = new Map<string, number>()
    const group = rankGroup(side.weapon)
    const members = new Set(groupMembers(group).map((weapon) => weapon.uniqueName))
    for (const candidate of entries) {
      if (!members.has(candidate.weaponId)) continue
      bestByWeapon.set(candidate.weaponId, Math.max(bestByWeapon.get(candidate.weaponId) ?? 0, candidate.score))
    }
    // the weapon's own best attack doesn't count against this one (it used to give "#13 of 12")
    const rank = [...bestByWeapon].filter(([weaponId, score]) => weaponId !== side.weapon.uniqueName && score > entry.score).length + 1
    return { entry, rank, of: bestByWeapon.size }
  }

  const differences = describeDifferences(sideA, sideB, leaderboard ? { a: boardFor(sideA, 'sustained')?.entry.score, b: boardFor(sideB, 'sustained')?.entry.score } : null)

  return (
    <div className="compare-weapons">
      <section className="panel">
        <h2>Compare weapons</h2>
        <p className="muted">
          Two {categoryWord(category)} side by side. The second pick only lists {categoryWord(category)}, since comparing across categories doesn't
          tell you much. Percentiles are within each weapon's own type, by the same attack where enough of them have it: {rankText(sideA)}{a.uniqueName !== b.uniqueName && groupOf(sideA) !== groupOf(sideB) ? <>, {rankText(sideB)}</> : null}.
          A type with fewer than 6 weapons ranks against all {categoryWord(category)} instead.
          {anyIncarnon && (rankIncarnon
            ? <> Incarnon forms are ranked against other Incarnon forms of their type{leaderboard ? ', each with the leaderboard\'s evolutions' : ' (unevolved until the leaderboard loads)'}. Conditional parts of evolutions (on kill, on headshot...) aren't counted.</>
            : <> Incarnon forms are ranked against normal attacks too, so they'll mostly look strong.</>)}
        </p>
        {anyIncarnon && (
          <label className="inline-check">
            <input type="checkbox" checked={rankIncarnon} onChange={(event) => setRankIncarnon(event.target.checked)} />
            Rank Incarnon forms against other Incarnon forms
          </label>
        )}
        <div className="cw-pickers">
          <div className="cw-picker">
            <Thumb imageName={a.imageName} wikiImage={a.wikiImage} alt={a.name} wide />
            <SearchSelect options={options} selectedId={aId} onSelect={pickA} placeholder="First weapon" />
            {a.attacks.length > 1 && (
              <select value={aAttack} onChange={(event) => { setAAttack(Number(event.target.value)); setPicksA(null) }}>
                {a.attacks.map((option, index) => <option key={option.name} value={index}>{option.name}</option>)}
              </select>
            )}
            <span className="cw-type">{typeLabel(a)}</span>
            <EvolutionPicker tiers={sideA.tiers} picks={sideA.picks} fromLeaderboard={sideA.fromLeaderboard} onChange={setPicksA} />
          </div>
          <span className="cw-vs">vs</span>
          <div className="cw-picker">
            <Thumb imageName={b.imageName} wikiImage={b.wikiImage} alt={b.name} wide />
            <SearchSelect key={category} options={bOptions} selectedId={bId} onSelect={pickB} placeholder={`Another ${category.toLowerCase()} weapon`} />
            {b.attacks.length > 1 && (
              <select value={bAttack} onChange={(event) => { setBAttack(Number(event.target.value)); setPicksB(null) }}>
                {b.attacks.map((option, index) => <option key={option.name} value={index}>{option.name}</option>)}
              </select>
            )}
            <span className="cw-type">{typeLabel(b)}</span>
            <EvolutionPicker tiers={sideB.tiers} picks={sideB.picks} fromLeaderboard={sideB.fromLeaderboard} onChange={setPicksB} />
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>What's different</h3>
        <ul className="hint-list">{differences.map((line) => <li key={line}>{line}</li>)}</ul>
      </section>

      <section className="panel">
        <h3>Base stats</h3>
        <table className="cw-table fixed">
          <thead>
            <tr><th /><th>{a.name}<div className="muted-inline">{sideA.attack.name}{evolutionNote(sideA)}</div></th><th>{b.name}<div className="muted-inline">{sideB.attack.name}{evolutionNote(sideB)}</div></th><th>Gap</th></tr>
          </thead>
          <tbody>
            {rows.map((key) => {
              const va = sideA.metrics[key]
              const vb = sideB.metrics[key]
              const better = va === null || vb === null || Math.abs(va - vb) < 1e-9 ? null : (LOWER_IS_BETTER.has(key) ? va < vb : va > vb) ? 'a' : 'b'
              const cell = (value: number | null, which: 'a' | 'b') => {
                const side = which === 'a' ? sideA : sideB
                const item = standing(groupOf(side), key, value, side.kind, poolOf(side))
                return (
                  <td className={better === which ? 'cw-better' : ''}>
                    {metricText(key, value)}
                    {item && <div className={`cw-standing ${item.percentile >= 0.6 ? 'good' : item.percentile <= 0.4 ? 'bad' : ''}`}>{item.best ? 'best' : item.worst ? 'worst' : `top ${Math.max(1, Math.round((1 - item.percentile) * 100))}%`}</div>}
                  </td>
                )
              }
              const label = key === 'fireRate' && category === 'Melee' ? 'Attack speed' : METRIC_LABELS[key]
              return (
                <tr key={key}>
                  <td>{key === 'rawDps' ? <Tip text="Damage per shot × fire rate × average crit, no reloads, no mods. A rough 'how much it starts with'">{label} ⓘ</Tip> : label}</td>
                  {cell(va, 'a')}
                  {cell(vb, 'b')}
                  <td className="muted-inline">{va !== null && vb !== null ? (key === 'critChance' || key === 'statusChance' ? `${Math.round(Math.abs(va - vb) * 1000) / 10} pts` : ratioText(va, vb)) : ''}</td>
                </tr>
              )
            })}
            <tr>
              <td>Damage types</td>
              <td>{sideA.shares.map((row) => <div key={row.type} className={`dmg-${row.type}`}>{row.type} {pct(row.share)}</div>)}</td>
              <td>{sideB.shares.map((row) => <div key={row.type} className={`dmg-${row.type}`}>{row.type} {pct(row.share)}</div>)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h3>After modding <span className="muted-inline">(leaderboard: best build for each attack, neutral target)</span></h3>
        {!leaderboard ? <p className="muted-inline">Loading the leaderboard…</p> : (
          <table className="cw-table fixed">
            <thead><tr><th /><th>{a.name}</th><th>{b.name}</th><th>Gap</th></tr></thead>
            <tbody>
              {BOARD_ROWS.map(({ key, label }) => {
                const ra = boardFor(sideA, key)
                const rb = boardFor(sideB, key)
                const better = ra && rb ? (ra.entry.score > rb.entry.score ? 'a' : 'b') : null
                const cell = (info: ReturnType<typeof boardFor>, which: 'a' | 'b') => (
                  <td className={better === which ? 'cw-better' : ''}>
                    {info ? <>{short(info.entry.score)}<div className="muted-inline">#{info.rank} of {info.of}</div></> : <span className="muted-inline">not ranked</span>}
                  </td>
                )
                return (
                  <tr key={key}>
                    <td>{label}</td>
                    {cell(ra, 'a')}
                    {cell(rb, 'b')}
                    <td className="muted-inline">{ra && rb ? ratioText(ra.entry.score, rb.entry.score) : ''}</td>
                  </tr>
                )
              })}
              <tr>
                <td>Build (sustained)</td>
                <td className="muted-inline">{boardFor(sideA, 'sustained')?.entry.mods.map((mod) => mod.name).join(', ') ?? '–'}</td>
                <td className="muted-inline">{boardFor(sideB, 'sustained')?.entry.mods.map((mod) => mod.name).join(', ') ?? '–'}</td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <div className="cw-profiles">
        {[sideA, sideB].map((side) => (
          <section key={side.weapon.uniqueName} className="panel">
            <h3>{side.weapon.name} <span className="muted-inline">{side.attack.name}</span></h3>
            <div className="row">
              {mechanicTags(side.weapon, side.attack).map((tag) => (
                <Tip key={tag.label} className={`mech-tag ${tag.tone ?? ''}`} text={tag.explanation}>{tag.label} ⓘ</Tip>
              ))}
            </div>
            <ul className="hint-list">
              {profileLines(side.weapon, side.attack, side.metrics, side.kind, poolOf(side)).map((line) => <li key={line.text} className={`tone-${line.tone}`}>{line.text}</li>)}
              {getIncarnonTiers(side.weapon.name) && <li className="tone-good">Has an Incarnon form (its attacks are in the attack list).</li>}
              {!rivenTypeFor(side.weapon) && <li className="tone-bad">Can't take a riven.</li>}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

const evolutionNote = (side: Side) => {
  const count = Object.keys(side.picks).length
  return count ? ` · ${count} evolution${count > 1 ? 's' : ''}` : ''
}

// the plain-language summary: only the gaps big enough to matter, biggest first
function describeDifferences(a: Side, b: Side, sustained: { a?: number; b?: number } | null): string[] {
  const lines: { weight: number; text: string }[] = []
  const name = (side: Side) => side.weapon.name
  const compare = (key: MetricKey, describe: (winner: Side, loser: Side, ratio: number) => string, threshold = 1.15) => {
    const va = a.metrics[key]
    const vb = b.metrics[key]
    if (va === null || vb === null || va <= 0 || vb <= 0) return
    const ratio = Math.max(va, vb) / Math.min(va, vb)
    if (ratio < threshold) return
    const aWins = LOWER_IS_BETTER.has(key) ? va < vb : va > vb
    lines.push({ weight: ratio, text: describe(aWins ? a : b, aWins ? b : a, ratio) })
  }
  compare('rawDps', (w, l, r) => `Unmodded, ${name(w)} puts out ${r.toFixed(1)}x the damage per second of ${name(l)}.`)
  compare('hit', (w, _l, r) => `${name(w)} hits ${r.toFixed(1)}x harder per ${w.weapon.category === 'Melee' ? 'swing' : 'shot'}.`)
  compare('fireRate', (w, _l, r) => `${name(w)} ${w.weapon.category === 'Melee' ? 'swings' : 'fires'} ${r.toFixed(1)}x faster.`)
  compare('critChance', (w, l, r) => `${name(w)} has ${r.toFixed(1)}x the crit chance (${pct(w.metrics.critChance)} vs ${pct(l.metrics.critChance)}).`, 1.3)
  compare('statusChance', (w, l, r) => `${name(w)} has ${r.toFixed(1)}x the status chance (${pct(w.metrics.statusChance)} vs ${pct(l.metrics.statusChance)}).`, 1.3)
  compare('reload', (w, l) => `${name(w)} reloads faster (${metricText('reload', w.metrics.reload)} vs ${metricText('reload', l.metrics.reload)}).`, 1.3)
  compare('magazine', (w, l) => `${name(w)} holds more per magazine (${w.metrics.magazine} vs ${l.metrics.magazine}).`, 1.5)
  const sorted = lines.sort((x, y) => y.weight - x.weight).map((line) => line.text)

  // which way each one wants to be built
  const lean = (side: Side) => {
    const critValue = side.metrics.critChance * (side.metrics.critMultiplier - 1)
    return critValue >= side.metrics.statusChance * 1.2 ? 'crit' : side.metrics.statusChance >= critValue * 1.2 ? 'status' : 'hybrid'
  }
  if (lean(a) !== lean(b)) sorted.push(`${name(a)} leans ${lean(a)}, ${name(b)} leans ${lean(b)}, so they want different mods.`)
  const coA = resolveCoBehavior(a.weapon, a.attack).mode
  const coB = resolveCoBehavior(b.weapon, b.attack).mode
  if (coA !== coB && (coA === 'multiply' || coB === 'multiply')) sorted.push(`${coA === 'multiply' ? name(a) : name(b)} gets multiplicative Condition Overload, the other doesn't. That's a big edge with Galvanized mods and several status types.`)
  if (Boolean(a.attack.continuous) !== Boolean(b.attack.continuous)) sorted.push(`${a.attack.continuous ? name(a) : name(b)} is a beam: multishot merges into bigger ticks.`)
  if (a.attack.isAoE !== b.attack.isAoE) sorted.push(`${a.attack.isAoE ? name(a) : name(b)} deals area damage (no headshots).`)
  if (sustained?.a && sustained.b) {
    const ratio = Math.max(sustained.a, sustained.b) / Math.min(sustained.a, sustained.b)
    const winner = sustained.a >= sustained.b ? name(a) : name(b)
    sorted.push(ratio < 1.05
      ? 'Fully modded (leaderboard sustained DPS) they end up about even.'
      : `Fully modded (leaderboard sustained DPS), ${winner} comes out ${ratio.toFixed(2)}x ahead.`)
  }
  return sorted.length ? sorted : ['Their base numbers are within ~15% of each other.']
}
