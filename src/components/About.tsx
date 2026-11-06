// About: what the site is, then every algorithm it runs, biggest first, each with its math in dropdowns. the write-ups
// live in src/about/algorithms.ts and are checked against the code they cite (src/about/sync.ts): if that code changed
// since the write-up was last checked, the write-up says so right here. loaded lazily, it carries the source text
import { useMemo } from 'react'
import katex from 'katex'
import { ALGORITHMS, type Algorithm } from '../about/algorithms'
import { fillPlaceholders, sourcesHash } from '../about/sync'
import verified from '../about/verified.json'

// the raw text of every file a write-up can cite, keyed '/src/calc/damage.ts'
const RAW = import.meta.glob(['/src/calc/*.ts', '/src/optimizer/*.ts', '/src/about/*.ts', '/src/components/DataExplorer.tsx', '/src/data/reloads.ts', '/scripts/build-leaderboard.ts', '/scripts/leaderboardFingerprint.ts'],
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const read = (file: string) => RAW[`/${file}`] ?? null
const VERIFIED = verified as Record<string, string>

function TeX({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = useMemo(() => katex.renderToString(fillPlaceholders(tex, read), { displayMode: display, throwOnError: false }), [tex, display])
  return display ? <div className="formula-tex" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />
}

function status(algorithm: Algorithm) {
  const { hash, missing } = sourcesHash(algorithm.sources, read)
  return { current: !missing.length && VERIFIED[algorithm.id] === hash, missing }
}

function AlgorithmCard({ algorithm, index }: { algorithm: Algorithm; index: number }) {
  const { current, missing } = useMemo(() => status(algorithm), [algorithm])
  return (
    <details className="algo">
      <summary>
        <span className="algo-rank">{index + 1}</span>
        <span className="algo-title">{algorithm.title}</span>
        <span className="algo-cost"><TeX tex={algorithm.complexity} /></span>
        <span className={`algo-status ${current ? 'ok' : 'stale'}`}>{current ? '✓ matches code' : '⚠ code changed'}</span>
      </summary>
      <div className="algo-body">
        <p className="muted algo-where">Used on: {algorithm.where}</p>
        {!current && (
          <p className="algo-warning">
            {missing.length ? `Some of the code this describes is gone (${missing.join(', ')}). ` : 'The code this describes changed since this was last checked against it. '}
            The steps below may be out of date.
          </p>
        )}
        <p>{fillPlaceholders(algorithm.summary, read)}</p>
        <ol className="algo-steps">{algorithm.steps.map((step) => <li key={step}>{fillPlaceholders(step, read)}</li>)}</ol>
        {algorithm.equations.map((equation) => (
          <details key={equation.name} className="algo-eq">
            <summary>{equation.name}{equation.complexity && <span className="algo-cost"><TeX tex={equation.complexity} /></span>}</summary>
            <TeX tex={equation.tex} display />
            {equation.note && <p className="muted">{fillPlaceholders(equation.note, read)}</p>}
          </details>
        ))}
        <p className="muted algo-sources">Code: {algorithm.sources.map((source) => (source.symbol ? `${source.file.split('/').pop()} › ${source.symbol}` : source.file.split('/').pop())).join(', ')}</p>
      </div>
    </details>
  )
}

export default function About() {
  const stale = useMemo(() => ALGORITHMS.filter((algorithm) => !status(algorithm).current).length, [])
  return (
    <div className="analysis">
      <section className="panel">
        <h2>About</h2>
        <p>
          A personal tool and project for exploring Warframe's weapon database in a comprehensive way: every weapon, mod, arcane and
          Incarnon evolution run through the game's damage math, optimized, ranked and compared. Weapon and mod data come from
          @wfcd/items, mechanics from the Warframe wiki.
        </p>
      </section>
      <section className="panel">
        <div className="row spread">
          <h2>How it works</h2>
          <span className={`algo-status ${stale ? 'stale' : 'ok'}`}>{stale ? `⚠ ${stale} of ${ALGORITHMS.length} out of date` : `✓ all ${ALGORITHMS.length} match the code`}</span>
        </div>
        <p className="muted">
          Every algorithm the site runs, biggest first. Open one for its steps, then each equation for the math and its time complexity.
          Each write-up is tied to the functions it describes: when that code changes the write-up is flagged here until it's rechecked, and
          numbers like the beam width are read straight out of the code.
        </p>
        <p className="muted">
          Notation: <TeX tex="C" /> = one damage calculation, <TeX tex="T_{opt}" /> = one build optimizer run, <TeX tex="|P|" /> = the mod pool,{' '}
          <TeX tex="S" /> = mod slots, <TeX tex="B" /> = beam width, <TeX tex="T" /> = damage types, <TeX tex="L" /> = mod lines.
        </p>
        <div className="algo-list">{ALGORITHMS.map((algorithm, index) => <AlgorithmCard key={algorithm.id} algorithm={algorithm} index={index} />)}</div>
      </section>
    </div>
  )
}
