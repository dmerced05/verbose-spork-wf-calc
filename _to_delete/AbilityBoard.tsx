// the Ability Damage board: every modeled damaging ability on the same 300% Strength build and neutral target,
// ranked by one cast (DoTs in) or by what lands in the first 10 s. hover a row for the wiki's scaling notes
import { useMemo, useState } from 'react'
import { ABILITY_DAMAGE, defaultParams } from '../data/abilityDamage'
import { ABILITY_BOARD_DESCRIPTION, ABILITY_BOARD_STRENGTH, ABILITY_WINDOW, neutralAbilityContext, runAbility } from '../calc/abilityDamage'

type Sort = 'total' | 'window' | 'biggest'
const SORTS: { id: Sort; label: string }[] = [
  { id: 'total', label: 'Per cast' },
  { id: 'window', label: `First ${ABILITY_WINDOW} s` },
  { id: 'biggest', label: 'Biggest hit' },
]
const num = (value: number) => Math.round(value).toLocaleString()
// Roar wiki: "10% / 15% / 25% / 50% bonus damage to all weapons and abilities", "Subsumed Roar's damage bonus is reduced to
// 2% / 9% / 15% / 30%", both x Strength, and DoTs take it twice ("DoT status procs ... all get affected twice")
const ROARS = [
  { value: 0, label: 'No Roar' },
  { value: 0.5 * ABILITY_BOARD_STRENGTH, label: `Rhino's Roar at ${ABILITY_BOARD_STRENGTH * 100}% (+${0.5 * ABILITY_BOARD_STRENGTH * 100}%)` },
  { value: 0.3 * ABILITY_BOARD_STRENGTH, label: `Subsumed Roar at ${ABILITY_BOARD_STRENGTH * 100}% (+${0.3 * ABILITY_BOARD_STRENGTH * 100}%)` },
]

export function AbilityBoard() {
  const [sort, setSort] = useState<Sort>('total')
  const [roar, setRoar] = useState(0)
  const rows = useMemo(() => {
    const ctx = neutralAbilityContext({ roar })
    return ABILITY_DAMAGE.map((def) => {
      const params = defaultParams(def)
      const result = runAbility(def.build(ctx, params), ctx)
      // the settings it ran with, in the card's words
      const settings = (def.params ?? []).map((param) => `${param.label}: ${param.options?.find((option) => option.value === params[param.id])?.label ?? params[param.id]}`)
      return { def, result, settings }
    })
  }, [roar])
  const key = (row: (typeof rows)[number]) => (sort === 'total' ? row.result.total : sort === 'window' ? row.result.window10 : row.result.biggestHit)
  const sorted = [...rows].sort((a, b) => key(b) - key(a))
  return (
    <>
      <div className="leaderboard-settings">
        <label>
          Sort by
          <div className="board-tabs" role="tablist">
            {SORTS.map((option) => (
              <button key={option.id} role="tab" aria-selected={sort === option.id} className={sort === option.id ? 'active' : ''} onClick={() => setSort(option.id)}>
                {option.label}
              </button>
            ))}
          </div>
        </label>
        <label title="Roar is faction damage: once on hits, twice on status ticks. Multiple Roars don't stack">
          Roar
          <select value={roar} onChange={(event) => setRoar(Number(event.target.value))}>
            {ROARS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <p className="board-description">{ABILITY_BOARD_DESCRIPTION}. Set your own Strength, target and settings on the Warframe panel&apos;s ability cards.</p>
      <table className="ability-board">
        <thead>
          <tr><th>#</th><th>Ability</th><th>Per cast</th><th>First {ABILITY_WINDOW} s</th><th>Biggest hit</th><th>Settings</th></tr>
        </thead>
        <tbody>
          {sorted.map(({ def, result, settings }, index) => (
            <tr key={def.id} title={[def.summary, ...def.scaling].join('\n')}>
              <td>{index + 1}</td>
              <td><b>{def.name}</b><div className="muted">{def.warframe}</div></td>
              <td>{num(result.total)}</td>
              <td>{num(result.window10)}</td>
              <td>{num(result.biggestHit)}</td>
              <td className="muted">{[...settings, ...result.notes].join(' · ') || 'none'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
