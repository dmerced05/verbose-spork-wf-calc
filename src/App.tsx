import { useEffect, useState } from 'react'
import { Calculator, type BuildToLoad } from './Calculator'
import { Leaderboard } from './components/Leaderboard'

type Tab = 'calculator' | 'leaderboard'
const tabFromHash = (): Tab => (typeof window !== 'undefined' && window.location.hash === '#leaderboard' ? 'leaderboard' : 'calculator')

export default function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [leaderboardOpened, setLeaderboardOpened] = useState(tab === 'leaderboard') // only fetch the JSON once it's needed
  const [buildToLoad, setBuildToLoad] = useState<BuildToLoad | null>(null)

  // the tab lives in the URL hash so a leaderboard link can be shared and back/forward works
  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const openTab = (next: Tab) => {
    if (next === 'leaderboard') setLeaderboardOpened(true)
    setTab(next)
    window.history.replaceState(null, '', next === 'leaderboard' ? '#leaderboard' : '#')
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
        </nav>
      </header>

      {/* both stay mounted so switching tabs doesn't wipe the calculator setup */}
      <div hidden={tab !== 'calculator'}>
        <Calculator buildToLoad={buildToLoad} />
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
    </main>
  )
}
