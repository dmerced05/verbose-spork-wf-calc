// the front page: what the site is, the current records (read live from the leaderboards) and the tools, dressed in the
// game's own orbiter decorations. the art is WFCD's copies of the in-game decoration icons, hotlinked from their CDN like
// the weapon pictures elsewhere; an image that fails to load just disappears (FallbackImage)
import { useEffect, useState } from 'react'
import { weapons } from '../data'
import { loadLeaderboard } from '../optimizer/leaderboardLoader'
import { expandLeaderboard, type Leaderboard, type LeaderboardEntry, type LeaderboardFile } from '../optimizer/leaderboardTypes'
import { BOSSES } from '../optimizer/bossLeaderboard'
import { FallbackImage, imageSources } from './Thumb'

export type HomeTarget = 'calculator' | 'leaderboard' | 'compare' | 'rivens' | 'cap' | 'analysis' | 'status' | 'about'

// orbiter decorations, name as the game calls it -> WFCD image file
const HERO_ART = [
  { name: 'Exploration Poster', image: 'ExplorationPoster.png' },
  { name: "Orowyrm's Sanctum Display", image: 'DuviriDragonDisplayIcon.png' },
  { name: 'Parazon Poster', image: 'ParazonPoster.png' },
]
const WALL_ART = [
  { name: 'Madurai Poster', image: 'FocusSchoolMadurai.png' },
  { name: 'Vazarin Poster', image: 'FocusSchoolVazarin.png' },
  { name: 'Naramon Poster', image: 'FocusSchoolNaramon.png' },
  { name: 'Unairu Poster', image: 'FocusSchoolUnairu.png' },
  { name: 'Zenurik Poster', image: 'FocusSchoolZenurik.png' },
  { name: 'Mistress Of Fear Poster', image: 'OraxiaLisetPoster.png' },
  { name: 'Hero Of Duviri Display', image: 'LisetDuviriPoster512x512.png' },
  { name: 'Kaithe Community Display', image: 'CommunityDuviriPortrait.png' },
  { name: 'Alone Portrait', image: 'JadeShadowsAlonePoster.png' },
  { name: 'Onemind Poster', image: 'NokkoPosterB.png' },
]

const TOOLS: { target: HomeTarget; title: string; blurb: string }[] = [
  { target: 'calculator', title: 'Calculator', blurb: 'One weapon, one build, every number behind it.' },
  { target: 'leaderboard', title: 'Leaderboard', blurb: 'The best build for every attack, ranked 11 ways, plus boss kill times.' },
  { target: 'compare', title: 'Compare', blurb: 'Build paths and weapons side by side.' },
  { target: 'rivens', title: 'Rivens', blurb: 'Which riven stats are worth rolling for.' },
  { target: 'cap', title: 'Damage Cap', blurb: 'Everything one hit needs to stack up to break the limit.' },
  { target: 'analysis', title: 'Data Analysis', blurb: 'The whole arsenal in graphs: crit, status, trends, Enervate.' },
  { target: 'status', title: 'Status Guide', blurb: 'Every status effect and how it stacks.' },
  { target: 'about', title: 'How it works', blurb: 'Every algorithm on the site, with its math.' },
]

const weaponsByName = new Map(weapons.map((weapon) => [weapon.name, weapon]))
const big = (value: number) => (value >= 1e9 ? `${+(value / 1e9).toPrecision(3)}B` : value >= 1e6 ? `${+(value / 1e6).toPrecision(3)}M` : value >= 1e3 ? `${+(value / 1e3).toPrecision(3)}k` : `${Math.round(value)}`)
const best = (entries: LeaderboardEntry[] | undefined, keep: (entry: LeaderboardEntry) => boolean = () => true) =>
  (entries ?? []).filter(keep).reduce<LeaderboardEntry | null>((top, entry) => (!top || entry.score > top.score ? entry : top), null)

