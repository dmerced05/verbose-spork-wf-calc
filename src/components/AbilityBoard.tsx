// the Ability Damage board: every modeled damaging ability on the same 300% Strength build and neutral target,
// ranked by one cast (DoTs in) or by what lands in the first 10 s. hover a row for the wiki's scaling notes
import { useMemo, useState } from 'react'
import { ABILITY_DAMAGE, defaultParams } from '../data/abilityDamage'
import { ABILITY_BOARD_DESCRIPTION, ABILITY_WINDOW, neutralAbilityContext, runAbility } from '../calc/abilityDamage'

type Sort = 'total' | 'window' | 'biggest'
const SORTS: { id: Sort; label: string }[] = [
  { id: 'total', label: 'Per cast' },
  { id: 'window', label: `First ${ABILITY_WINDOW} s` },
  { id: 'biggest', label: 'Biggest hit' },
]
const num = (value: number) => Math.round(value).toLocaleString()

export function AbilityBoard() {
  const [sort, setSort] = useState<Sort>('total')
  const rows = useMemo(() => {
    const ctx = neutralAbilityContext()
    return ABILITY_DAMAGE.map((def) => {
      const params = defaultParams(def)
      const result = runAbility(def.build(ctx, params), ctx)
      // the settings it ran with, in the card's words
      const settings = (def.params ?? []).map((param) => `${param.label}: ${param.options?.find((option) => option.value === params[param.id])?.label ?? params[param.id]}`)
      return { def, result, settings }
    })
  }, [])
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
