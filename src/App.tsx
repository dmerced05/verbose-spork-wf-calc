import { useEffect, useState } from 'react'
import { Calculator, type BuildToLoad } from './Calculator'
import { Leaderboard } from './components/Leaderboard'
import { Compare } from './components/Compare'
import { DamageCap } from './components/DamageCap'
import { CompareWeapons } from './components/CompareWeapons'
import { RivenPage } from './components/RivenPage'
import { StatusGuide } from './components/StatusGuide'
import type { CompareScenario } from './optimizer/compare'
import type { RivenConfig } from './calc/riven'

type Tab = 'calculator' | 'leaderboard' | 'compare' | 'weapons' | 'rivens' | 'cap' | 'status'
const TABS: Tab[] = ['calculator', 'leaderboard', 'compare', 'weapons', 'rivens', 'cap', 'status']
const TAB_LABELS: Record<Tab, string> = {
  calculator: 'Calculator', leaderboard: 'Leaderboard', compare: 'Compare Build Paths', weapons: 'Compare Weapons', rivens: 'Rivens', cap: 'Damage Cap', status: 'Status Guide',
}
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
    setTab(next)
    window.history.replaceState(null, '', next === 'calculator' ? '#' : `#${next}`)
  }

  return (
    <main>
      <header className="app-header">
        <h1>WF Damage Calc</h1>
        <nav className="tabs" role="tablist">
          {TABS.map((id) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => openTab(id)}>
              {TAB_LABELS[id]}
            </button>
          ))}
        </nav>
      </header>

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
    </main>
  )
}
