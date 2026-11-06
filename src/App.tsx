import { lazy, Suspense, useEffect, useState } from 'react'
import { Calculator, type BuildToLoad } from './Calculator'
import { Leaderboard } from './components/Leaderboard'
import { Compare } from './components/Compare'
import { DamageCap } from './components/DamageCap'
import { CompareWeapons } from './components/CompareWeapons'
import { RivenPage } from './components/RivenPage'
import { StatusGuide } from './components/StatusGuide'
import { AbilityDamagePage } from './components/DataAnalysis'
import { DataExplorer } from './components/DataExplorer'
// About carries the source text its write-ups are checked against, so it's its own chunk
const About = lazy(() => import('./components/About'))
import type { CompareScenario } from './optimizer/compare'
import type { RivenConfig } from './calc/riven'

// pages, grouped into the top tabs. a page id is what goes in the URL hash (#weapons, #abilities...), and a tab with more than one
// page shows them as a second row of subtabs
type Tab = 'calculator' | 'leaderboard' | 'compare' | 'weapons' | 'rivens' | 'cap' | 'abilities' | 'analysis' | 'status' | 'about'
interface Section { id: string; label: string; pages: { id: Tab; label: string }[] }
const SECTIONS: Section[] = [
  { id: 'calculator', label: 'Calculator', pages: [{ id: 'calculator', label: 'Calculator' }] },
  { id: 'leaderboard', label: 'Leaderboard', pages: [{ id: 'leaderboard', label: 'Leaderboard' }] },
  { id: 'compare', label: 'Compare', pages: [{ id: 'compare', label: 'Build Paths' }, { id: 'weapons', label: 'Weapons' }] },
  { id: 'rivens', label: 'Rivens', pages: [{ id: 'rivens', label: 'Rivens' }] },
  { id: 'cap', label: 'Damage Cap', pages: [{ id: 'cap', label: 'Damage Cap' }] },
  // the work-in-progress stuff: numbers here lean on guesses more than the rest of the site
  { id: 'experimental', label: '⚠ Experimental', pages: [{ id: 'abilities', label: 'Ability Damage' }, { id: 'analysis', label: 'Data Analysis' }] },
  { id: 'status', label: 'Status Guide', pages: [{ id: 'status', label: 'Status Guide' }] },
  { id: 'about', label: 'About', pages: [{ id: 'about', label: 'About' }] },
]
const TABS: Tab[] = SECTIONS.flatMap((section) => section.pages.map((page) => page.id))
const sectionOf = (tab: Tab) => SECTIONS.find((section) => section.pages.some((page) => page.id === tab))!
const tabFromHash = (): Tab => {
  if (typeof window === 'undefined') return 'calculator'
  const fromHash = window.location.hash.slice(1) as Tab
  return TABS.includes(fromHash) ? fromHash : 'calculator'
}

