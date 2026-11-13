// the front page: random picks off the leaderboard, so it's a way into builds rather than a list of links. a full
// loadout (frame + one weapon per slot with its best sustained build), four random frames, two weapons head to head,
// and a shuffled wall. everything rerolls, and every weapon loads its leaderboard build in the calculator
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { warframes, weaponsById } from '../data'
import { loadLeaderboard } from '../optimizer/leaderboardLoader'
import type { Leaderboard, LeaderboardEntry } from '../optimizer/leaderboardTypes'
import type { Warframe, Weapon } from '../types'
import { FallbackImage, imageSources } from './Thumb'

type Slot = 'Primary' | 'Secondary' | 'Melee'
const SLOTS: Slot[] = ['Primary', 'Secondary', 'Melee']

// one weapon's best sustained build, its rank in its slot, and the same for its best single hit
interface Pick { weapon: Weapon; entry: LeaderboardEntry; rank: number; single: number | null; singleRank: number | null }

const big = (value: number) =>
  value >= 1e9 ? `${+(value / 1e9).toPrecision(3)}B` : value >= 1e6 ? `${+(value / 1e6).toPrecision(3)}M` : value >= 1e3 ? `${+(value / 1e3).toPrecision(3)}k` : `${Math.round(value)}`
const percent = (fraction: number) => `${Math.round(fraction * 100)}%`

// n distinct random items, skipping the ones in avoid when there's enough left
function sample<T>(items: T[], count: number, avoid: T[] = []): T[] {
  const pool = items.length - avoid.length >= count ? items.filter((item) => !avoid.includes(item)) : [...items]
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]]
  }
  return pool.slice(0, count)
}

// best entry per weapon on a board, ranked within its slot
function rankBoard(entries: LeaderboardEntry[] | undefined) {
  const best = new Map<string, LeaderboardEntry>()
  for (const entry of entries ?? []) if (!best.has(entry.weaponId) || entry.score > best.get(entry.weaponId)!.score) best.set(entry.weaponId, entry)
  const ranks = new Map<string, number>()
  for (const slot of SLOTS) {
    [...best.values()].filter((entry) => entry.category === slot).sort((a, b) => b.score - a.score).forEach((entry, index) => ranks.set(entry.weaponId, index + 1))
  }
  return { best, ranks }
}

function buildPools(board: Leaderboard): Record<Slot, Pick[]> {
  const sustained = rankBoard(board.boards.sustained)
  const single = rankBoard(board.boards.single)
  const pools: Record<Slot, Pick[]> = { Primary: [], Secondary: [], Melee: [] }
  for (const [weaponId, entry] of sustained.best) {
    const weapon = weaponsById.get(weaponId)
    if (!weapon || !SLOTS.includes(entry.category as Slot)) continue
    const singleEntry = single.best.get(weaponId)
    pools[entry.category as Slot].push({
      weapon, entry, rank: sustained.ranks.get(weaponId)!,
      single: singleEntry?.score ?? null, singleRank: single.ranks.get(weaponId) ?? null,
    })
  }
  return pools
}

const WeaponArt = ({ weapon, className }: { weapon: Weapon; className: string }) =>
  <FallbackImage sources={imageSources(weapon.imageName, weapon.wikiImage)} className={className} alt={weapon.name} />
const Reroll = ({ label = 'Reroll', onClick }: { label?: string; onClick: () => void }) =>
  <button className="home-btn" onClick={onClick}>🎲 {label}</button>

interface Props {
  onLoadBuild: (entry: LeaderboardEntry) => void
  onUseFrame: (frameName: string) => void
}

export function Home({ onLoadBuild, onUseFrame }: Props) {
  const [board, setBoard] = useState<Leaderboard | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { loadLeaderboard().then((loaded) => (loaded ? setBoard(loaded) : setFailed(true))) }, [])
  const pools = useMemo(() => (board ? buildPools(board) : null), [board])

  return (
    <div className="home">
      <LoadoutSection pools={pools} onLoadBuild={onLoadBuild} onUseFrame={onUseFrame} />
      <FramesSection onUseFrame={onUseFrame} />
      {pools ? (
        <>
          <VersusSection pools={pools} onLoadBuild={onLoadBuild} />
          <WallSection pools={pools} onLoadBuild={onLoadBuild} />
        </>
      ) : (
        <p className="muted">{failed ? "Couldn't load the leaderboard, so no weapons to draw." : 'Loading weapons…'}</p>
      )}
    </div>
  )
}

function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="home-head"><h2>{title}</h2><div className="home-actions">{children}</div></div>
}

