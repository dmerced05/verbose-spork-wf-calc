import { HEAT_ARMOR_STRIP_STAGES, STATUS_EFFECTS, STATUS_TYPES } from '../calc/constants'
import type { Buffs, Debuffs } from '../types'

interface Props {
  debuffs: Debuffs
  buffs: Buffs
  onDebuffsChange: (debuffs: Debuffs) => void
  onBuffsChange: (buffs: Buffs) => void
}

const toPercent = (fraction: number) => Math.round(fraction * 100)

export function DebuffsPanel({ debuffs, buffs, onDebuffsChange, onBuffsChange }: Props) {
  const update = (changes: Partial<Debuffs>) => onDebuffsChange({ ...debuffs, ...changes })
  const setStacks = (statusType: string, count: number) => {
    const nextStacks = { ...debuffs.stacks, [statusType]: count }
    // Ignite strip only exists while Heat is on the target
    const heatArmorStrip = statusType === 'heat' ? (count > 0 ? 0.5 : 0) : debuffs.heatArmorStrip
    update({ stacks: nextStacks, heatArmorStrip })
  }
  const setAll = (useMax: boolean) =>
    update({
      stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, useMax ? STATUS_EFFECTS[statusType].maxStacks ?? 1 : 0])),
      heatArmorStrip: useMax ? 0.5 : 0,
      liftedOrKnockedDown: useMax,
    })

  return (
    <section className="panel">
      <div className="row spread">
        <h2>Debuffs on target</h2>
        <div className="row">
          <button onClick={() => setAll(true)}>Max all</button>
          <button onClick={() => setAll(false)}>Clear</button>
        </div>
      </div>

      <div className="status-grid">
        {STATUS_TYPES.map((statusType) => {
          const info = STATUS_EFFECTS[statusType]
          const count = debuffs.stacks[statusType] ?? 0
          return (
            <div key={statusType} className={`status ${count > 0 ? 'active' : ''}`} title={info.effect}>
              <span className={`dmg-${statusType} status-name`}>{statusType}</span>
              {info.maxStacks === null ? (
                <input type="checkbox" checked={count > 0} onChange={(event) => setStacks(statusType, event.target.checked ? 1 : 0)} />
              ) : (
                <input
                  type="number" min={0} max={info.maxStacks} value={count}
                  onChange={(event) => setStacks(statusType, Math.min(info.maxStacks!, Math.max(0, Number(event.target.value))))}
                />
              )}
              <span className="status-effect">{info.effect}</span>
            </div>
          )
        })}
      </div>

      <div className="form-grid">
        <label title="What Condition Overload / Galvanized count as status types on the target">
          CO / Galvanized status types
          <select
            value={debuffs.statusTypeSource ?? 'build'}
            onChange={(event) => update({ statusTypeSource: event.target.value as Debuffs['statusTypeSource'] })}
          >
            <option value="build">This build's damage types</option>
            <option value="debuffs">Statuses set above</option>
          </select>
        </label>
        <label className="inline" title="Hidden status, counts as a status type for Condition Overload / Galvanized">
          <input type="checkbox" checked={debuffs.liftedOrKnockedDown} onChange={(event) => update({ liftedOrKnockedDown: event.target.checked })} />
          Lifted / knocked down
        </label>
        <label>
          Heat armor strip
          <select
            value={debuffs.heatArmorStrip}
            disabled={(debuffs.stacks.heat ?? 0) === 0}
            onChange={(event) => update({ heatArmorStrip: Number(event.target.value) })}
          >
            {HEAT_ARMOR_STRIP_STAGES.map((stage) => (
              <option key={stage} value={stage}>{toPercent(stage)}%</option>
            ))}
          </select>
        </label>
        <label>
          Corrosive Projection auras
          <input
            type="number" min={0} max={4} value={debuffs.corrosiveProjections}
            onChange={(event) => update({ corrosiveProjections: Math.min(4, Math.max(0, Number(event.target.value))) })}
          />
        </label>
        <label>
          Other armor strip %
          <input
            type="number" min={0} max={100} value={toPercent(debuffs.otherArmorReduction)}
            onChange={(event) => update({ otherArmorReduction: Math.min(100, Math.max(0, Number(event.target.value))) / 100 })}
          />
        </label>
        <label>
          Extra damage vulnerability %
          <input
            type="number" min={0} value={toPercent(debuffs.damageVulnerability)}
            onChange={(event) => update({ damageVulnerability: Math.max(0, Number(event.target.value)) / 100 })}
          />
        </label>
        <label>
          Roar / faction buff %
          <input
            type="number" min={0} value={toPercent(buffs.roar)}
            onChange={(event) => onBuffsChange({ roar: Math.max(0, Number(event.target.value)) / 100 })}
          />
        </label>
      </div>
      <p className="muted">
        Condition Overload / Galvanized count status types, not stacks. By default that's the damage types this build
        deals (base physical + modded elements), plus lifted/knocked down. Switch to "Statuses set above" to use the stacks here instead. Armor strips multiply together:
        (1 − heat) × (1 − corrosive) × (1 − 18% × auras) × (1 − other).
      </p>
    </section>
  )
}
