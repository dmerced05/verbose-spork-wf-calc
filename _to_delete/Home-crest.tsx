// the front page: Orowyrm's Sanctum Display across the whole screen, the crest, and the five focus school posters
// as the way into the tools. I kept the text to titles only. the art is WFCD's copy of the in-game decoration icons,
// hotlinked from their CDN like the weapon pictures; if one fails to load it just disappears (FallbackImage)
import { FallbackImage, IMAGE_BASE } from './Thumb'
import { SporkCrest } from './SporkCrest'

export type HomeTarget = 'calculator' | 'leaderboard' | 'compare' | 'rivens' | 'cap' | 'status' | 'about'

// the posters go in the game's school order, each paired with a tool
const POSTERS: { school: string; target: HomeTarget; title: string }[] = [
  { school: 'Madurai', target: 'cap', title: 'Damage Cap' },
  { school: 'Vazarin', target: 'status', title: 'Status Guide' },
  { school: 'Naramon', target: 'calculator', title: 'Calculator' },
  { school: 'Unairu', target: 'compare', title: 'Compare' },
  { school: 'Zenurik', target: 'leaderboard', title: 'Leaderboard' },
]
const NAV: { target: HomeTarget; title: string }[] = [
  { target: 'calculator', title: 'Calculator' },
  { target: 'leaderboard', title: 'Leaderboard' },
  { target: 'compare', title: 'Compare' },
  { target: 'rivens', title: 'Rivens' },
  { target: 'about', title: 'About' },
]

export function Home({ onOpen }: { onOpen: (target: HomeTarget) => void }) {
  return (
    <div className="home">
      <FallbackImage sources={[IMAGE_BASE + 'DuviriDragonDisplayIcon.png']} className="home-backdrop" alt="" />
      <div className="home-shade" aria-hidden="true" />
      <div className="home-content">
        <header className="home-header">
          <span className="home-brand"><SporkCrest size={22} />Verbose Spork</span>
          <nav aria-label="Main">
            {NAV.map((link) => <button key={link.target} onClick={() => onOpen(link.target)}>{link.title}</button>)}
          </nav>
        </header>

        <div className="home-hero">
          <div className="home-crest-row">
            <span className="home-wing" aria-hidden="true" />
            <SporkCrest size={90} />
            <span className="home-wing right" aria-hidden="true" />
          </div>
          <h1 className="home-title">Verbose Spork</h1>
        </div>

        <nav className="home-posters" aria-label="Tools">
          {POSTERS.map((poster) => (
            <button key={poster.school} onClick={() => onOpen(poster.target)}>
              <FallbackImage sources={[IMAGE_BASE + `FocusSchool${poster.school}.png`]} className="home-poster" alt={poster.school} />
              <span>{poster.title}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
