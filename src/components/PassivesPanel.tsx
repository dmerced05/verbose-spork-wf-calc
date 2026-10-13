import { BONUS_ELEMENT_RANGE, BONUS_ELEMENTS, type BonusElement, type WeaponPassive } from '../data/passives'

interface Props {
  passives: WeaponPassive[]
  stacks: Record<string, number> // passive name -> stacks (conditional ones only)
  attackName: string
  showBonusElement: boolean
  bonusElement: BonusElement | null
  onStacksChange: (stacks: Record<string, number>) => void
  onBonusElementChange: (bonusElement: BonusElement | null) => void
}

const toPercent = (fraction: number) => Math.round(fraction * 100)

export function PassivesPanel({ passives, stacks, attackName, showBonusElement, bonusElement, onStacksChange, onBonusElementChange }: Props) {
  const setStacks = (name: string, count: number) => onStacksChange({ ...stacks, [name]: count })

  return (
    <section className="panel passives-panel">
      <h2>Weapon passive</h2>

      {showBonusElement && (
        <div className="passive">
          <div className="row spread">
            <b>Bonus element</b>
            <span className="muted-inline">Kuva / Tenet / Coda: {toPercent(BONUS_ELEMENT_RANGE.min)}-{toPercent(BONUS_ELEMENT_RANGE.max)}% of base damage</span>
          </div>
          <div className="row">
            <select
              value={bonusElement?.damageType ?? ''}
              onChange={(event) =>
                onBonusElementChange(event.target.value ? { damageType: event.target.value, value: bonusElement?.value ?? BONUS_ELEMENT_RANGE.max } : null)}
            >
              <option value="">None</option>
              {BONUS_ELEMENTS.map((damageType) => (
                <option key={damageType} value={damageType}>{damageType}</option>
              ))}
            </select>
            <input
              type="number" min={toPercent(BONUS_ELEMENT_RANGE.min)} max={toPercent(BONUS_ELEMENT_RANGE.max)} disabled={!bonusElement}
              value={toPercent(bonusElement?.value ?? BONUS_ELEMENT_RANGE.max)}
              onChange={(event) =>
                bonusElement &&
                onBonusElementChange({
                  ...bonusElement,
                  value: Math.min(BONUS_ELEMENT_RANGE.max, Math.max(0, Number(event.target.value) / 100)),
                })}
            />
            <span className="muted-inline">%</span>
          </div>
          <p className="proc-note">Counts as an innate element, so it combines after your elemental mods.</p>
        </div>
      )}

      {passives.map((passive) => {
        const applies = !passive.attacks || passive.attacks.test(attackName)
        const maxStacks = passive.maxStacks ?? 1
        const current = stacks[passive.name] ?? 0
        return (
          <div key={passive.name} className={`passive ${applies ? '' : 'inactive'}`}>
            <div className="row spread">
              <b>{passive.name}</b>
              {!applies && <span className="evo-tag">not on this attack</span>}
            </div>
            <p className="passive-quote">“{passive.quote}”</p>
            {passive.condition && (
              <div className="stepper">
                {passive.condition}
                {maxStacks === 1 ? (
                  <input type="checkbox" checked={current > 0} onChange={(event) => setStacks(passive.name, event.target.checked ? 1 : 0)} />
                ) : (
                  <>
                    <button onClick={() => setStacks(passive.name, Math.max(0, current - 1))}>−</button>
                    {current}/{maxStacks}
                    <button onClick={() => setStacks(passive.name, Math.min(maxStacks, current + 1))}>+</button>
                  </>
                )}
              </div>
            )}
            {passive.note && <p className="proc-note">{passive.note}</p>}
          </div>
        )
      })}
    </section>
  )
}
