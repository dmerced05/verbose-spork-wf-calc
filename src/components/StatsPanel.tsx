import type { CalcResult } from '../calc/damage'

const formatNumber = (value: number, digits = 1) => value.toLocaleString(undefined, { maximumFractionDigits: digits })
// big numbers don't need decimals, keeps the proc tables readable
const formatDamage = (value: number) => formatNumber(value, Math.abs(value) >= 100 ? 0 : 1)
// in-game damage numbers are rounded to whole numbers, I show that and keep the exact value on hover
const DamageNumber = ({ value }: { value: number }) => (
  <span title={value.toLocaleString(undefined, { maximumFractionDigits: 3 })}>{Math.round(value).toLocaleString()}</span>
)
const formatPercent = (value: number) => `${formatNumber(value * 100)}%`
const CRIT_TIER_NAMES = ['none', 'yellow', 'orange', 'red']

interface Props {
  result: CalcResult // what the main numbers show (body or head, per the target toggle)
  body: CalcResult
  head: CalcResult
  canHeadshot: boolean
}

export function StatsPanel({ result, body, head, canHeadshot }: Props) {
  // hits are single damage numbers, so they round like in game. shots/DPS are sums, so they keep formatDamage
  const hitRows = new Set(['Normal hit', 'Crit hit', 'Average hit'])
  const headRows: [string, (calc: CalcResult) => number][] = [
    ['Normal hit', (calc) => calc.hit.normal],
    ['Crit hit', (calc) => calc.hit.crit],
    ['Average hit', (calc) => calc.hit.average],
    ['Average shot', (calc) => calc.averageShot],
    ['Burst DPS', (calc) => calc.totalDps],
    ['Sustained DPS', (calc) => calc.sustainedDps],
  ]
  return (
    <section className="panel results">
      <h2>Results</h2>
      <div className="headline">
        <div title="Direct + DoT, with magazine and reload">
          <span className="label">Sustained DPS</span>
          <span className="value">{formatNumber(result.sustainedDps, 0)}</span>
        </div>
        <div title="Direct + DoT while firing nonstop (no reload)">
          <span className="label">Burst DPS</span>
          <span className="value small">{formatNumber(result.totalDps, 0)}</span>
        </div>
        <div title="Damage dealt in the first 10 seconds, reloads included">
          <span className="label">First 10 s</span>
          <span className="value small">{formatNumber(result.damageInWindow(10), 0)}</span>
        </div>
      </div>

      <h3>Headshot vs body <span className="muted-inline">(hits rounded like in-game numbers, hover for exact)</span></h3>
      {canHeadshot ? (
        <>
          <table className="headshot-table">
            <thead>
              <tr><th></th><th>Body</th><th>Head</th><th>×</th></tr>
            </thead>
            <tbody>
              {headRows.map(([label, pick]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{hitRows.has(label) ? <DamageNumber value={pick(body)} /> : formatDamage(pick(body))}</td>
                  <td className="accent">{hitRows.has(label) ? <DamageNumber value={pick(head)} /> : formatDamage(pick(head))}</td>
                  <td className="muted-inline">{pick(body) > 0 ? `${formatNumber(pick(head) / pick(body), 2)}×` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="proc-note">
            Head = ({formatNumber(head.headshot.weakPointMultiplier, 2)}x weak point
            {head.headshot.headshotBonus > 0 ? ` × ${formatNumber(1 + head.headshot.headshotBonus, 2)} headshot bonus` : ''})
            {head.headshot.headcrit ? `, headcrit crit mult ${formatNumber(head.critMultiplier, 2)}x vs ${formatNumber(body.critMultiplier, 2)}x` : ', no headcrit'}
            {head.critChance !== body.critChance ? `, weak point crit chance ${formatPercent(head.critChance)}` : ''}. Gas clouds only get the headshot bonus.
          </p>
        </>
      ) : (
        <p className="muted">This attack is AoE, it can't headshot.</p>
      )}

      <h3>Per projectile vs target{result.headshot.applied ? ' (headshots)' : ''}</h3>
      <table>
        <tbody>
          <tr><td>Normal hit</td><td><DamageNumber value={result.hit.normal} /></td></tr>
          <tr><td>Crit hit ({CRIT_TIER_NAMES[Math.min(result.critTier, 3)]})</td><td><DamageNumber value={result.hit.crit} /></td></tr>
          <tr><td>Average hit</td><td><DamageNumber value={result.hit.average} /></td></tr>
          <tr><td>Average shot (× multishot)</td><td>{formatNumber(result.averageShot)}</td></tr>
        </tbody>
      </table>

      <h3>Modded stats</h3>
      <table>
        <tbody>
          <tr><td>Modded base damage</td><td>{formatNumber(result.moddedBaseDamage)}</td></tr>
          <tr><td>Crit chance</td><td>{formatPercent(result.critChance)}</td></tr>
          <tr><td>Crit multiplier</td><td>{formatNumber(result.critMultiplier, 2)}x</td></tr>
          <tr><td>Status chance</td><td>{formatPercent(result.statusChance)}</td></tr>
          <tr><td>Multishot{result.multishotLocked ? ' (locked by Acuity)' : ''}</td><td>{formatNumber(result.multishot, 2)}</td></tr>
          <tr><td>Fire rate{result.fireRateLocked ? ' (locked by Cannonade)' : ''}</td><td>{formatNumber(result.fireRate, 2)}</td></tr>
          <tr>
            <td>Magazine / reload</td>
            <td>{result.magazineSize ? `${result.magazineSize} / ${formatNumber(result.reloadTime ?? 0, 2)}s` : 'no reload'}</td>
          </tr>
          <tr><td>Time spent firing</td><td>{formatPercent(result.uptime)}</td></tr>
          <tr><td>Direct / DoT DPS (burst)</td><td>{formatNumber(result.burstDps, 0)} / {formatNumber(result.dotDps, 0)}</td></tr>
          <tr><td>Faction multiplier</td><td>{formatNumber(result.factionMultiplier, 2)}x</td></tr>
          <tr><td>Status types for CO ({result.statusTypeSource === 'build' ? 'from build' : 'from debuffs'})</td><td>{result.activeStatusTypes}</td></tr>
          {result.conditionOverload.bonus > 0 && (
            <tr>
              <td>CO-type bonus ({result.conditionOverload.mode === 'multiply' ? 'multiplicative' : 'additive'})</td>
              <td>+{formatPercent(result.conditionOverload.bonus)}</td>
            </tr>
          )}
          <tr>
            <td>Armor</td>
            <td>{formatNumber(result.armor.before, 0)} → {formatNumber(result.armor.after, 0)} ({formatPercent(1 - result.armor.damageMultiplier)} DR)</td>
          </tr>
        </tbody>
      </table>

      <h3>Damage types (per projectile)</h3>
      <table>
        <thead>
          <tr><th>Type</th><th>Modded</th><th>Vs target</th><th>Procs</th></tr>
        </thead>
        <tbody>
          {result.damageTypes.map((row) => (
            <tr key={row.damageType}>
              <td className={`dmg-${row.damageType}`}>{row.damageType}</td>
              <td>{formatNumber(row.modded)}</td>
              <td>{formatNumber(row.vsTarget)}</td>
              <td>{formatPercent(row.procShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {result.dots.length > 0 && (
        <>
          <h3>Status procs ({formatNumber(result.procsPerSecond, 2)}/s total)</h3>
          {result.dots.map((dot) => (
            <div key={dot.damageType} className="proc-card">
              <div className="row spread">
                <span className={`dmg-${dot.damageType} status-name`}>{dot.damageType}</span>
                <span className="muted-inline">{formatNumber(dot.procsPerSecond, 2)} procs/s · {formatNumber(dot.dps, 0)} DPS</span>
              </div>
              <table className="proc-table">
                <thead>
                  <tr><th></th><th>Non-crit</th><th>Crit</th><th>Average</th></tr>
                </thead>
                <tbody>
                  {dot.ticks > 1 && (
                    <tr>
                      <td>Per tick</td>
                      <td>{formatDamage(dot.tick.normal)}</td>
                      <td>{formatDamage(dot.tick.crit)}</td>
                      <td>{formatDamage(dot.tick.average)}</td>
                    </tr>
                  )}
                  <tr>
                    <td>Per proc{dot.ticks > 1 ? ` (${dot.ticks} ticks)` : ''}</td>
                    <td>{formatDamage(dot.perProc.normal)}</td>
                    <td>{formatDamage(dot.perProc.crit)}</td>
                    <td>{formatDamage(dot.perProc.average)}</td>
                  </tr>
                  {dot.aoe && (
                    <tr>
                      <td>{dot.aoe.label}</td>
                      <td>{formatDamage(dot.aoe.damage.normal)}</td>
                      <td>{formatDamage(dot.aoe.damage.crit)}</td>
                      <td>{formatDamage(dot.aoe.damage.average)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="proc-note">{dot.note}</p>
            </div>
          ))}
        </>
      )}

      {result.unparsed.length > 0 && (
        <>
          <h3>Not modeled yet</h3>
          <ul className="unparsed">
            {result.unparsed.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
