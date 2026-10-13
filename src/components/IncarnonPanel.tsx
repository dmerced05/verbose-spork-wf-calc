import { perkAppliesTo, type IncarnonTier } from '../calc/incarnon'

interface Props {
  tiers: IncarnonTier[]
  selection: Record<string, string | null> // tier -> perk name
  stacks: Record<string, number> // perk name -> conditional stacks
  isIncarnonAttack: boolean
  isMelee: boolean
  onSelectionChange: (selection: Record<string, string | null>) => void
  onStacksChange: (stacks: Record<string, number>) => void
}

const MODE_LABEL = { both: '', normal: 'normal fire only', incarnon: 'Incarnon form only' }

export function IncarnonPanel({ tiers, selection, stacks, isIncarnonAttack, isMelee, onSelectionChange, onStacksChange }: Props) {
  const pick = (tier: string, perkName: string) =>
    onSelectionChange({ ...selection, [tier]: selection[tier] === perkName ? null : perkName }) // click again to unpick

  return (
    <section className="panel incarnon-panel">
      <div className="row spread">
        <h2>Incarnon evolutions</h2>
        <span className="muted-inline">Evolution I (Incarnon form) is the Incarnon attack in the weapon panel</span>
      </div>

      {tiers.map(({ tier, perks }) => {
        const picked = perks.find((perk) => perk.name === selection[tier])
        return (
          <div key={tier} className="evo-tier">
            <div className="evo-row">
              <span className="evo-label">Evo {tier}</span>
              <div className="evo-options">
                {perks.map((perk) => {
                  const affectsDamage = perk.statements.some((statement) => statement.effect)
                  return (
                    <button
                      key={perk.name}
                      className={`evo-option ${selection[tier] === perk.name ? 'selected' : ''} ${affectsDamage ? '' : 'utility'}`}
                      title={perk.statements.map((statement) => statement.text).join('\n')}
                      onClick={() => pick(tier, perk.name)}
                    >
                      {perk.name}
                    </button>
                  )
                })}
              </div>
            </div>

            {picked && (
              <div className="evo-detail">
                <ul>
                  {[...new Set(picked.statements.map((statement) => statement.text))].map((text) => {
                    const statement = picked.statements.find((candidate) => candidate.text === text)!
                    const applies = perkAppliesTo(statement.mode, isIncarnonAttack, isMelee)
                    return (
                      <li key={text} className={`${statement.effect ? '' : 'not-modeled'} ${applies ? '' : 'inactive'}`}>
                        {text.replace(/\s*\[(Incarnon Form only|Normal only)\]$/, '')}
                        {statement.mode !== 'both' && <span className="evo-tag">{MODE_LABEL[statement.mode]}</span>}
                        {!statement.effect && <span className="evo-tag">not modeled</span>}
                      </li>
                    )
                  })}
                </ul>
                {picked.maxStacks > 0 && (
                  <div className="stepper">
                    {picked.statements.find((statement) => statement.condition)?.condition}
                    {picked.maxStacks === 1 ? (
                      <input
                        type="checkbox" checked={(stacks[picked.name] ?? 0) > 0}
                        onChange={(event) => onStacksChange({ ...stacks, [picked.name]: event.target.checked ? 1 : 0 })}
                      />
                    ) : (
                      <>
                        <button onClick={() => onStacksChange({ ...stacks, [picked.name]: Math.max(0, (stacks[picked.name] ?? 0) - 1) })}>−</button>
                        {stacks[picked.name] ?? 0}/{picked.maxStacks}
                        <button onClick={() => onStacksChange({ ...stacks, [picked.name]: Math.min(picked.maxStacks, (stacks[picked.name] ?? 0) + 1) })}>+</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
