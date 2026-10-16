// the selected attack's unmodded numbers, straight from the data (before mods, perks, passives or the target)
import { SHELL_BY_SHELL_RELOAD } from '../data/reloads'
import { exaltedRuleFor } from '../data/exalted'
import { biggestHit, comboTotal, heavyBreakdownText, multiHitHeavyFor } from '../data/heavyAttacks'
import type { Attack, Weapon } from '../types'

const fixed = (value: number, digits = 2) => value.toLocaleString(undefined, { maximumFractionDigits: digits })
const percent = (fraction: number) => `${fixed(fraction * 100, 1)}%`

export function BaseStats({ weapon, attack }: { weapon: Weapon; attack: Attack }) {
  // multi-hit heavies show the biggest hit, the export's number for them isn't one hit
  const heavyCombo = attack.heavy && attack.heavyMultiplier ? multiHitHeavyFor(weapon.name) : null
  const heavyScale = heavyCombo && attack.heavyMultiplier ? biggestHit(heavyCombo) / attack.heavyMultiplier : 1
  const damageRows = Object.entries(attack.damage)
    .filter(([, amount]) => amount > 0)
    .map(([damageType, amount]) => [damageType, amount * heavyScale] as [string, number])
    .sort((a, b) => b[1] - a[1])
  const total = damageRows.reduce((sum, [, amount]) => sum + amount, 0)
  const isMelee = weapon.category === 'Melee'
  const multishot = attack.multishot ?? weapon.multishot
  const shellReload = SHELL_BY_SHELL_RELOAD[weapon.name]
  const exalted = exaltedRuleFor(weapon)
  const reloads = !isMelee && !/incarnon/i.test(attack.name) && weapon.magazineSize && weapon.reloadTime

  const stats: [string, string][] = [
    [heavyCombo ? 'Biggest hit' : multishot > 1 && !isMelee ? 'Damage per pellet' : 'Total damage', fixed(total, 1)],
    ['Crit chance', percent(attack.critChance)],
    ['Crit multiplier', `${fixed(attack.critMultiplier)}x`],
    ['Status chance', percent(attack.statusChance)],
    [isMelee ? 'Attack speed' : 'Fire rate', fixed(attack.fireRate)],
  ]
  if (!isMelee) stats.push(['Multishot', fixed(multishot)])
  if (attack.chargeTime) stats.push(['Charge time', `${fixed(attack.chargeTime)}s`])
  // multi-hit heavies use the wiki/arsenal hit list, the export's single number isn't one hit for those
  const combo = heavyCombo
  if (combo) stats.push(['Heavy hits', `${combo.hits.length} · biggest ${fixed(biggestHit(combo), 1)}x · all ${fixed(comboTotal(combo), 1)}x`])
  else if (attack.heavy && attack.heavyMultiplier) stats.push(['Heavy multiplier', `${fixed(attack.heavyMultiplier, 1)}x`])
  if (attack.windUp) stats.push(['Heavy wind-up', `${fixed(attack.windUp)}s`])
  if (reloads) {
    stats.push(['Magazine', String(weapon.magazineSize)])
    stats.push(['Reload', `${fixed(weapon.reloadTime!)}s${shellReload ? ` (${fixed(shellReload.perShell)}s / shell)` : ''}`])
  }
  if (weapon.trigger) stats.push(['Trigger', weapon.trigger])
  stats.push(['Riven disposition', weapon.rivenDisposition
    ? `${weapon.disposition ? `${'●'.repeat(weapon.disposition)} ` : ''}x${weapon.rivenDisposition}`
    : weapon.exalted ? 'no riven slot' : '?'])

  // multi-hit heavies (Heavy Scythes, Dual Swords...) get a flag with the per-hit breakdown on hover
  const multiHit = combo
  const normalAttack = weapon.attacks.find((option) => /^normal attack$/i.test(option.name)) ?? weapon.attacks[0]
  const normalTotal = Object.values(normalAttack.damage).reduce((sum, amount) => sum + amount, 0)

  return (
    <div className="base-stats">
      <div className="base-stats-head">
        <span>Base stats · {attack.name}</span>
        {attack.isAoE && <span className="evo-tag">AoE</span>}
        {exalted && (
          <span
            className="evo-tag"
            title={`${exalted.pseudo ? 'Pseudo-exalted' : 'Exalted'}: ${exalted.warframe}'s ${exalted.ability}. ${exalted.strength === 'base' ? 'Base damage x your Ability Strength (Warframe box).' : exalted.strength === 'bonus' ? `+${Math.round((exalted.strengthBonus ?? 0) * 100)}% damage x your Ability Strength, added in with the damage mods.` : 'Doesn\'t scale with Ability Strength.'}${exalted.abilityCombo ? ' +1x damage per combo multiplier on every hit.' : ''}${exalted.noAttackSpeed ? ' Attack speed mods do nothing.' : ''}${exalted.note ? ` ${exalted.note}` : ''}`}
          >
            {exalted.pseudo ? 'Pseudo-exalted' : 'Exalted'} · {exalted.warframe} ⓘ
          </span>
        )}
        {multiHit && (
          <span className="multi-hit-tag" title={`${heavyBreakdownText(multiHit, normalTotal)}\n\nThe export lists ${fixed(attack.heavyMultiplier ?? 0, 1)}x for this heavy, the calculator uses the hit list instead.`}>
            Multi-hit heavy ⓘ
          </span>
        )}
      </div>
      <div className="base-stats-grid">
        <dl>
          {stats.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
        <dl className="base-damage">
          {damageRows.map(([damageType, amount]) => (
            <div key={damageType}>
              <dt className={`dmg-${damageType}`}>{damageType}</dt>
              <dd>{fixed(amount, 1)} <span className="muted-inline">({percent(total > 0 ? amount / total : 0)})</span></dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
