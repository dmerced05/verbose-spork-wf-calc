// the Calculator's Target drawer as one compact box (design B, "enemy card"): the enemy on a card with live health /
// shields / armor bars, the statuses as click-to-add tiles, the kill numbers on the right, and the other debuffs in one
// row underneath. same settings as TargetPanel + DebuffsPanel + the old Kill details, just packed into one screen
import { Info } from './Tip'
import { FACTIONS, HEAT_ARMOR_STRIP_STAGES, STATUS_EFFECTS, STATUS_TYPES, factionLabel, hasHeadcrits, headMultiplierFor } from '../calc/constants'
import type { CalcResult } from '../calc/damage'
import type { KillEstimate } from '../calc/kill'
import { enemiesById } from '../data'
import type { Buffs, Debuffs, StatusMode, TargetLayer, TargetSettings } from '../types'
import { SearchSelect } from './SearchSelect'
import { AUTO_HEAD, MAX_SLIDER_LEVEL, PRESET_FACTION, TARGET_PRESETS, enemyOptions, type ScaledEnemy } from './TargetPanel'

interface Props {
  target: TargetSettings
  onTargetChange: (target: TargetSettings) => void
  debuffs: Debuffs
  buffs: Buffs
  onDebuffsChange: (debuffs: Debuffs) => void
  onBuffsChange: (buffs: Buffs) => void
  scaled: ScaledEnemy | null
  vsHealth: CalcResult // for the armor after strips
  kill: KillEstimate | null // body
  headKill: KillEstimate | null
  canHeadshot: boolean
}

const toPercent = (fraction: number) => Math.round(fraction * 100)
const UNCAPPED_STACKS = 999 // DoTs have no cap in game, the count just stops somewhere sane
const number = (value: number, digits = 0) => (Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '∞')
const seconds = (value: number) => (Number.isFinite(value) ? `${number(value, value < 10 ? 2 : 1)}s` : 'never')

