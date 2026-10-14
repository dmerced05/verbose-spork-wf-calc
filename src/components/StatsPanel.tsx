import { SUSTAINED_FIGHT_SECONDS, type CalcResult } from '../calc/damage'

// windows for the damage-over-time table. the Monte Carlo runs all of them in one pass
const RANGE_WINDOWS = [3, 10, 30, SUSTAINED_FIGHT_SECONDS]

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
  // bad luck / good luck: 10th and 90th percentile of 300 simulated fights (crit and status rolled per pellet)
  const ranges = result.simulateWindows(RANGE_WINDOWS)
  const sustainedRange = ranges[RANGE_WINDOWS.indexOf(SUSTAINED_FIGHT_SECONDS)]
  const tenSecondRange = ranges[RANGE_WINDOWS.indexOf(10)]
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
        <div title={`Average DPS over a ${SUSTAINED_FIGHT_SECONDS} s fight: reloads, status ticks as they land, Heat stacking`}>
          <span className="label">Sustained DPS</span>
          <span className="value">{formatNumber(result.sustainedDps, 0)}</span>
          <span className="range">{formatNumber(sustainedRange.low / SUSTAINED_FIGHT_SECONDS, 0)}–{formatNumber(sustainedRange.high / SUSTAINED_FIGHT_SECONDS, 0)}</span>
        </div>
        <div title="Direct + DoT while firing nonstop (no reload)">
          <span className="label">Burst DPS</span>
          <span className="value small">{formatNumber(result.totalDps, 0)}</span>
        </div>
        <div title="Damage dealt in the first 10 seconds, reloads included">
          <span className="label">First 10 s</span>
          <span className="value small">{formatNumber(result.damageInWindow(10), 0)}</span>
          <span className="range">{formatDamage(tenSecondRange.low)}–{formatDamage(tenSecondRange.high)}</span>
        </div>
      </div>

      <h3>Damage over time <span className="muted-inline">(expected, and the 10–90% range from crit/status luck)</span></h3>
      <table className="range-table">
        <thead>
          <tr><th>Window</th><th>Expected</th><th>Bad luck</th><th>Good luck</th><th>Per second</th></tr>
        </thead>
        <tbody>
          {RANGE_WINDOWS.map((seconds, index) => (
            <tr key={seconds}>
              <td>{seconds} s</td>
              <td>{formatDamage(result.damageInWindow(seconds))}</td>
              <td>{formatDamage(ranges[index].low)}</td>
              <td>{formatDamage(ranges[index].high)}</td>
              <td>{formatDamage(result.damageInWindow(seconds) / seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="proc-note">
        Status ticks only count once they land inside the window, so long Status Duration tails don't count past the end. Heat procs refresh
        every Heat stack, so Heat keeps stacking while you keep proccing it. If the target never died (every tick counted, no Heat stacking):
        {' '}{formatNumber(result.steadyStateDps, 0)} DPS.
      </p>
      {result.melee?.heavy && (
        <p className="proc-note">
          DPS here is heavy after heavy at {result.melee.combo}x combo. Each heavy spends the combo (down to {result.melee.comboAfterHeavy}x),
          so in a real fight the time spent rebuilding it isn't counted.
        </p>
      )}

      {result.passives.length > 0 && <p className="proc-note">Passive on: {result.passives.join(', ')}</p>}
      {result.abilities.length > 0 && <p className="proc-note">Abilities on: {result.abilities.join(', ')}</p>}
      {result.detonation && (
        <p className="proc-note">
          Harmony detonation per heavy: <b>{formatDamage(result.detonation.ownProcs + result.detonation.existingStacks)}</b> ({formatDamage(result.detonation.ownProcs)} from
          the heavy's own procs, {formatDamage(result.detonation.existingStacks)} from stacks already on the target). The own-procs part
          is already in the DoT DPS (it just lands at once), the stacks part is extra burst.
        </p>
      )}

      {result.heavyCombo && (
        <>
          <h3>
            Heavy attack, hit by hit{' '}
            <span className="muted-inline">
              (scoring {result.heavyCombo.mode === 'fullCombo' ? 'every hit added up' : 'the biggest hit'}, {result.heavyCombo.combo.source})
            </span>
          </h3>
          <table className="range-table">
            <thead>
              <tr><th>Hit</th><th>Multiplier</th><th>Average hit</th><th>Forced procs</th></tr>
            </thead>
            <tbody>
              {result.heavyCombo.combo.hits.map((hit, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td>{formatNumber(hit.multiplier * 100, 0)}%</td>
                  <td>{formatDamage((result.hit.average * hit.multiplier) / result.heavyCombo!.multiplier)}</td>
                  <td>{[...(hit.procs ?? []).map((proc) => (proc === 'Slash' ? 'Bleed' : proc)), ...(hit.radial ? ['radial'] : [])].join(', ') || '–'}</td>
                </tr>
              ))}
              <tr>
                <td>All</td>
                <td>{formatNumber(result.heavyCombo.combo.hits.reduce((total, hit) => total + hit.multiplier, 0) * 100, 0)}%</td>
                <td>{formatDamage((result.hit.average * result.heavyCombo.combo.hits.reduce((total, hit) => total + hit.multiplier, 0)) / result.heavyCombo.multiplier)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
          <p className="proc-note">Every hit at the current combo, crits averaged. Forced procs are listed, not added to the damage.</p>
        </>
      )}

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
          <tr>
            <td>{result.duplicateStrikes > 1 ? `Average attack (× ${formatNumber(result.duplicateStrikes, 2)} strikes, Melee Duplicate)` : 'Average shot (× multishot)'}</td>
            <td>{formatNumber(result.averageShot)}</td>
          </tr>
          <tr title="Every pellet/strike plus the full DoT of each proc this one attack lands (forced procs included)">
            <td>Whole attack (hit + its procs)</td><td>{formatNumber(result.attackTotal)}</td>
          </tr>
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
          <tr>
            <td>{result.melee ? (result.melee.windUp !== null ? 'Heavy attacks per second' : 'Attack speed') : 'Fire rate'}{result.fireRateLocked ? ' (locked by Cannonade)' : ''}</td>
            <td>{formatNumber(result.fireRate, 2)}</td>
          </tr>
          {result.melee && (
            <>
              <tr><td>Combo multiplier{result.melee.heavy ? ' (heavy damage ×)' : ''}</td><td>{formatNumber(result.melee.combo, 1)}x</td></tr>
              {result.melee.critFromCombo > 0 && (
                <tr><td>Blood Rush / Gladiator crit (mod bonus)</td><td>+{formatPercent(result.melee.critFromCombo)}</td></tr>
              )}
              {result.melee.statusFromCombo > 0 && (
                <tr><td>Weeping Wounds status (mod bonus)</td><td>+{formatPercent(result.melee.statusFromCombo)}</td></tr>
              )}
              {result.melee.windUp !== null && <tr><td>Heavy wind-up</td><td>{formatNumber(result.melee.windUp, 2)}s</td></tr>}
              {result.melee.comboAfterHeavy !== null && (
                <tr><td>Combo left after the heavy</td><td>{formatNumber(result.melee.comboAfterHeavy, 1)}x</td></tr>
              )}
            </>
          )}
          <tr>
            <td>Magazine / reload</td>
            <td>
              {result.magazineSize ? `${result.magazineSize} / ${formatNumber(result.reloadTime ?? 0, 2)}s` : 'no reload'}
              {result.shellByShell && <span className="muted-inline"> (one shell at a time)</span>}
            </td>
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

      {result.setBonuses.length > 0 && (
        <>
          <h3>Mod sets (weapon + Warframe)</h3>
          <ul className="set-bonuses">
            {result.setBonuses.map((set) => <li key={set.set}><b>{set.name} {set.count}/{set.pieces}</b>: {set.text}</li>)}
          </ul>
        </>
      )}

      {/* every conditional the numbers above assume, so nothing reads as free damage */}
      <div className="requirements">
        <h3>This build assumes</h3>
        {result.requirements.length > 0 ? (
          <ul>
            {result.requirements.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : (
          <p>Nothing conditional, these numbers hold on any hit.</p>
        )}
      </div>

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
