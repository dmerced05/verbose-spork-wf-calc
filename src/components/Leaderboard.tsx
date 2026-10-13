import { useEffect, useMemo, useState } from 'react'
import { TIME_WINDOWS, boardKey, objectiveById, type ObjectiveId } from '../optimizer/objectives'
import { raisesFireRate } from '../calc/parseMod'
import { modsById } from '../data'
import { expandLeaderboard, type Leaderboard as LeaderboardData, type LeaderboardEntry, type LeaderboardFile } from '../optimizer/leaderboardTypes'

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 })
const percent = (value: number) => `${Math.round(value * 100)}%`
const CATEGORIES = ['All', 'Primary', 'Secondary', 'Melee']
const PAGE_SIZE = 50

type RankBy = 'sustained' | 'window' | 'single'
const RANK_BY: { id: RankBy; label: string }[] = [
  { id: 'sustained', label: 'Sustained DPS' },
  { id: 'window', label: 'Damage in a time window' },
  { id: 'single', label: 'Single damage instance' },
]

interface Props {
  onLoadBuild: (entry: LeaderboardEntry) => void
}

// one leaderboard, ranked by whatever the settings say. every setting maps to a ranking that was precomputed by
// `npm run leaderboard` (scripts/build-leaderboard.ts) into public/leaderboard.json, so nothing is optimized here
export function Leaderboard({ onLoadBuild }: Props) {
  const [data, setData] = useState<LeaderboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rankBy, setRankBy] = useState<RankBy>('sustained')
  const [windowSeconds, setWindowSeconds] = useState<number>(10)
  const [includeIncarnon, setIncludeIncarnon] = useState(true)
  const [allowFireRate, setAllowFireRate] = useState(true)
  const [category, setCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)

  useEffect(() => {
    fetch('./leaderboard.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<LeaderboardFile>
      })
      .then((file) => setData(expandLeaderboard(file)))
      .catch((reason) => setError(String(reason)))
  }, [])

  const objectiveId: ObjectiveId = rankBy === 'window' ? (`window${windowSeconds}` as ObjectiveId) : rankBy
  const objective = objectiveById(objectiveId)
  // DPS rankings were also optimized without fire rate / attack speed mods, single hit doesn't care about fire rate
  const key = boardKey(objectiveId, allowFireRate || !objective.usesFireRate)

  // each weapon has a best normal-attack entry and (if it has one) a best Incarnon-form entry. pick the better
  // allowed one, rank those, then filter. the rank stays global so "#12" always means 12th overall
  const ranked = useMemo(() => {
    if (!data) return []
    const bestPerWeapon = new Map<string, LeaderboardEntry>()
    for (const entry of data.boards[key] ?? []) {
      if (entry.incarnonForm && !includeIncarnon) continue
      const current = bestPerWeapon.get(entry.weaponId)
      if (!current || entry.score > current.score) bestPerWeapon.set(entry.weaponId, entry)
    }
    return [...bestPerWeapon.values()].sort((a, b) => b.score - a.score).map((entry, index) => ({ entry, rank: index + 1 }))
  }, [data, key, includeIncarnon])

  const rows = useMemo(() => {
    const searchText = search.trim().toLowerCase()
    return ranked.filter(
      ({ entry }) => (category === 'All' || entry.category === category) && (!searchText || entry.weaponName.toLowerCase().includes(searchText)),
    )
  }, [ranked, category, search])

  const resetPaging = () => setLimit(PAGE_SIZE)

  if (error) {
    return (
      <section className="panel">
        <h2>Leaderboard</h2>
        <p className="muted">Couldn't load leaderboard.json ({error}). Generate it with <code>npm run leaderboard</code>, then rebuild.</p>
      </section>
    )
  }
  if (!data) return <section className="panel"><p className="muted">Loading leaderboard…</p></section>

  return (
    <div className="leaderboard">
      <section className="panel">
        <div className="leaderboard-settings">
          <label>
            Rank by
            <div className="board-tabs" role="tablist">
              {RANK_BY.map((option) => (
                <button
                  key={option.id} role="tab" aria-selected={rankBy === option.id}
                  className={rankBy === option.id ? 'active' : ''}
                  onClick={() => { setRankBy(option.id); resetPaging() }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </label>
          {rankBy === 'window' && (
            <label>
              Time window
              <div className="board-tabs" role="tablist">
                {TIME_WINDOWS.map((seconds) => (
                  <button
                    key={seconds} role="tab" aria-selected={windowSeconds === seconds}
                    className={windowSeconds === seconds ? 'active' : ''}
                    onClick={() => { setWindowSeconds(seconds); resetPaging() }}
                  >
                    {seconds} s
                  </button>
                ))}
              </div>
            </label>
          )}
        </div>
        <p className="board-description">{objective.description}.</p>
        <div className="row board-filters">
          <select value={category} onChange={(event) => { setCategory(event.target.value); resetPaging() }}>
            {CATEGORIES.map((option) => <option key={option}>{option}</option>)}
          </select>
          <input placeholder="Search weapons" value={search} onChange={(event) => { setSearch(event.target.value); resetPaging() }} />
          <label className="inline-check" title="Incarnon forms run on Incarnon charge, which isn't modeled, so they never reload here">
            <input type="checkbox" checked={includeIncarnon} onChange={(event) => { setIncludeIncarnon(event.target.checked); resetPaging() }} />
            Include Incarnon forms
          </label>
          {objective.usesFireRate && (
            <label className="inline-check" title="Off = the builds were optimized without fire rate / attack speed mods or arcanes">
              <input type="checkbox" checked={allowFireRate} onChange={(event) => { setAllowFireRate(event.target.checked); resetPaging() }} />
              Allow fire rate mods
            </label>
          )}
          <span className="muted-inline">{rows.length} weapons</span>
        </div>
        <p className="muted">
          Best attack per weapon in one fixed scenario: {data.scenario}
          Incarnon forms don't reload here (their charge isn't in the data). Shell-by-shell weapons (Felarx, Struns, Corinth, Zarr)
          reload longer with magazine mods. Precomputed {new Date(data.generatedAt).toLocaleDateString()} from {data.dataVersion}.
        </p>
      </section>

      <ol className="board-list">
        {rows.slice(0, limit).map(({ entry, rank }) => (
          <li key={`${entry.weaponId}-${entry.attack}`} className="board-row panel">
            <div className="board-rank">#{rank}</div>
            <div className="board-weapon">
              <div className="board-name">{entry.weaponName}</div>
              <div className="muted-inline">{entry.attack} · {entry.type}</div>
            </div>
            <div className="board-score">
              <span className="value">{compact.format(entry.score)}</span>
              <span className="label">{objective.unit}</span>
            </div>
            <div className="board-stats">
              <span title="Crit chance">CC {percent(entry.stats.critChance)}</span>
              <span title="Crit multiplier">CM {entry.stats.critMultiplier.toFixed(1)}x</span>
              <span title="Status chance">SC {percent(entry.stats.statusChance)}</span>
              <span title="Multishot">MS {entry.stats.multishot.toFixed(1)}</span>
              {entry.stats.magazineSize !== null && (
                <span title="Magazine / reload, and share of time spent firing">
                  Mag {entry.stats.magazineSize} · {entry.stats.reloadTime}s ({percent(entry.stats.uptime)} firing)
                </span>
              )}
              {entry.stats.damageTypes.slice(0, 3).map((damage) => (
                <span key={damage.type} className={`dmg-${damage.type}`}>{damage.type} {percent(damage.share)}</span>
              ))}
            </div>
            <div className="board-build">
              {entry.mods.map((mod) => {
                const equipped = modsById.get(mod.id)
                const fireRate = equipped ? raisesFireRate(equipped.levelStats, mod.rank) : false
                return (
                  <span key={mod.id} className={`chip ${fireRate ? 'fire-rate-chip' : ''}`} title={fireRate ? 'Fire rate / attack speed mod' : undefined}>
                    {mod.name}{fireRate && <span className="fr-tag">FR</span>}
                  </span>
                )
              })}
              {entry.arcane && <span className="chip arcane-chip">{entry.arcane.name}</span>}
              {entry.perks.map((perk) => <span key={perk.tier} className="chip perk-chip">Evo {perk.tier}: {perk.name}</span>)}
              {entry.bonusElement && (
                <span className="chip passive-chip">+{Math.round(entry.bonusElement.value * 100)}% {entry.bonusElement.damageType}</span>
              )}
              {entry.passives?.map((name) => <span key={name} className="chip passive-chip" title="Weapon passive">{name}</span>)}
            </div>
            <button className="board-load" onClick={() => onLoadBuild(entry)}>Load build</button>
          </li>
        ))}
      </ol>
      {rows.length > limit && (
        <button className="show-more" onClick={() => setLimit(limit + PAGE_SIZE)}>
          Show {Math.min(PAGE_SIZE, rows.length - limit)} more
        </button>
      )}
    </div>
  )
}