function FrameCard({ frame, onUseFrame, tall }: { frame: Warframe; onUseFrame: (name: string) => void; tall?: boolean }) {
  return (
    <div className="home-card home-frame">
      <FallbackImage sources={imageSources(frame.imageName, frame.wikiImage)} className={`home-frame-art${tall ? ' tall' : ''}`} alt={frame.name} />
      <div className="home-card-body">
        <span className="home-name">{frame.name}</span>
        <div className="home-stats">
          {[['Health', frame.health], ['Shield', frame.shield], ['Armor', frame.armor], ['Energy', frame.energy]].map(([label, value]) => (
            <span key={label}><span className="label">{label}</span><span className="home-stat">{value}</span></span>
          ))}
        </div>
        <ul className="home-abilities">{frame.abilities.map((ability) => <li key={ability.name}>{ability.name}</li>)}</ul>
        <div className="home-actions"><button className="home-btn main" onClick={() => onUseFrame(frame.name)}>Use in Calculator</button></div>
      </div>
    </div>
  )
}

function LoadoutSection({ pools, onLoadBuild, onUseFrame }: { pools: Record<Slot, Pick[]> | null; onLoadBuild: Props['onLoadBuild']; onUseFrame: Props['onUseFrame'] }) {
  const [frame, setFrame] = useState(() => sample(warframes, 1)[0])
  const [picks, setPicks] = useState<Partial<Record<Slot, Pick>>>({})
  const rollSlot = (slot: Slot) => pools && setPicks((current) => ({ ...current, [slot]: sample(pools[slot], 1, current[slot] ? [current[slot]!] : [])[0] }))
  const rollAll = () => {
    setFrame((current) => sample(warframes, 1, [current])[0])
    if (pools) setPicks(Object.fromEntries(SLOTS.map((slot) => [slot, sample(pools[slot], 1)[0]])))
  }
  // first draw once the leaderboard's in
  useEffect(() => { if (pools) setPicks(Object.fromEntries(SLOTS.map((slot) => [slot, sample(pools[slot], 1)[0]]))) }, [pools])

  return (
    <section className="home-section">
      <SectionHead title="Loadout"><Reroll label="Reroll all" onClick={rollAll} /></SectionHead>
      <div className="home-loadout">
        <FrameCard frame={frame} onUseFrame={onUseFrame} tall />
        <div className="home-slots">
          {SLOTS.map((slot) => {
            const pick = picks[slot]
            if (!pick) return <div key={slot} className="home-slot muted">{slot}…</div>
            return (
              <div key={slot} className="home-slot">
                <WeaponArt weapon={pick.weapon} className="home-slot-art" />
                <div className="home-slot-body">
                  <div className="home-slot-top">
                    <span className="home-name">{pick.weapon.name}</span>
                    <span><span className="home-big">{big(pick.entry.score)}</span> <span className="label">#{pick.rank} {slot}</span></span>
                  </div>
                  <div className="home-chips">
                    {pick.entry.mods.map((mod) => <span key={mod.id} className="home-chip">{mod.name}</span>)}
                    {pick.entry.arcane && <span className="home-chip arcane">{pick.entry.arcane.name}</span>}
                  </div>
                  <div className="home-actions">
                    <button className="home-btn main" onClick={() => onLoadBuild(pick.entry)}>Load build</button>
                    <Reroll label={`Reroll ${slot.toLowerCase()}`} onClick={() => rollSlot(slot)} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function FramesSection({ onUseFrame }: { onUseFrame: Props['onUseFrame'] }) {
  const [frames, setFrames] = useState(() => sample(warframes, 4))
  return (
    <section className="home-section">
      <SectionHead title="Warframes"><Reroll onClick={() => setFrames((current) => sample(warframes, 4, current))} /></SectionHead>
      <div className="home-grid frames">{frames.map((frame) => <FrameCard key={frame.uniqueName} frame={frame} onUseFrame={onUseFrame} />)}</div>
    </section>
  )
}

// two weapons from one slot, each row's winner lit up. base stats off the weapon's first attack, DPS off the boards
function VersusSection({ pools, onLoadBuild }: { pools: Record<Slot, Pick[]>; onLoadBuild: Props['onLoadBuild'] }) {
  const [slot, setSlot] = useState<Slot>('Primary')
  const [pair, setPair] = useState(() => sample(pools.Primary, 2))
  const roll = (nextSlot: Slot) => { setSlot(nextSlot); setPair(sample(pools[nextSlot], 2)) }
  if (pair.length < 2) return null
  const [left, right] = pair
  const base = (pick: Pick) => pick.weapon.attacks[0]
  const singleText = (pick: Pick) => (pick.single === null ? '–' : big(pick.single))
  const rows: [string, number, number, string, string][] = [
    ['Sustained DPS', left.entry.score, right.entry.score, big(left.entry.score), big(right.entry.score)],
    ['Best single hit', left.single ?? 0, right.single ?? 0, singleText(left), singleText(right)],
    ['Crit chance', base(left).critChance, base(right).critChance, percent(base(left).critChance), percent(base(right).critChance)],
    ['Crit multiplier', base(left).critMultiplier, base(right).critMultiplier, `${base(left).critMultiplier}×`, `${base(right).critMultiplier}×`],
    ['Status chance', base(left).statusChance, base(right).statusChance, percent(base(left).statusChance), percent(base(right).statusChance)],
    ['Fire rate', base(left).fireRate, base(right).fireRate, base(left).fireRate.toFixed(2), base(right).fireRate.toFixed(2)],
  ]
  if (left.weapon.magazineSize && right.weapon.magazineSize) {
    rows.push(['Magazine', left.weapon.magazineSize, right.weapon.magazineSize, `${left.weapon.magazineSize}`, `${right.weapon.magazineSize}`])
  }
  const side = (pick: Pick) => (
    <div className="home-vs-side">
      <WeaponArt weapon={pick.weapon} className="home-vs-art" />
      <span className="home-name big">{pick.weapon.name}</span>
      <span className="label">#{pick.rank} {slot}</span>
      <button className="home-btn main" onClick={() => onLoadBuild(pick.entry)}>Load build</button>
    </div>
  )

  return (
    <section className="home-section">
      <SectionHead title="Versus">
        <select value={slot} onChange={(event) => roll(event.target.value as Slot)} aria-label="Slot">
          {SLOTS.map((option) => <option key={option}>{option}</option>)}
        </select>
        <Reroll onClick={() => roll(slot)} />
      </SectionHead>
      <div className="home-versus panel">
        {side(left)}
        <div className="home-vs-rows">
          {rows.map(([label, a, b, aText, bText]) => {
            const total = a + b || 1
            return (
              <div key={label} className="home-vs-row">
                <span className={`home-vs-num left${a >= b ? ' win' : ''}`}>{aText}</span>
                <div>
                  <span className="label">{label}</span>
                  <div className="home-vs-bar">
                    <span className={a >= b ? 'win' : ''} style={{ flexGrow: a / total }} />
                    <span className={b >= a ? 'win' : ''} style={{ flexGrow: b / total }} />
                  </div>
                </div>
                <span className={`home-vs-num${b >= a ? ' win' : ''}`}>{bText}</span>
              </div>
            )
          })}
        </div>
        {side(right)}
      </div>
    </section>
  )
}

function WallSection({ pools, onLoadBuild }: { pools: Record<Slot, Pick[]>; onLoadBuild: Props['onLoadBuild'] }) {
  const [filter, setFilter] = useState<Slot | 'All'>('All')
  const poolFor = (which: Slot | 'All') => (which === 'All' ? SLOTS.flatMap((slot) => pools[slot]) : pools[which])
  const [picks, setPicks] = useState(() => sample(poolFor('All'), 8))
  const show = (which: Slot | 'All') => { setFilter(which); setPicks(sample(poolFor(which), 8)) }

  return (
    <section className="home-section">
      <SectionHead title="Weapons">
        <div className="tabs" role="group" aria-label="Filter">
          {(['All', ...SLOTS] as const).map((option) => (
            <button key={option} className={filter === option ? 'active' : ''} aria-pressed={filter === option} onClick={() => show(option)}>{option}</button>
          ))}
        </div>
        <Reroll label="Shuffle" onClick={() => show(filter)} />
      </SectionHead>
      <div className="home-grid">
        {picks.map((pick) => (
          <button key={pick.weapon.uniqueName} className="home-card home-mini" onClick={() => onLoadBuild(pick.entry)} title={`Load the ${pick.weapon.name} build in the calculator`}>
            <WeaponArt weapon={pick.weapon} className="home-mini-art" />
            <span className="home-card-body">
              <span className="home-name">{pick.weapon.name}</span>
              <span className="home-mini-line"><span className="home-big">{big(pick.entry.score)}</span><span className="label">#{pick.rank} {pick.entry.category}</span></span>
              <span className="home-mini-line label"><span>Single hit {pick.single === null ? '–' : big(pick.single)}</span>{pick.singleRank !== null && <span>#{pick.singleRank}</span>}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
