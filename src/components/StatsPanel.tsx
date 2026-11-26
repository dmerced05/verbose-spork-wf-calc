import { Info as InfoTip } from './Tip'
import { SUSTAINED_FIGHT_SECONDS, type CalcResult } from '../calc/damage'
import { INT_LIMIT, onScreen } from '../calc/damageCap'
import type { KillEstimate } from '../calc/kill'
import { useState, type ReactNode } from 'react'

// windows for the damage-over-time table. the Monte Carlo runs all of them in one pass
const RANGE_WINDOWS = [...new Set([3, 10, 30, SUSTAINED_FIGHT_SECONDS])]

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
  arsenal: CalcResult // mods' always-on stats only, like the in-game arsenal
  unmodded: CalcResult // no mods, no arcane
  canHeadshot: boolean
  bodyKill?: KillEstimate | null // shots / time to kill, when a target with health is picked
  headKill?: KillEstimate | null
}

const totalDamage = (calc: CalcResult) => sum(calc.damageTypes.map((row) => row.modded))
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

// one stat across the three columns. in-fight gets highlighted when the fight changes it (conditionals, buffs, combo)
function StatRow({ label, title, values, format }: { label: string; title?: string; values: [number | null, number | null, number | null]; format: (value: number) => string }) {
  const [unmodded, arsenal, fight] = values
  const cell = (value: number | null) => (value === null ? '–' : format(value))
  const changed = fight !== null && arsenal !== null && format(fight) !== format(arsenal)
  return (
    <tr title={title}>
      <td>{label}</td>
      <td className="muted-inline">{cell(unmodded)}</td>
      <td>{cell(arsenal)}</td>
      <td className={changed ? 'accent' : ''}>{cell(fight)}</td>
    </tr>
  )
}

// kill numbers read the same as the results bar's
const whole = (value: number) => (Number.isFinite(value) ? Math.round(value).toLocaleString() : '∞')
const seconds = (value: number) => (!Number.isFinite(value) ? 'never' : value < 10 ? `${value.toFixed(2)}s` : `${Math.round(value).toLocaleString()}s`)

// the long explanations live behind this, on hover (and for screen readers)
const Info = ({ text }: { text: string }) => <InfoTip label={text} wide={false}>{text}</InfoTip>

// one line in the key stats column. a breakdown, if given, pops up on hover/focus like PoB's Calcs tab
function KeyStat({ label, value, sub, main, gold, breakdown }: { label: string; value: ReactNode; sub?: ReactNode; main?: boolean; gold?: boolean; breakdown?: [string, string][] }) {
  return (
    <div className={`key-stat${main ? ' main' : ''}${breakdown ? ' has-breakdown' : ''}`} tabIndex={breakdown ? 0 : undefined}>
      <span className="key-label">{label}</span>
      <span className={`key-value${gold || main ? ' accent' : ''}`}>{value}</span>
      {sub && <span className="key-sub">{sub}</span>}
      {breakdown && (
        <span className="key-breakdown" role="tooltip">
          {breakdown.map(([name, amount], index) => (
            <span key={name} className={index === breakdown.length - 1 ? 'total' : ''}><span>{name}</span><span>{amount}</span></span>
          ))}
        </span>
      )}
    </div>
  )
}