export function TargetBox({ target, onTargetChange, debuffs, buffs, onDebuffsChange, onBuffsChange, scaled, vsHealth, kill, headKill, canHeadshot }: Props) {
  const update = (changes: Partial<TargetSettings>) => onTargetChange({ ...target, ...changes })
  const updateDebuffs = (changes: Partial<Debuffs>) => onDebuffsChange({ ...debuffs, ...changes })

  const pickEnemy = (enemyId: string | null) => {
    const picked = enemyId ? enemiesById.get(enemyId) : undefined
    const faction = picked ? PRESET_FACTION[picked.faction] ?? picked.faction : target.faction
    update({ enemyId, faction, ...AUTO_HEAD, ...(picked?.baseLevel ? { baseLevel: picked.baseLevel } : {}), ...(picked?.headMultiplier ? { headshotMultiplier: picked.headMultiplier } : {}) })
  }
  const setStacks = (statusType: string, count: number) => {
    const cap = STATUS_EFFECTS[statusType].maxStacks ?? UNCAPPED_STACKS
    const next = Math.min(cap, Math.max(0, count))
    // Ignite strip only exists while Heat is on the target
    const heatArmorStrip = statusType === 'heat' ? (next > 0 ? (debuffs.heatArmorStrip || 0.5) : 0) : debuffs.heatArmorStrip
    updateDebuffs({ stacks: { ...debuffs.stacks, [statusType]: next }, heatArmorStrip })
  }
  const setAll = (useMax: boolean) => updateDebuffs({
    // uncapped DoTs go to 10 on Max all; shift-click a tile to add 10 at a time for Harmony-style detonations
    stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, useMax ? STATUS_EFFECTS[statusType].maxStacks ?? 10 : 0])),
    heatArmorStrip: useMax ? 0.5 : 0,
    liftedOrKnockedDown: useMax,
  })

  const armorBefore = scaled ? scaled.armor : vsHealth.armor.before
  const armorAfter = vsHealth.armor.after
  const dr = 1 - vsHealth.armor.damageMultiplier
  const bar = (fraction: number) => ({ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` })

  return (
    <section className="panel target-box">
      {/* the enemy */}
      <div className="target-card">
        <div className="row spread">
          <h2>Target</h2>
          <label className={`sp-toggle ${target.steelPath ? 'on' : ''}`}>
            <input type="checkbox" checked={target.steelPath} onChange={(event) => update({ steelPath: event.target.checked })} />
            Steel Path
          </label>
        </div>
        <div className="target-pick">
          <SearchSelect options={enemyOptions} selectedId={target.enemyId} onSelect={pickEnemy} placeholder="None (manual armor)" />
          <select value="" aria-label="Steel Path presets" title="One-click Steel Path targets"
            onChange={(event) => { const preset = TARGET_PRESETS.find((one) => one.label === event.target.value); if (preset) update(preset.target) }}>
            <option value="">Presets</option>
            {TARGET_PRESETS.map((preset) => <option key={preset.label} value={preset.label} title={preset.title}>{preset.label}</option>)}
          </select>
        </div>
        {scaled ? (
          <div className="level-row">
            <label htmlFor="level-slider">Lv</label>
            <input id="level-slider" type="range" min={1} max={MAX_SLIDER_LEVEL} value={Math.min(target.level, MAX_SLIDER_LEVEL)} onChange={(event) => update({ level: Number(event.target.value) })} />
            <input type="number" min={1} max={9999} value={target.level} className="level-input" aria-label="Level" onChange={(event) => update({ level: Math.max(1, Number(event.target.value)) })} />
            <label className="muted-inline" title="The level the wiki's stats are for">base <input type="number" min={1} value={target.baseLevel} className="tiny-input" onChange={(event) => update({ baseLevel: Math.max(1, Number(event.target.value)) })} /></label>
            {target.steelPath && <span className="muted-inline">→ {scaled.effectiveLevel}</span>}
          </div>
        ) : (
          <label className="level-row">Armor <input type="number" min={0} value={target.manualArmor} className="level-input" onChange={(event) => update({ manualArmor: Number(event.target.value) })} /></label>
        )}

        {/* the bars: armor shrinks live as Corrosive / Heat / auras go on */}
        <div className="target-bars">
          {scaled && scaled.shield > 0 && (
            <div className="target-bar"><span>Shields</span><span>{number(scaled.shield)}</span><i><b className="bar-shield" style={bar(1)} /></i></div>
          )}
          {scaled && <div className="target-bar"><span>Health</span><span>{number(scaled.health)}</span><i><b className="bar-health" style={bar(1)} /></i></div>}
          <div className="target-bar">
            <span>Armor{armorAfter < armorBefore ? ' after strips' : ''}</span>
            <span>{armorAfter < armorBefore && <>{number(armorBefore)} → </>}{number(armorAfter)} · {number(dr * 100, 1)}% DR</span>
            <i><b className="bar-armor" style={bar(armorBefore > 0 ? armorAfter / armorBefore : 0)} /></i>
          </div>
        </div>

        <div className="target-selects">
          <label>Faction
            <select value={target.faction} onChange={(event) => update({ faction: event.target.value, ...AUTO_HEAD })}>
              {FACTIONS.map((faction) => <option key={faction} value={faction}>{factionLabel(faction)}</option>)}
            </select>
          </label>
          <label>Hitting
            <select value={target.layer} onChange={(event) => update({ layer: event.target.value as TargetLayer })}>
              <option value="health">Health</option><option value="shield">Shields</option><option value="overguard">Overguard</option>
            </select>
          </label>
          <label title="Some enemies take no status at all, others hold at most 4 stacks of each status">Status effects
            <select value={target.statusMode ?? 'normal'} onChange={(event) => update({ statusMode: event.target.value as StatusMode })}>
              <option value="normal">Normal</option><option value="capped">Capped at 4</option><option value="immune">Immune</option>
            </select>
          </label>
        </div>
        <div className="target-checks">
          <label className="inline">
            Head ×
            <input type="number" min={1} step={0.5} className="tiny-input" value={target.headshotMultiplier ?? headMultiplierFor(target.faction)} onChange={(event) => update({ headshotMultiplier: Math.max(1, Number(event.target.value)) })} />
            {target.headshotMultiplier != null && <button className="link-button" onClick={(event) => { event.preventDefault(); update({ headshotMultiplier: null }) }}>auto</button>} <Info>Head multiplier: 3x on most, ~1.5x on Murmur/Techrot. Follows the faction or the enemy until you change it</Info>
          </label>
          <label className="inline" title="Crit headshots double the weapon's base crit multiplier on enemies with headcrit heads">
            <input type="checkbox" checked={target.headcrit ?? hasHeadcrits(target.faction)} onChange={(event) => update({ headcrit: event.target.checked })} />
            Headcrits{target.headcrit == null ? ' (auto)' : ''}
            {target.headcrit != null && <button className="link-button" onClick={(event) => { event.preventDefault(); update({ headcrit: null }) }}>reset</button>}
          </label>
          <label className="inline">
            <input type="checkbox" checked={target.headshot} onChange={(event) => update({ headshot: event.target.checked })} />
            Assume headshots
          </label>
        </div>
      </div>

      {/* statuses: click a tile to add a stack (shift-click: +10), − takes one off */}
      <div className="target-statuses">
        <div className="row spread">
          <span className="muted-inline">Statuses on target · click to add, shift-click +10</span>
          <span className="row">
            <button onClick={() => setAll(true)}>Max all</button>
            <button onClick={() => setAll(false)}>Clear</button>
          </span>
        </div>
        <div className="status-pad">
          {STATUS_TYPES.map((statusType) => {
            const info = STATUS_EFFECTS[statusType]
            const count = debuffs.stacks[statusType] ?? 0
            return (
              <div key={statusType} className={`status-tile ${count > 0 ? 'active' : ''}`}>
                <button className="status-add" title={`${info.effect}. ${info.maxStacks === null ? 'No stack cap' : `Up to ${info.maxStacks} stacks`}`}
                  onClick={(event) => setStacks(statusType, count + (event.shiftKey ? 10 : 1))}>
                  <span className={`dmg-${statusType}`}>{statusType}</span>
                  <span><b>{count}</b><span className="stack-cap">/{info.maxStacks ?? '∞'}</span></span>
                </button>
                <button className="status-remove" aria-label={`Remove a ${statusType} stack`} disabled={count === 0} onClick={() => setStacks(statusType, count - 1)}>−</button>
              </div>
            )
          })}
        </div>
      </div>

      {/* kill numbers */}
      <div className="target-kill">
        {scaled && kill && headKill ? (
          <>
            <div className="row spread">
              <span>vs <span className="accent">{scaled.enemy.name}</span></span>
              <span className="muted-inline">{factionLabel(target.faction)} · Lv {scaled.effectiveLevel}</span>
            </div>
            <table className="kill-table">
              <thead><tr><th></th><th>Body</th>{canHeadshot && <th>Head</th>}</tr></thead>
              <tbody>
                <tr className="kill-main"><td>Shots to kill</td><td>{number(kill.shotsToKill)}{kill.oneShot && <span className="one-shot">1-shot</span>}</td>{canHeadshot && <td>{number(headKill.shotsToKill)}{headKill.oneShot && <span className="one-shot">1-shot</span>}</td>}</tr>
                <tr><td>Time to kill</td><td>{seconds(kill.directTimeToKill)}</td>{canHeadshot && <td>{seconds(headKill.directTimeToKill)}</td>}</tr>
                <tr><td>With DoTs</td><td>{seconds(kill.sustainedTimeToKill)}</td>{canHeadshot && <td>{seconds(headKill.sustainedTimeToKill)}</td>}</tr>
                <tr><td>Avg shot vs health</td><td>{number(kill.healthDamagePerShot, 1)}</td>{canHeadshot && <td>{number(headKill.healthDamagePerShot, 1)}</td>}</tr>
                {scaled.shield > 0 && (
                  <>
                    <tr><td>Avg shot vs shields</td><td>{number(kill.shieldDamagePerShot, 1)}</td>{canHeadshot && <td>{number(headKill.shieldDamagePerShot, 1)}</td>}</tr>
                    <tr><td>Shots to strip shields</td><td>{number(kill.shotsToStripShields)}</td>{canHeadshot && <td>{number(headKill.shotsToStripShields)}</td>}</tr>
                  </>
                )}
                <tr><td>% of health / shot</td><td>{number((kill.healthDamagePerShot / scaled.health) * 100, 1)}%</td>{canHeadshot && <td>{number((headKill.healthDamagePerShot / scaled.health) * 100, 1)}%</td>}</tr>
              </tbody>
            </table>
            <p className="muted">
              {canHeadshot ? '' : 'AoE attacks can\'t headshot. '}Averages, no shield overflow <Info>{'Uses average damage (crits averaged in), no shield overflow into health. "With DoTs" plays the fight out: procs tick as they land, Heat stacks, reloads included. The Damage simulator plays it shot by shot.'}</Info>
            </p>
          </>
        ) : (
          <p className="muted">Pick an enemy for shots and time to kill.</p>
        )}
      </div>

      {/* the rest of the debuffs, one row across the bottom */}
      <div className="target-extras">
        <label>Heat strip
          <select value={debuffs.heatArmorStrip} disabled={(debuffs.stacks.heat ?? 0) === 0} title={(debuffs.stacks.heat ?? 0) === 0 ? 'Needs Heat on the target' : 'Ignite strips armor in steps after the proc'}
            onChange={(event) => updateDebuffs({ heatArmorStrip: Number(event.target.value) })}>
            {HEAT_ARMOR_STRIP_STAGES.map((stage) => <option key={stage} value={stage}>{toPercent(stage)}%</option>)}
          </select>
        </label>
        <label title="Teammates' Corrosive Projection auras, 18% armor each">Corrosive Proj.
          <input type="number" min={0} max={4} value={debuffs.corrosiveProjections} onChange={(event) => updateDebuffs({ corrosiveProjections: Math.min(4, Math.max(0, Number(event.target.value))) })} />
        </label>
        <label>Other strip %
          <input type="number" min={0} max={100} value={toPercent(debuffs.otherArmorReduction)} onChange={(event) => updateDebuffs({ otherArmorReduction: Math.min(100, Math.max(0, Number(event.target.value))) / 100 })} />
        </label>
        <label>Vulnerability %
          <input type="number" min={0} value={toPercent(debuffs.damageVulnerability)} onChange={(event) => updateDebuffs({ damageVulnerability: Math.max(0, Number(event.target.value)) / 100 })} />
        </label>
        <label>Faction buff %
          <input type="number" min={0} value={toPercent(buffs.roar)} onChange={(event) => onBuffsChange({ ...buffs, roar: Math.max(0, Number(event.target.value)) / 100 })} />
        </label>
        {/* companion mod, only works while the companion has 50%+ crit chance */}
        <label>Tenacious Bond
          <select value={Math.round((buffs.tenaciousBond ?? 0) * 5)} onChange={(event) => onBuffsChange({ ...buffs, tenaciousBond: Number(event.target.value) / 5 })}>
            <option value={0}>Off</option>
            {[0, 1, 2, 3, 4, 5].map((rank) => <option key={rank} value={rank + 1}>R{rank} +{((rank + 1) * 0.2).toFixed(1)}x</option>)}
          </select> <Info>Tenacious Bond on your companion: +0.2x per rank to your crit multiplier, flat, if the companion has 50%+ crit chance</Info>
        </label>
        <label>CO / Galvanized counts
          <select value={debuffs.statusTypeSource ?? 'build'} onChange={(event) => updateDebuffs({ statusTypeSource: event.target.value as Debuffs['statusTypeSource'] })}>
            <option value="build">Build's damage types</option>
            <option value="debuffs">Statuses above</option>
          </select> <Info>Condition Overload / Galvanized count status types, not stacks: by default the damage types this build deals, plus lifted/knocked down</Info>
        </label>
        <label className="inline" title="Hidden status, counts as a status type for Condition Overload / Galvanized">
          <input type="checkbox" checked={debuffs.liftedOrKnockedDown} onChange={(event) => updateDebuffs({ liftedOrKnockedDown: event.target.checked })} />
          Lifted / knocked down
        </label>
      </div>
    </section>
  )
}
