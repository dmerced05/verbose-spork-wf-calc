// one damaging ability on the Warframe panel: its inputs (battery, seconds channeled...), what one cast does to the
// Calculator's target, and the wiki's scaling notes on hover / in the details
import { useState } from 'react'
import { defaultParams, type AbilityDamageDef } from '../data/abilityDamage'
import { ABILITY_WINDOW, runAbility, type AbilityContext } from '../calc/abilityDamage'

const num = (value: number) => Math.round(value).toLocaleString()

export function AbilityDamageCard({ def, ctx }: { def: AbilityDamageDef; ctx: AbilityContext }) {
  const [params, setParams] = useState<Record<string, number>>(() => defaultParams(def))
  const result = runAbility(def.build(ctx, params), ctx)
  const tooltip = [def.summary, ...def.scaling].join('\n')
  return (
    <div className="ability-damage" title={tooltip}>
      <div className="ability-damage-head">
        <b>{def.name}</b>
        <span className="muted-inline"> · {def.summary}</span>
      </div>
      {def.params?.length ? (
        <div className="row wrap">
          {def.params.map((param) => (
            <label key={param.id} className="inline-number" title={param.title}>
              {param.label}
              {param.options ? (
                <select value={params[param.id]} onChange={(event) => setParams({ ...params, [param.id]: Number(event.target.value) })}>
                  {param.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <input
                  type="number" min={param.min} max={param.max} step={param.step ?? 1} value={params[param.id]}
                  onChange={(event) => setParams({ ...params, [param.id]: Math.min(param.max ?? Infinity, Math.max(param.min ?? -Infinity, Number(event.target.value))) })}
                />
              )}
            </label>
          ))}
        </div>
      ) : null}
      <div className="ability-damage-numbers">
        <span title="One cast on one target, status DoTs included"><b>{num(result.total)}</b> per cast</span>
        <span title={`Damage that lands in the first ${ABILITY_WINDOW} s after casting`}>{num(result.window10)} in {ABILITY_WINDOW} s</span>
        <span title="The biggest single damage instance">{num(result.biggestHit)} biggest hit</span>
      </div>
      <ul className="ability-damage-lines">
        {[...result.lines, ...result.dotLines].map((line) => (
          <li key={line.label}>{line.label}: {num(line.total)}{line.hits > 1 ? ` (${line.hits} hits, first ${num(line.first)})` : ''}</li>
        ))}
        {result.notes.map((note) => <li key={note} className="muted">{note}</li>)}
      </ul>
      <details>
        <summary>How it scales (wiki)</summary>
        <ul>{def.scaling.map((line) => <li key={line}>{line}</li>)}</ul>
      </details>
    </div>
  )
}
