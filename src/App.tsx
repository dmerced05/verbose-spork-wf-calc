import { useEffect, useState } from 'react'
import { Calculator, type BuildToLoad } from './Calculator'
import { Leaderboard } from './components/Leaderboard'
import { Compare } from './components/Compare'
import { DamageCap } from './components/DamageCap'
import type { CompareScenario } from './optimizer/compare'
import type { RivenConfig } from './calc/riven'

type Tab = 'calculator' | 'leaderboard' | 'compare' | 'cap'
const TABS: Tab[] = ['calculator', 'leaderboard', 'compare', 'cap']
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
  const [buildToLoad, setBuildToLoad] = useState<BuildToLoad | null>(null)
  // the calculator's setup, so Compare can run against it and reuse its riven
  const [calculatorScenario, setCalculatorScenario] = useState<CompareScenario | null>(null)
  const [calculatorRiven, setCalculatorRiven] = useState<{ weaponId: string; config: RivenConfig } | null>(null)

  // the tab lives in the URL hash so a leaderboard link can be shared and back/forward works
  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const openTab = (next: Tab) => {
    if (next === 'leaderboard') setLeaderboardOpened(true)
    if (next === 'compare') setCompareOpened(true)
    if (next === 'cap') setCapOpened(true)
    setTab(next)
    window.history.replaceState(null, '', next === 'calculator' ? '#' : `#${next}`)
  }

  return (
    <main>
      <header className="app-header">
        <h1>WF Damage Calc</h1>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'calculator'} className={tab === 'calculator' ? 'active' : ''} onClick={() => openTab('calculator')}>
            Calculator
          </button>
          <button role="tab" aria-selected={tab === 'leaderboard'} className={tab === 'leaderboard' ? 'active' : ''} onClick={() => openTab('leaderboard')}>
            Leaderboard
          </button>
          <button role="tab" aria-selected={tab === 'compare'} className={tab === 'compare' ? 'active' : ''} onClick={() => openTab('compare')}>
            Compare
          </button>
          <button role="tab" aria-selected={tab === 'cap'} className={tab === 'cap' ? 'active' : ''} onClick={() => openTab('cap')}>
            Damage Cap
          </button>
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
    </main>
  )
}
