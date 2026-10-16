// the riven's stats, typed in as the game shows them at rank 8. ranges/rolls come from src/calc/riven.ts
import {
  applySplice, availableSplices, fmt, isSpliced, rivenIssues, rivenPool, rivenRange, rivenRoll, spliceRecipes, statName,
  type RivenConfig, type RivenStat, type RivenType,
} from '../calc/riven'

interface Props {
  type: RivenType
  disposition: number
  dots: number | null
  config: RivenConfig
  onChange: (config: RivenConfig) => void
}

const POLARITIES = ['madurai', 'naramon', 'vazarin'] as const

export function RivenEditor({ type, disposition, dots, config, onChange }: Props) {
  const pool = rivenPool(type)
  const nameOf = (tag: string) => statName(pool.find((def) => def.tag === tag)!)
  const unitOf = (tag: string) => {
    const text = pool.find((def) => def.tag === tag)?.text ?? ''
    return text.startsWith('%') || text.includes('Damage to') ? '%' : text.startsWith('s') ? 's' : ''
  }
  const issues = rivenIssues(type, disposition, config)
  const splices = availableSplices(type, config)
  const recipeFor = (tag: string) =>
    spliceRecipes(type).filter(([result]) => result === tag).map(([, a, b]) => `${nameOf(a)} + ${nameOf(b)}`).join(' or ')

  const setStats = (stats: RivenStat[]) => onChange({ ...config, stats })
  // a different stat starts at an average roll of its own range
  const averageFor = (tag: string, negative: boolean, stats: RivenStat[]) => {
    const range = rivenRange(type, disposition, stats, { tag, negative })
    return range ? Number(fmt((range[0] + range[1]) / 2)) : 0
  }
  const changeTag = (index: number, tag: string) =>
    setStats(config.stats.map((stat, other) => (other === index ? { ...stat, tag, value: averageFor(tag, stat.negative, config.stats) } : stat)))
  const updateStat = (index: number, changes: Partial<RivenStat>) => setStats(config.stats.map((stat, other) => (other === index ? { ...stat, ...changes } : stat)))
  const positives = config.stats.filter((stat) => !stat.negative).length
  const negatives = config.stats.length - positives
  // a new row starts on the first stat that isn't on the riven yet, at an average roll
  const addStat = (negative: boolean) => {
    const used = new Set(config.stats.map((stat) => stat.tag))
    const def = pool.find((candidate) => !used.has(candidate.tag) && !isSpliced(type, candidate.tag))!
    const next = [...config.stats, { tag: def.tag, value: 0, negative }]
    setStats(next.map((stat, index) => (index === next.length - 1 ? { ...stat, value: averageFor(def.tag, negative, next) } : stat)))
  }

  return (
    <div className="riven-editor">
      <div className="row spread">
        <b className="riven-title">Riven Mod</b>
        <span className="muted-inline">
          {type} riven · disposition x{disposition}{dots ? ` (${'●'.repeat(dots)}${'○'.repeat(Math.max(0, 5 - dots))})` : ''} · values at rank 8
        </span>
      </div>

      <table className="riven-stats">
        <tbody>
          {config.stats.map((stat, index) => {
            const range = stat.tag ? rivenRange(type, disposition, config.stats, stat) : null
            const roll = stat.tag ? rivenRoll(type, disposition, config.stats, stat) : null
            const outside = range && (stat.value < range[0] - 0.05 || stat.value > range[1] + 0.05)
            return (
              <tr key={index} className={stat.negative ? 'negative' : ''}>
                <td className="riven-sign">{stat.negative ? '−' : '+'}</td>
                <td>
                  <select value={stat.tag} onChange={(event) => changeTag(index, event.target.value)}>
                    {!stat.tag && <option value="">(pick the stat the game rolled)</option>}
                    <optgroup label="Rolled stats">
                      {pool.filter((def) => !isSpliced(type, def.tag)).map((def) => (
                        <option key={def.tag} value={def.tag} disabled={def.tag !== stat.tag && config.stats.some((other) => other.tag === def.tag)}>{statName(def)}</option>
                      ))}
                    </optgroup>
                    {!stat.negative && (
                      <optgroup label="Spliced (Update 44.1)">
                        {pool.filter((def) => isSpliced(type, def.tag)).map((def) => (
                          <option key={def.tag} value={def.tag} disabled={def.tag !== stat.tag && config.stats.some((other) => other.tag === def.tag)}>
                            {statName(def)}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {stat.tag && isSpliced(type, stat.tag) && <div className="muted-inline">spliced from {recipeFor(stat.tag)}</div>}
                </td>
                <td>
                  <input
                    type="number" step="0.1" className={`riven-value ${outside ? 'out-of-range' : ''}`}
                    value={stat.value} onChange={(event) => updateStat(index, { value: Number(event.target.value) })}
                  />
                  {stat.tag && unitOf(stat.tag)}
                </td>
                <td className="muted-inline">
                  {range && (
                    <>
                      <button className="link-button" title="Set to the lowest roll" onClick={() => updateStat(index, { value: Number(fmt(range[0])) })}>{fmt(range[0])}</button>
                      {' to '}
                      <button className="link-button" title="Set to the best roll" onClick={() => updateStat(index, { value: Number(fmt(range[1])) })}>{fmt(range[1])}</button>
                      {roll !== null && <span className={outside ? 'out-of-range' : ''}> · roll {Math.round(roll * 100)}%</span>}
                    </>
                  )}
                </td>
                <td><button className="remove-inline" title="Remove stat" onClick={() => setStats(config.stats.filter((_, other) => other !== index))}>×</button></td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="row">
        <button disabled={positives >= 3} onClick={() => addStat(false)}>+ Positive</button>
        <button disabled={negatives >= 1} onClick={() => addStat(true)}>+ Negative</button>
        <label>
          Polarity
          <select value={config.polarity} onChange={(event) => onChange({ ...config, polarity: event.target.value as RivenConfig['polarity'] })}>
            {POLARITIES.map((polarity) => <option key={polarity} value={polarity}>{polarity}</option>)}
          </select>
        </label>
        <label>
          Drain at rank 8
          <input type="number" min={10} max={18} className="stack-input" value={config.drain}
            onChange={(event) => onChange({ ...config, drain: Math.min(18, Math.max(10, Number(event.target.value))) })} />
        </label>
      </div>

      {splices.length > 0 && (
        <div className="row riven-splice">
          <span className="muted-inline">Splice (Riven Splicer):</span>
          {splices.map((recipe) => (
            <button key={recipe.join()} title="The two traits are consumed, the spliced one keeps the better roll, and a random trait fills the free slot"
              onClick={() => onChange(applySplice(type, disposition, config, recipe))}>
              {nameOf(recipe[1])} + {nameOf(recipe[2])} → {nameOf(recipe[0])}
            </button>
          ))}
        </div>
      )}

      {issues.length > 0 && <ul className="riven-issues">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      <p className="muted-inline">
        Ranges are 90–110% of the stat's base × disposition × the 2/3-positive, ±negative weight (wiki). Rivens are RNG, so they're
        never part of the optimizer or leaderboard.
      </p>
    </div>
  )
}