interface Record { label: string; entry: LeaderboardEntry; value: string }

export function Home({ onOpen }: { onOpen: (target: HomeTarget) => void }) {
  const [board, setBoard] = useState<Leaderboard | null>(null)
  const [bossBoard, setBossBoard] = useState<Leaderboard | null>(null)
  useEffect(() => {
    loadLeaderboard().then(setBoard)
    fetch('./boss-leaderboard.json')
      .then((response) => (response.ok ? (response.json() as Promise<LeaderboardFile>) : null))
      .then((file) => setBossBoard(file ? expandLeaderboard(file) : null))
      .catch(() => setBossBoard(null))
  }, [])

  // the records, straight off the current boards: best sustained DPS per category, fastest kill per boss
  const records: Record[] = []
  for (const category of ['Primary', 'Secondary', 'Melee']) {
    const top = best(board?.boards.sustained, (entry) => entry.category === category)
    if (top) records.push({ label: `${category} · sustained DPS`, entry: top, value: big(top.score) })
  }
  for (const boss of BOSSES) {
    const top = best(bossBoard?.boards[boss.key])
    if (top) records.push({ label: `${boss.name} · kill time`, entry: top, value: `${(1 / top.score).toFixed(1)} s` })
  }
  const weaponCount = weapons.filter((weapon) => !weapon.exalted).length

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-text">
          <p className="home-eyebrow">Warframe weapon analysis</p>
          <h2 className="home-title">Every weapon. Every build. Run through the math.</h2>
          <p className="home-lede">
            A personal tool for exploring Warframe's weapon database: the game's damage formula, a build optimizer and leaderboards
            for {weaponCount} weapons, from base stats to boss kill times.
          </p>
          <div className="home-actions">
            <button className="home-primary" onClick={() => onOpen('calculator')}>Open the calculator</button>
            <button onClick={() => onOpen('leaderboard')}>See the leaderboard</button>
          </div>
        </div>
        <div className="home-fan" aria-hidden="true">
          {HERO_ART.map((art, index) => (
            <FallbackImage key={art.image} sources={imageSources(art.image)} className={`home-fan-art home-fan-${index}`} alt="" />
          ))}
        </div>
      </section>

      <section className="home-section">
        <div className="row spread">
          <h2>Current records</h2>
          <button className="home-link" onClick={() => onOpen('leaderboard')}>All rankings</button>
        </div>
        {records.length === 0 ? (
          <p className="muted">Loading the leaderboards…</p>
        ) : (
          <div className="home-records">
            {records.map(({ label, entry, value }) => {
              const weapon = weaponsByName.get(entry.weaponName)
              return (
                <button key={label} className="home-record" onClick={() => onOpen('leaderboard')}>
                  <span className="home-record-label">{label}</span>
                  <FallbackImage sources={imageSources(weapon?.imageName, weapon?.wikiImage)} className="home-record-art" alt="" />
                  <span className="home-record-value">{value}</span>
                  <span className="home-record-name">{entry.weaponName}</span>
                  <span className="home-record-attack">{entry.attack}</span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section className="home-section">
        <h2>Tools</h2>
        <div className="home-tools">
          {TOOLS.map((tool) => (
            <button key={tool.target} className="home-tool" onClick={() => onOpen(tool.target)}>
              <span className="home-tool-title">{tool.title}</span>
              <span className="home-tool-blurb">{tool.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="home-section">
        <h2>From the orbiter</h2>
        <div className="home-wall">
          {WALL_ART.map((art) => (
            <figure key={art.image} className="home-wall-item">
              <FallbackImage sources={imageSources(art.image)} className="home-wall-art" alt={art.name} />
              <figcaption>{art.name}</figcaption>
            </figure>
          ))}
        </div>
        <p className="muted">In-game orbiter decorations. Art © Digital Extremes, images via WFCD. Not affiliated with Digital Extremes.</p>
      </section>
    </div>
  )
}