// a foldable box. which ones you folded is remembered in this browser
const FOLDED_KEY = 'wf-results-folded'
const readFolded = (): string[] => { try { return JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]') } catch { return [] } }
function Box({ id, title, note, children, wide }: { id: string; title: ReactNode; note?: string; children: ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(() => !readFolded().includes(id))
  const toggle = (next: boolean) => {
    setOpen(next)
    try {
      const folded = new Set(readFolded())
      if (next) folded.delete(id); else folded.add(id)
      localStorage.setItem(FOLDED_KEY, JSON.stringify([...folded]))
    } catch { /* private window: just don't remember */ }
  }
  return (
    <details className={`result-box${wide ? ' wide' : ''}`} open={open} onToggle={(event) => toggle(event.currentTarget.open)}>
      <summary><h3>{title}</h3>{note && <Info text={note} />}</summary>
      <div className="result-box-body">{children}</div>
    </details>
  )
}

export function StatsPanel({ result, body, head, arsenal, unmodded, canHeadshot, bodyKill, headKill }: Props) {
  // bad luck / good luck: 10th and 90th percentile of 300 simulated fights (crit and status rolled per pellet)
  const ranges = result.simulateWindows(RANGE_WINDOWS)
  const sustainedRange = ranges[RANGE_WINDOWS.indexOf(SUSTAINED_FIGHT_SECONDS)]
  const tenSecondRange = ranges[RANGE_WINDOWS.indexOf(10)]
  const onHead = result.headshot.applied
  // hits are single damage numbers, so they round like in game. shots/DPS are sums, so they keep formatDamage
  const hitRows: [string, (calc: CalcResult) => number, boolean, string?][] = [
    ['Normal hit', (calc) => calc.hit.normal, true],
    [`Crit hit (${CRIT_TIER_NAMES[Math.min(result.critTier, 3)]})`, (calc) => calc.hit.crit, true],
    [`Average hit${result.beam && result.beamMerge > 1 ? ' (one beam)' : ''}`, (calc) => calc.hit.average, true],
    ...(result.beam && result.beamMerge > 1
      ? [[`Merged tick (× ${formatNumber(result.beamMerge, 2)} beams)`, (calc: CalcResult) => calc.hit.average * calc.beamMerge, false,
        'Wiki Multishot: extra beams on one target merge into one damage tick with the summed damage and status chance. This is the one instance the target takes'] as [string, (calc: CalcResult) => number, boolean, string]]
      : []),
    [result.duplicateStrikes > 1 ? `Average attack (× ${formatNumber(result.duplicateStrikes, 2)} strikes)` : 'Average shot (× multishot)', (calc) => calc.averageShot, false],
    ['Whole attack + its procs', (calc) => calc.attackTotal, false, 'Every pellet/strike plus the full DoT of each proc this one attack lands (forced procs included)'],
    ['Biggest single instance', (calc) => calc.peakHit, false, 'Top crit tier (or a Devouring Attrition non-crit), one instance. Past 2,147,483,647 the number on screen shows as -2,147,483,648, see the Damage Cap tab'],
    ['Burst DPS', (calc) => calc.totalDps, false],
    ['Sustained DPS', (calc) => calc.sustainedDps, false],
  ]
  const rateLabel = `${result.melee ? (result.melee.windUp !== null ? 'Heavy attacks per second' : 'Attack speed') : 'Fire rate'}${result.fireRateLocked ? ' (locked by Cannonade)' : ''}`
  const other = onHead ? body : head
  const overTimeNote = 'Bad / good luck = 10th and 90th percentile of 300 simulated fights, crit and status rolled per pellet. Status ticks only count once they land inside the window, '
    + 'so long Status Duration tails don\'t count past the end. Heat procs refresh every Heat stack, so Heat keeps stacking while you keep proccing it.'
  const totalProcShare = sum(result.damageTypes.map((row) => row.procShare)) || 1

  return (
    <section className="panel results">
      <h2>Results</h2>
      <div className="results-layout">
        <aside className="key-stats" aria-label="Key stats">
          <div className="key-group">
            <span className="key-group-title">Damage{onHead ? ' (headshots)' : ''}</span>
            <KeyStat label="Sustained DPS" main value={formatNumber(result.sustainedDps, 0)}
              sub={`10–90% luck ${formatNumber(sustainedRange.low / SUSTAINED_FIGHT_SECONDS, 0)}–${formatNumber(sustainedRange.high / SUSTAINED_FIGHT_SECONDS, 0)}`}
              breakdown={[
                ['Burst DPS', formatNumber(result.totalDps, 0)],
                ['× time spent firing', formatPercent(result.uptime)],
                ['Heat stacking, DoT timing', `${SUSTAINED_FIGHT_SECONDS} s fight`],
                ['Sustained DPS', formatNumber(result.sustainedDps, 0)],
              ]} />
            <KeyStat label="Burst DPS" value={formatNumber(result.totalDps, 0)}
              breakdown={[
                [result.duplicateStrikes > 1 ? 'Average attack' : 'Average shot', formatNumber(result.averageShot)],
                [`× ${rateLabel.toLowerCase()}`, formatNumber(result.fireRate, 2)],
                ['= direct DPS', formatNumber(result.burstDps, 0)],
                ['+ DoT DPS', formatNumber(result.dotDps, 0)],
                ['Burst DPS', formatNumber(result.totalDps, 0)],
              ]} />
            <KeyStat label="First 10 s" value={formatDamage(result.damageInWindow(10))} sub={`${formatDamage(tenSecondRange.low)}–${formatDamage(tenSecondRange.high)}`} />
            {canHeadshot && <KeyStat label={onHead ? 'Sustained, body shots' : 'Sustained, headshots'} value={formatNumber(other.sustainedDps, 0)} sub={`${formatNumber(other.sustainedDps / Math.max(1e-9, result.sustainedDps), 2)}× this`} />}
          </div>
          <div className="key-group">
            <span className="key-group-title">Per hit</span>
            <KeyStat label="Average hit" value={<DamageNumber value={result.hit.average} />} />
            <KeyStat label={`Crit hit (${CRIT_TIER_NAMES[Math.min(result.critTier, 3)]})`} value={<DamageNumber value={result.hit.crit} />} />
            <KeyStat label="Biggest instance" value={formatNumber(result.peakHit)} sub={result.peakHit > INT_LIMIT ? `on screen ${onScreen(result.peakHit).toLocaleString()}` : undefined} />
            <KeyStat label="Whole attack + procs" value={formatNumber(result.attackTotal)} />
          </div>
          <div className="key-group">
            <span className="key-group-title">Stats in the fight</span>
            <KeyStat label="Crit chance" value={formatPercent(result.critChance)} />
            <KeyStat label="Crit multiplier" value={`${formatNumber(result.critMultiplier, 2)}x`} />
            {result.doughty && <KeyStat label="· Puncture part (Doughty)" gold value={`${formatNumber(result.doughty.punctureCritMultiplier, 2)}x`} />}
            {/* weak point crit (Acuity, King's Gambit) and headcrit only show up on the head */}
            {canHeadshot && <KeyStat label="Headshot crit chance" value={formatPercent(head.critChance)} />}
            {canHeadshot && <KeyStat label="Headshot crit multiplier" value={`${formatNumber(head.critMultiplier, 2)}x`} />}
            <KeyStat label={`Status chance${result.beam && result.beamMerge > 1 ? ' (per beam)' : ''}`} value={formatPercent(result.statusChance)} />
            <KeyStat label="Multishot" value={formatNumber(result.multishot, 2)} />
            <KeyStat label={rateLabel} value={formatNumber(result.fireRate, 2)} />
            {result.magazineSize !== null && <KeyStat label="Magazine · reload" value={`${formatNumber(result.magazineSize, 0)} · ${formatNumber(result.reloadTime ?? 0, 2)}s`} />}
          </div>
          <div className="key-group">
            <span className="key-group-title">Vs target</span>
            <KeyStat label="Armor" value={`${formatNumber(result.armor.after, 0)} · ${formatPercent(1 - result.armor.damageMultiplier)} DR`} />
            <KeyStat label="Faction multiplier" value={`${formatNumber(result.factionMultiplier, 2)}x`} />
            {bodyKill && (
              <>
                <KeyStat label="Shots to kill" value={whole(bodyKill.shotsToKill)} sub={canHeadshot && headKill ? `head ${whole(headKill.shotsToKill)}` : undefined} />
                <KeyStat label="Time to kill" value={seconds(bodyKill.sustainedTimeToKill)} sub={canHeadshot && headKill ? `head ${seconds(headKill.sustainedTimeToKill)}` : undefined} />
              </>
            )}
          </div>
        </aside>

        <div className="result-boxes">
          {/* every conditional the numbers assume, first, so nothing reads as free damage */}
          <div className="requirements wide">
            <h3>This build assumes{result.requirements.length > 0 ? ` (${result.requirements.length})` : ''}</h3>
            {result.requirements.length > 0 ? (
              <ul>{result.requirements.map((line) => <li key={line}>{line}</li>)}</ul>
            ) : (
              <p>Nothing conditional, these numbers hold on any hit.</p>
            )}
            {result.unparsed.length > 0 && (
              <>
                <h3 className="unparsed-title">Not modeled yet</h3>
                <ul className="unparsed">{result.unparsed.map((line) => <li key={line}>{line}</li>)}</ul>
              </>
            )}
          </div>

          <Box id="hits" title={canHeadshot ? 'Per hit, body vs head' : 'Per hit'}
            note={canHeadshot ? 'Hits rounded like in-game numbers, hover them for the exact value. Gas clouds only get the headshot bonus.' : undefined}>
            <table className="compact-table">
              {canHeadshot && <thead><tr><th></th><th>Body</th><th>Head</th><th>×</th></tr></thead>}
              <tbody>
                {hitRows.map(([label, pick, isHit, title]) => {
                  const cell = (calc: CalcResult) => (isHit ? <DamageNumber value={pick(calc)} /> : formatDamage(pick(calc)))
                  return (
                    <tr key={label} title={title}>
                      <td>{label}</td>
                      {canHeadshot ? (
                        <>
                          <td>{cell(body)}</td>
                          <td className="accent">{cell(head)}</td>
                          <td className="muted-inline">{pick(body) > 0 ? `${formatNumber(pick(head) / pick(body), 2)}×` : '–'}</td>
                        </>
                      ) : <td>{cell(result)}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {canHeadshot ? (
              <p className="proc-note">
                Head = {formatNumber(head.headshot.weakPointMultiplier, 2)}x weak point
                {head.headshot.headshotBonus > 0 ? ` × ${formatNumber(1 + head.headshot.headshotBonus, 2)} headshot bonus` : ''}
                {head.headshot.headcrit ? ` · headcrit ${formatNumber(head.critMultiplier, 2)}x vs ${formatNumber(body.critMultiplier, 2)}x` : ' · no headcrit'}
                {head.critChance !== body.critChance ? ` · weak point crit ${formatPercent(head.critChance)}` : ''}
              </p>
            ) : <p className="proc-note">This attack is AoE, it can't headshot.</p>}
          </Box>

          <Box id="overtime" title="Over time" note={overTimeNote}>
            <table className="compact-table">
              <thead><tr><th>Window</th><th>Expected</th><th>Bad luck</th><th>Good luck</th><th>Per s</th></tr></thead>
              <tbody>
                {RANGE_WINDOWS.map((windowSeconds, index) => (
                  <tr key={windowSeconds}>
                    <td>{windowSeconds} s</td>
                    <td className={windowSeconds === 10 ? 'accent' : ''}>{formatDamage(result.damageInWindow(windowSeconds))}</td>
                    <td className="muted-inline">{formatDamage(ranges[index].low)}</td>
                    <td className="muted-inline">{formatDamage(ranges[index].high)}</td>
                    <td>{formatDamage(result.damageInWindow(windowSeconds) / windowSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="proc-note">
              Target never dying (every tick counted, no Heat stacking): {formatNumber(result.steadyStateDps, 0)} DPS
              {result.melee?.heavy ? ` · heavy after heavy at ${result.melee.combo}x combo, each heavy spends it down to ${result.melee.comboAfterHeavy}x and rebuilding isn't counted` : ''}
            </p>
          </Box>

          {result.heavyCombo && (
            <Box id="heavy" title="Heavy attack, hit by hit"
              note={`Scoring ${result.heavyCombo.mode === 'fullCombo' ? 'every hit added up' : 'the biggest hit'} (${result.heavyCombo.combo.source}). Every hit at the current combo, crits averaged. Forced procs are listed, not added to the damage.`}>
              <table className="compact-table">
                <thead><tr><th>Hit</th><th>Multiplier</th><th>Average hit</th><th>Forced procs</th></tr></thead>
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
            </Box>
          )}

          <Box id="stats" title="Stats: no mods → arsenal → fight"
            note="Arsenal = what the in-game arsenal shows: the mods' always-on stats, no On Kill / On Status stacks, abilities, combo or Condition Overload. Fight = arsenal plus every conditional, buff and combo the build assumes. Gold = the fight changes it.">
            <table className="compact-table stat-compare">
              <thead><tr><th></th><th>No mods</th><th>Arsenal</th><th>Fight</th></tr></thead>
              <tbody>
                <StatRow label="Damage (all types)" title="Every damage type added up, per pellet, no crit. This is the arsenal's damage number" values={[totalDamage(unmodded), totalDamage(arsenal), totalDamage(result)]} format={(value) => formatNumber(value)} />
                <StatRow label="Crit chance" values={[unmodded.critChance, arsenal.critChance, result.critChance]} format={formatPercent} />
                <StatRow label="Crit multiplier" values={[unmodded.critMultiplier, arsenal.critMultiplier, result.critMultiplier]} format={(value) => `${formatNumber(value, 2)}x`} />
                {result.doughty && (
                  <StatRow
                    label="· Puncture part (Doughty)"
                    title={`Melee Doughty: ${formatPercent(result.doughty.punctureStatusChance)} Puncture status chance gives +${formatNumber(result.doughty.bonus, 1)}x, on the Puncture part of the hit only. The rest of the hit crits at the multiplier above`}
                    values={[null, null, result.doughty.punctureCritMultiplier]} format={(value) => `${formatNumber(value, 2)}x`}
                  />
                )}
                <StatRow label={`Status chance${result.beam && result.beamMerge > 1 ? ' (per beam)' : ''}`} values={[unmodded.statusChance, arsenal.statusChance, result.statusChance]} format={formatPercent} />
                <StatRow label="Multishot" values={[unmodded.multishot, arsenal.multishot, result.multishot]} format={(value) => formatNumber(value, 2)} />
                <StatRow label={rateLabel} values={[unmodded.fireRate, arsenal.fireRate, result.fireRate]} format={(value) => formatNumber(value, 2)} />
                {result.magazineSize !== null && (
                  <>
                    <StatRow label="Magazine" values={[unmodded.magazineSize, arsenal.magazineSize, result.magazineSize]} format={(value) => formatNumber(value, 0)} />
                    <StatRow label={`Reload${result.shellByShell ? ' (one shell at a time)' : ''}`} values={[unmodded.reloadTime, arsenal.reloadTime, result.reloadTime]} format={(value) => `${formatNumber(value, 2)}s`} />
                  </>
                )}
              </tbody>
            </table>
          </Box>

          {result.battery && (
            <Box id="battery" title="Incarnon battery" note="One full form, crits averaged, DoTs included.">
              <table className="compact-table">
                <tbody>
                  <tr><td>Rounds</td><td>{formatNumber(result.battery.rounds, 0)} ({formatNumber(result.battery.shots, 1)} shots)</td></tr>
                  <tr title="Every shot in the battery at this fire rate"><td>Time to fire it all</td><td>{formatNumber(result.battery.seconds, 2)}s</td></tr>
                  <tr title="Every shot's damage plus the full DoT of its procs"><td>Damage per battery</td><td>{formatNumber(result.battery.damage, 0)}</td></tr>
                  <tr><td>Damage per second while it lasts</td><td>{formatNumber(result.battery.damage / Math.max(1e-9, result.battery.seconds), 0)}</td></tr>
                  {result.battery.refillSeconds !== null && (
                    <tr title="Weak point (or direct) hits with the normal form, every shot counting, plus one reload to switch back in (dropping out when the battery runs out is free). Real refills depend on your aim">
                      <td>Refill (best case)</td><td>{formatNumber(result.battery.refillSeconds, 2)}s</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Box>
          )}

          <Box id="types" title="Damage types, per pellet"
            note={`The arsenal's damage is every type added up. Modded base damage (${formatNumber(result.moddedBaseDamage)}) is a different number: base × (1 + damage mods like Serration), before elements. Elemental mods are a % of that, so it's what Hellfire's +90% is +90% of.`}>
            <table className="compact-table">
              <thead><tr><th>Type</th><th>No mods</th><th>Arsenal</th><th>Fight</th><th>Vs target</th><th title="Chance per pellet to proc this type: each type's share of the status weighting × status chance, so the column adds up to the status chance">Status weight</th></tr></thead>
              <tbody>
                {result.damageTypes.map((row) => {
                  const inArsenal = arsenal.damageTypes.find((other) => other.damageType === row.damageType)
                  const inBase = unmodded.damageTypes.find((other) => other.damageType === row.damageType)
                  return (
                    <tr key={row.damageType}>
                      <td className={`dmg-${row.damageType}`}>{row.damageType}</td>
                      <td className="muted-inline">{inBase ? formatNumber(inBase.modded) : '–'}</td>
                      <td>{inArsenal ? formatNumber(inArsenal.modded) : '–'}</td>
                      <td className={inArsenal && formatNumber(inArsenal.modded) === formatNumber(row.modded) ? '' : 'accent'}>{formatNumber(row.modded)}</td>
                      <td>{formatNumber(row.vsTarget)}</td>
                      <td>
                        <span className="share-bar" aria-hidden="true"><span className={`dmg-bg-${row.damageType}`} style={{ width: `${(row.procShare / totalProcShare) * 100}%` }} /></span>
                        {formatPercent((row.procShare / totalProcShare) * result.statusChance)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Box>

          <Box id="fight" title="Fight details">
            <table className="compact-table">
              <tbody>
                <tr><td>Modded base damage (before elements)</td><td>{formatNumber(result.moddedBaseDamage)}</td></tr>
                {result.beam && result.beamMerge > 1 && (
                  <tr title="The merged tick rolls the summed status chance: past 100% it's guaranteed procs plus a chance at one more. Same proc count as separate beams, but each damaging proc (Slash, Heat, Toxin, Electricity, Blast, Gas) comes off the bigger merged tick">
                    <td>Status per merged tick</td><td>{formatPercent(result.statusChance * result.beamMerge)} ({formatNumber(result.statusChance * result.beamMerge, 2)} procs)</td>
                  </tr>
                )}
                {(result.multishotLocked || result.multishotModsIgnored || result.beam) && (
                  <tr>
                    <td>Multishot</td>
                    <td title={result.beam ? 'Wiki Multishot: extra beams on one target merge into a single tick with the summed damage and status chance. Slash, Heat, Toxin, Electricity, Blast and Gas procs come off that merged tick, so they scale with multishot twice. Forced procs (Hunter Munitions etc.) are one per tick.' : undefined}>
                      {result.multishotLocked ? 'locked by Acuity' : result.multishotModsIgnored ? 'multishot mods don\'t apply to this attack' : 'beam: merged ticks'}
                    </td>
                  </tr>
                )}
                {result.melee && (
                  <>
                    <tr><td>Combo multiplier{result.melee.heavy ? ' (heavy damage ×)' : ''}</td><td>{formatNumber(result.melee.combo, 1)}x</td></tr>
                    {result.melee.critFromCombo > 0 && <tr><td>Blood Rush / Gladiator crit (mod bonus)</td><td>+{formatPercent(result.melee.critFromCombo)}</td></tr>}
                    {result.melee.statusFromCombo > 0 && <tr><td>Weeping Wounds status (mod bonus)</td><td>+{formatPercent(result.melee.statusFromCombo)}</td></tr>}
                    {result.melee.windUp !== null && <tr><td>Heavy wind-up</td><td>{formatNumber(result.melee.windUp, 2)}s</td></tr>}
                    {result.melee.comboAfterHeavy !== null && <tr><td>Combo left after the heavy</td><td>{formatNumber(result.melee.comboAfterHeavy, 1)}x</td></tr>}
                  </>
                )}
                <tr><td>Time spent firing</td><td>{formatPercent(result.uptime)}</td></tr>
                <tr><td>Direct / DoT DPS (burst)</td><td>{formatNumber(result.burstDps, 0)} / {formatNumber(result.dotDps, 0)}</td></tr>
                <tr><td>Status types for CO ({result.statusTypeSource === 'build' ? 'from build' : 'from debuffs'})</td><td>{result.activeStatusTypes}</td></tr>
                {result.conditionOverload.bonus > 0 && (
                  <tr>
                    <td title={result.conditionOverload.note}>
                      CO-type bonus ({result.conditionOverload.mode === 'multiply' ? 'multiplicative' : 'additive'}, {result.conditionOverload.source === 'sheet' ? 'GunCO sheet' : result.conditionOverload.source})
                    </td>
                    <td>+{formatPercent(result.conditionOverload.bonus)}</td>
                  </tr>
                )}
                <tr><td>Armor</td><td>{formatNumber(result.armor.before, 0)} → {formatNumber(result.armor.after, 0)} ({formatPercent(1 - result.armor.damageMultiplier)} DR)</td></tr>
              </tbody>
            </table>
            {result.passives.length > 0 && <p className="proc-note">Passive on: {result.passives.join(', ')}</p>}
            {result.abilities.length > 0 && <p className="proc-note">Abilities on: {result.abilities.join(', ')}</p>}
            {result.detonation && (
              <p className="proc-note">
                Harmony detonation per heavy: <b>{formatDamage(result.detonation.ownProcs + result.detonation.existingStacks)}</b> ({formatDamage(result.detonation.ownProcs)} from
                the heavy's own procs, {formatDamage(result.detonation.existingStacks)} from stacks already on the target). The own-procs part
                is already in the DoT DPS (it just lands at once), the stacks part is extra burst.
              </p>
            )}
          </Box>

          {result.dots.length > 0 && (
            <Box id="procs" title={`Status procs, ${formatNumber(result.procsPerSecond, 2)}/s`}>
              {result.dots.map((dot) => (
                <div key={dot.damageType} className="proc-card">
                  <div className="row spread">
                    <span className={`dmg-${dot.damageType} status-name`}>{dot.damageType}</span>
                    <span className="muted-inline">{formatNumber(dot.procsPerSecond, 2)} procs/s · {formatNumber(dot.dps, 0)} DPS {dot.note && <Info text={dot.note} />}</span>
                  </div>
                  <table className="proc-table">
                    <thead><tr><th></th><th>Non-crit</th><th>Crit</th><th>Average</th></tr></thead>
                    <tbody>
                      {dot.ticks > 1 && (
                        <tr><td>Per tick</td><td>{formatDamage(dot.tick.normal)}</td><td>{formatDamage(dot.tick.crit)}</td><td>{formatDamage(dot.tick.average)}</td></tr>
                      )}
                      <tr>
                        <td>Per proc{dot.ticks > 1 ? ` (${dot.ticks} ticks)` : ''}</td>
                        <td>{formatDamage(dot.perProc.normal)}</td><td>{formatDamage(dot.perProc.crit)}</td><td>{formatDamage(dot.perProc.average)}</td>
                      </tr>
                      {dot.aoe && (
                        <tr><td>{dot.aoe.label}</td><td>{formatDamage(dot.aoe.damage.normal)}</td><td>{formatDamage(dot.aoe.damage.crit)}</td><td>{formatDamage(dot.aoe.damage.average)}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ))}
            </Box>
          )}

          {result.setBonuses.length > 0 && (
            <Box id="sets" title="Mod sets (weapon + Warframe)">
              <ul className="set-bonuses">
                {result.setBonuses.map((set) => <li key={set.set}><b>{set.name} {set.count}/{set.pieces}</b>: {set.text}</li>)}
              </ul>
            </Box>
          )}
        </div>
      </div>
    </section>
  )
}
