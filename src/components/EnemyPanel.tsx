import type { CalcResult } from '../calc/damage'
import type { KillEstimate } from '../calc/kill'
import type { ScaledEnemy } from './TargetPanel'
import { factionLabel } from '../calc/constants'

const formatNumber = (value: number, digits = 0) =>
  Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '∞'
const formatSeconds = (seconds: number) => (Number.isFinite(seconds) ? `${formatNumber(seconds, seconds < 10 ? 2 : 1)}s` : 'never')

interface Props {
  scaled: ScaledEnemy
  faction: string
  steelPath: boolean
  vsHealth: CalcResult
  kill: KillEstimate // body shots
  headKill: KillEstimate
  canHeadshot: boolean
}

export function EnemyPanel({ scaled, faction, steelPath, vsHealth, kill, headKill, canHeadshot }: Props) {
  const armorAfter = vsHealth.armor.after
  return (
    <section className="panel enemy-panel">
      <div className="row spread">
        <h2>
          vs <span className="accent">{scaled.enemy.name}</span>
        </h2>
        <span className="muted-inline">
          {factionLabel(faction)} · Lv {scaled.effectiveLevel}{steelPath ? ' · Steel Path' : ''}
        </span>
      </div>

      <div className="enemy-bars">
        {scaled.shield > 0 && (
          <div className="enemy-stat shield"><span className="label">Shields</span><span>{formatNumber(scaled.shield)}</span></div>
        )}
        <div className="enemy-stat health"><span className="label">Health</span><span>{formatNumber(scaled.health)}</span></div>
        <div className="enemy-stat armor">
          <span className="label">Armor</span>
          <span>
            {formatNumber(scaled.armor)}
            {armorAfter < scaled.armor && <> → {formatNumber(armorAfter)}</>}
          </span>
          <span className="sub">{formatNumber((1 - vsHealth.armor.damageMultiplier) * 100, 1)}% DR</span>
        </div>
      </div>

      <table className="kill-table">
        <thead>
          <tr><th></th><th>Body</th>{canHeadshot && <th>Headshots</th>}</tr>
        </thead>
        <tbody>
          <tr className="kill-main">
            <td>Shots to kill</td>
            <td>{formatNumber(kill.shotsToKill)}{kill.oneShot && <span className="one-shot">1-shot</span>}</td>
            {canHeadshot && <td>{formatNumber(headKill.shotsToKill)}{headKill.oneShot && <span className="one-shot">1-shot</span>}</td>}
          </tr>
          <tr>
            <td>Time to kill</td>
            <td>{formatSeconds(kill.directTimeToKill)}</td>
            {canHeadshot && <td>{formatSeconds(headKill.directTimeToKill)}</td>}
          </tr>
          <tr>
            <td>With DoTs</td>
            <td>{formatSeconds(kill.sustainedTimeToKill)}</td>
            {canHeadshot && <td>{formatSeconds(headKill.sustainedTimeToKill)}</td>}
          </tr>
          <tr>
            <td>Avg shot vs health</td>
            <td>{formatNumber(kill.healthDamagePerShot, 1)}</td>
            {canHeadshot && <td>{formatNumber(headKill.healthDamagePerShot, 1)}</td>}
          </tr>
          {scaled.shield > 0 && (
            <>
              <tr>
                <td>Avg shot vs shields</td>
                <td>{formatNumber(kill.shieldDamagePerShot, 1)}</td>
                {canHeadshot && <td>{formatNumber(headKill.shieldDamagePerShot, 1)}</td>}
              </tr>
              <tr>
                <td>Shots to strip shields</td>
                <td>{formatNumber(kill.shotsToStripShields)}</td>
                {canHeadshot && <td>{formatNumber(headKill.shotsToStripShields)}</td>}
              </tr>
            </>
          )}
          <tr>
            <td>% of health per shot</td>
            <td>{formatNumber((kill.healthDamagePerShot / scaled.health) * 100, 1)}%</td>
            {canHeadshot && <td>{formatNumber((headKill.healthDamagePerShot / scaled.health) * 100, 1)}%</td>}
          </tr>
        </tbody>
      </table>

      <p className="muted">
        {canHeadshot ? '' : 'AoE attacks can\'t headshot. '}Uses average damage (crits averaged in), no shield overflow into health. "With DoTs" plays the fight out: procs tick as they land, Heat stacks, reloads included.
      </p>
    </section>
  )
}
