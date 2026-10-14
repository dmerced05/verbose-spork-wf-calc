import { useEffect, useMemo, useState } from 'react'
import { FULL_HEAVY_BOARD, TIME_WINDOWS, boardKey, objectiveById, type ObjectiveId } from '../optimizer/objectives'
import { raisesFireRate } from '../calc/parseMod'
import { modsById, weaponsById } from '../data'
import { biggestHit, comboTotal, heavyBreakdownText, heavyComboFor } from '../data/heavyAttacks'
import { ATTACK_KINDS, attackKind, type AttackKind } from '../optimizer/attackKinds'

// attack kind of an entry, looked up from the weapon data (null if the weapon isn't in this data version)
const kindOf = (entry: LeaderboardEntry): AttackKind | null => {
  const weapon = weaponsById.get(entry.weaponId)
  const attack = weapon?.attacks.find((option) => option.name === entry.attack)
  return weapon && attack ? attackKind(weapon, attack) : null
}
const KIND_LABEL = Object.fromEntries(ATTACK_KINDS.map((kind) => [kind.id, kind.label])) as Record<AttackKind, string>
import { expandLeaderboard, type Leaderboard as LeaderboardData, type LeaderboardEntry, type LeaderboardFile } from '../optimizer/leaderboardTypes'

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 })
const percent = (value: number) => `${Math.round(value * 100)}%`
const CATEGORIES = ['All', 'Primary', 'Secondary', 'Melee']
const PAGE_SIZE = 50