export default function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [leaderboardOpened, setLeaderboardOpened] = useState(tab === 'leaderboard') // only fetch the JSON once it's needed
  const [compareOpened, setCompareOpened] = useState(tab === 'compare')
  const [capOpened, setCapOpened] = useState(tab === 'cap')
  const [weaponsOpened, setWeaponsOpened] = useState(tab === 'weapons')
  const [rivensOpened, setRivensOpened] = useState(tab === 'rivens')
  const [abilitiesOpened, setAbilitiesOpened] = useState(tab === 'abilities')
  const [buildToLoad, setBuildToLoad] = useState<BuildToLoad | null>(null)
  // the calculator's setup, so Compare can run against it and reuse its riven
  const [calculatorScenario, setCalculatorScenario] = useState<CompareScenario | null>(null)
  const [calculatorRiven, setCalculatorRiven] = useState<{ weaponId: string; config: RivenConfig } | null>(null)

  // the tab lives in the URL hash so a leaderboard link can be shared and back/forward works
  useEffect(() => {
    const onHashChange = () => {
      const next = tabFromHash()
      // a tab reached by link / back button mounts like a clicked one
      if (next === 'leaderboard') setLeaderboardOpened(true)
      if (next === 'compare') setCompareOpened(true)
      if (next === 'cap') setCapOpened(true)
      if (next === 'weapons') setWeaponsOpened(true)
      if (next === 'rivens') setRivensOpened(true)
      if (next === 'abilities') setAbilitiesOpened(true)
      setTab(next)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const openTab = (next: Tab) => {
    if (next === 'leaderboard') setLeaderboardOpened(true)
    if (next === 'compare') setCompareOpened(true)
    if (next === 'cap') setCapOpened(true)
    if (next === 'weapons') setWeaponsOpened(true)
    if (next === 'rivens') setRivensOpened(true)
    if (next === 'abilities') setAbilitiesOpened(true)
    setTab(next)
    window.history.replaceState(null, '', next === 'calculator' ? '#' : `#${next}`)
  }

  return (
    <main>
      <header className="app-header">
        <h1>Verbose Spork Warframe Analysis</h1>
        <nav className="tabs" role="tablist">
          {SECTIONS.map((section) => {
            const active = sectionOf(tab).id === section.id
            return (
              <button key={section.id} role="tab" aria-selected={active} className={`${active ? 'active' : ''}${section.id === 'experimental' ? ' experimental' : ''}`}
                onClick={() => !active && openTab(section.pages[0].id)}>
                {section.label}
              </button>
            )
          })}
        </nav>
        {sectionOf(tab).pages.length > 1 && (
          <nav className="tabs subtabs" role="tablist">
            {sectionOf(tab).pages.map((page) => (
              <button key={page.id} role="tab" aria-selected={tab === page.id} className={tab === page.id ? 'active' : ''} onClick={() => openTab(page.id)}>
                {page.label}
              </button>
            ))}
          </nav>
        )}
      </header>
      {sectionOf(tab).id === 'experimental' && (
        <p className="experimental-note">⚠ Experimental: these pages are for testing and number-crunching, results may not be accurate.</p>
      )}

      {/* both stay mounted so switching tabs doesn't wipe the calculator setup */}
      <div hidden={tab !== 'calculator'}>
        <Calculator buildToLoad={buildToLoad} onScenarioChange={setCalculatorScenario} onRivenChange={setCalculatorRiven} />
      </div>
      {leaderboardOpened && (
        <div hidden={tab !== 'leaderboard'}>
          <Leaderboard
            onLoadBuild={(entry) => {
              setBuildToLoad({ entry, nonce: Date.now() })
              openTab('calculator')
              window.scrollTo({ top: 0 })
            }}
          />
        </div>
      )}
      {compareOpened && (
        <div hidden={tab !== 'compare'}>
          <Compare
            calculatorScenario={calculatorScenario}
            calculatorRiven={calculatorRiven}
            onLoadBuild={(entry, riven, keepScenario) => {
              setBuildToLoad({ entry, nonce: Date.now(), riven, keepScenario })
              openTab('calculator')
              window.scrollTo({ top: 0 })
            }}
          />
        </div>
      )}
      {weaponsOpened && (
        <div hidden={tab !== 'weapons'}>
          <CompareWeapons />
        </div>
      )}
      {rivensOpened && (
        <div hidden={tab !== 'rivens'}>
          <RivenPage
            calculatorScenario={calculatorScenario}
            onLoadBuild={(entry, riven, keepScenario) => {
              setBuildToLoad({ entry, nonce: Date.now(), riven, keepScenario })
              openTab('calculator')
              window.scrollTo({ top: 0 })
            }}
          />
        </div>
      )}
      {abilitiesOpened && (
        <div hidden={tab !== 'abilities'}>
          <AbilityDamagePage />
        </div>
      )}
      {/* empty for now */}
      {tab === 'analysis' && <div className="analysis"><DataExplorer /></div>}
      {capOpened && (
        <div hidden={tab !== 'cap'}>
          <DamageCap
            calculatorScenario={calculatorScenario}
            calculatorRiven={calculatorRiven}
            onLoadBuild={(entry, riven, setup) => {
              setBuildToLoad({ entry, nonce: Date.now(), riven, keepScenario: true, setup })
              openTab('calculator')
              window.scrollTo({ top: 0 })
            }}
          />
        </div>
      )}
      {/* static text, so it just mounts when shown */}
      {tab === 'status' && <StatusGuide />}
      {/* empty for now */}
      {tab === 'about' && <Suspense fallback={<section className="panel"><p className="muted">Loading…</p></section>}><About /></Suspense>}
    </main>
  )
}