type RankBy = 'sustained' | 'window' | 'single' | 'attack'
const RANK_BY: { id: RankBy; label: string }[] = [
  { id: 'sustained', label: 'Sustained DPS' },
  { id: 'window', label: 'Damage in a time window' },
  { id: 'single', label: 'Single damage instance' },
  { id: 'attack', label: 'Whole attack (hit + procs)' },
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
  const [bestPerWeapon, setBestPerWeapon] = useState(false)
  const [fullHeavy, setFullHeavy] = useState(false)
  const [kinds, setKinds] = useState<Set<AttackKind>>(() => new Set(ATTACK_KINDS.map((kind) => kind.id)))
  const toggleKind = (kind: AttackKind) => {
    const next = new Set(kinds)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    setKinds(next)
    setLimit(PAGE_SIZE)
  }
  const onlyKind = (kind: AttackKind) => { setKinds(new Set([kind])); setLimit(PAGE_SIZE) }
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

  // every attack has its own entry (slam, heavy slam, heavy attack, alt-fire...). "Best attack per weapon" keeps one
  // per weapon instead. rank, then filter, so "#12" always means 12th overall
  const ranked = useMemo(() => {
    if (!data) return []
    let entries = data.boards[key] ?? []
    // "Count the full heavy": multi-hit Heavy Attacks come from the full-heavy board (every hit added up)
    if (rankBy === 'single' && fullHeavy) {
      const full = new Map((data.boards[FULL_HEAVY_BOARD] ?? []).map((entry) => [`${entry.weaponId}|${entry.attack}`, entry]))
      entries = entries.map((entry) => full.get(`${entry.weaponId}|${entry.attack}`) ?? entry)
    }
    // attack-kind filter goes before ranking, so "#1" with only Heavy attacks picked means the best heavy
    const allKinds = kinds.size === ATTACK_KINDS.length
    entries = entries.filter((entry) => (includeIncarnon || !entry.incarnonForm) && (allKinds || kinds.has(kindOf(entry) ?? 'primaryFire')))
    if (bestPerWeapon) {
      const best = new Map<string, LeaderboardEntry>()
      for (const entry of entries) {
        const current = best.get(entry.weaponId)
        if (!current || entry.score > current.score) best.set(entry.weaponId, entry)
      }
      entries = [...best.values()]
    }
    return [...entries].sort((a, b) => b.score - a.score).map((entry, index) => ({ entry, rank: index + 1 }))
  }, [data, key, includeIncarnon, bestPerWeapon, rankBy, fullHeavy, kinds])

  const rows = useMemo(() => {
    const searchText = search.trim().toLowerCase()
    return ranked.filter(
      ({ entry }) => (category === 'All' || entry.category === category) && (!searchText || `${entry.weaponName} ${entry.attack}`.toLowerCase().includes(searchText)),
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
          <input placeholder="Search weapons or attacks (e.g. heavy slam)" value={search} onChange={(event) => { setSearch(event.target.value); resetPaging() }} />
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
          {rankBy === 'single' && (
            <label className="inline-check" title="Multi-hit Heavy Attacks (Heavy Scythes, Sparring, Dual Swords...) normally rank by their biggest hit. On = every hit of the heavy added up">
              <input type="checkbox" checked={fullHeavy} onChange={(event) => { setFullHeavy(event.target.checked); resetPaging() }} />
              Count the full heavy (all hits)
            </label>
          )}
          <label className="inline-check" title="Off = every attack of every weapon gets its own listing">
            <input type="checkbox" checked={bestPerWeapon} onChange={(event) => { setBestPerWeapon(event.target.checked); resetPaging() }} />
            Best attack per weapon only
          </label>
          <span className="muted-inline">{rows.length} {bestPerWeapon ? 'weapons' : 'attacks'}</span>
        </div>
        <div className="kind-filter">
          <span className="muted-inline">Attack types:</span>
          {ATTACK_KINDS.map((kind) => (
            <button
              key={kind.id}
              className={`kind-chip ${kinds.has(kind.id) ? 'on' : ''} ${kind.melee ? 'melee' : 'gun'}`}
              onClick={() => toggleKind(kind.id)}
              onDoubleClick={() => onlyKind(kind.id)}
              title="Click to toggle, double-click to show only this type"
            >
              {kind.label}
            </button>
          ))}
          {kinds.size < ATTACK_KINDS.length && (
            <button className="link-button" onClick={() => { setKinds(new Set(ATTACK_KINDS.map((kind) => kind.id))); resetPaging() }}>all</button>
          )}
        </div>
        <p className="muted">
          Every weapon attack, each optimized on its own, in one fixed scenario: {data.scenario}
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
              <div className="muted-inline">
                {entry.attack} · {entry.type}
                {kindOf(entry) && <span className="kind-tag"> · {KIND_LABEL[kindOf(entry)!].toLowerCase()}</span>}
              </div>
              {(() => {
                // multi-hit heavies: hover for the wiki/arsenal hit list, click for this build's damage per hit
                const combo = /^heavy attack$/i.test(entry.attack) ? heavyComboFor(entry.weaponName) : null
                if (!combo) return null
                const normal = weaponsById.get(entry.weaponId)?.attacks.find((option) => /^normal attack$/i.test(option.name))
                const normalTotal = normal ? Object.values(normal.damage).reduce((sum, amount) => sum + amount, 0) : undefined
                // the entry's single hit is either the biggest hit or all hits added up, scale each hit from that
                const scoredMultiplier = rankBy === 'single' && fullHeavy ? comboTotal(combo) : biggestHit(combo)
                const perUnit = entry.stats.singleHit / scoredMultiplier
                return (
                  <details className="heavy-details">
                    <summary className="multi-hit-tag" title={heavyBreakdownText(combo, normalTotal)}>
                      Multi-hit heavy · {combo.hits.length} hits ⓘ
                    </summary>
                    <ol>
                      {combo.hits.map((hit, index) => (
                        <li key={index}>
                          {Math.round(hit.multiplier * 100)}% → {compact.format(hit.multiplier * perUnit)}
                          {hit.procs && <span className="muted-inline"> {hit.procs.map((proc) => (proc === 'Slash' ? 'Bleed' : proc)).join(', ')}</span>}
                          {hit.radial && <span className="muted-inline"> radial</span>}
                        </li>
                      ))}
                    </ol>
                    <div className="muted-inline">
                      All hits: {compact.format(comboTotal(combo) * perUnit)} · biggest: {compact.format(biggestHit(combo) * perUnit)} (crits averaged, before forced procs)
                    </div>
                  </details>
                )
              })()}
            </div>
            <div className="board-score">
              <span className="value">{compact.format(entry.score)}</span>
              <span className="label">
                {rankBy === 'single' && fullHeavy && /^heavy attack$/i.test(entry.attack) && heavyComboFor(entry.weaponName) ? 'all hits' : objective.unit}
              </span>
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
