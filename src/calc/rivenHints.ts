// the "why" next to the god-roll search: what about this weapon's base stats makes some riven stats better than others.
// these are rules of thumb from the base numbers, the search underneath is what actually measures it
import { resolveCoBehavior } from './conditionOverload'
import { rivenPool, type RivenType } from './riven'
import { attackMetrics, categoryWord, damageSplit, standing } from './weaponProfile'
import type { Attack, Weapon } from '../types'

export interface RivenHint { title: string; text: string; tone: 'good' | 'bad' | 'neutral' }

const pct = (value: number) => `${Math.round(value * 100)}%`
const baseOf = (type: RivenType, pattern: RegExp) => rivenPool(type).find((def) => pattern.test(def.tag))?.base ?? 0

export function rivenHints(weapon: Weapon, attack: Attack, type: RivenType): RivenHint[] {
  const hints: RivenHint[] = []
  const metrics = attackMetrics(weapon, attack)
  const group = categoryWord(weapon.category)
  const crit = standing(weapon.category, 'critChance', attack.critChance)
  const status = standing(weapon.category, 'statusChance', attack.statusChance)
  const split = damageSplit(attack)

  // crit: crit chance and crit damage both scale off the base, so a high base makes both worth a lot more
  if (attack.critChance >= 0.25 || (crit && crit.percentile >= 0.7)) {
    hints.push({ title: 'Crit stats', tone: 'good', text: `${pct(attack.critChance)} base crit (${crit?.label ?? 'high'} for ${group}). Crit Chance on a riven is a % of the base, so a high base turns it into a lot of real crit, and Crit Damage pays off on every hit.` })
  } else if (attack.critChance <= 0.1) {
    hints.push({ title: 'Crit stats', tone: 'bad', text: `Only ${pct(attack.critChance)} base crit. Crit Chance on a riven multiplies a small number, so it barely moves, and Crit Damage needs crits to land. Status or elements usually do more.` })
  }

  // status: more status chance makes every element's procs land more often
  if (attack.statusChance >= 0.3 || (status && status.percentile >= 0.7)) {
    hints.push({ title: 'Elements and status', tone: 'good', text: `${pct(attack.statusChance)} base status (${status?.label ?? 'high'} for ${group}). Elements on a riven add damage and procs, and Status Damage (spliced) multiplies every DoT.` })
  } else if (attack.statusChance <= 0.1) {
    hints.push({ title: 'Status', tone: 'neutral', text: `Low status (${pct(attack.statusChance)}). Elements still add raw damage (they're a % of the whole base), but their procs won't do much.` })
  }

  // Condition Overload that multiplies: each status type on the enemy is a separate multiplier
  const co = resolveCoBehavior(weapon, attack)
  if (co.mode === 'multiply') {
    hints.push({ title: 'Multiplicative CO', tone: 'good', text: 'Galvanized / Condition Overload multiply on this attack, so every extra status type on the enemy is worth more than usual. A riven element that brings a new status type (one the build doesn\'t already make) is extra strong.' })
  }

  // IPS: a riven's Impact/Puncture/Slash only scales that part of the base, an element scales all of it
  const elementBase = baseOf(type, /FireDamageMod$/)
  const physicalBase = baseOf(type, /ImpactDamageMod$/)
  if (elementBase > 0 && physicalBase > 0) {
    const ratio = physicalBase / elementBase
    const breakEven = 1 / ratio
    const top = split.physical[0]
    if (top) {
      const relative = top.share * ratio
      hints.push({
        title: `${top.type[0].toUpperCase()}${top.type.slice(1)} stat`,
        tone: relative >= 1 ? 'good' : 'neutral',
        text: `${top.type[0].toUpperCase()}${top.type.slice(1)} is ${pct(top.share)} of the damage. Its riven stat rolls ${ratio.toFixed(2)}x an element's, but only scales that part, so it adds ${relative.toFixed(2)}x what an element would. ` +
          `It needs more than ${pct(breakEven)} of the damage to beat an element on raw damage${top.type === 'slash' ? ' (Slash also gets armor-ignoring bleeds, so it gets there a bit sooner)' : ''}.`,
      })
    }
  }

  // innate elements combine with modded ones in the mod order, so the riven's element decides what it turns into
  if (split.elements.length) {
    hints.push({ title: 'Innate element', tone: 'neutral', text: `It already deals ${split.elements.map((row) => row.type).join(' / ')}. Innate elements combine last, so a riven element can turn it into a combined element (good if you want that status, bad if you wanted the innate one's).` })
  }

  // beams: multishot is stronger than it looks (bigger merged ticks + more procs, DoTs get it twice)
  if (attack.continuous) {
    hints.push({ title: 'Beam', tone: 'good', text: 'Beam: Multishot makes each tick bigger and adds procs, so damaging statuses (Heat, Toxin, Slash...) get it twice. Multishot rivens are better here than on a normal gun.' })
  } else if (attack.noMultishotMods && weapon.category !== 'Melee') {
    hints.push({ title: 'Multishot', tone: 'bad', text: 'Multishot mods do nothing on this attack, so a Multishot riven stat is wasted on it.' })
  }

  // magazine / reload matter for sustained DPS when the magazine runs dry fast
  if (metrics.magazine && metrics.reload && metrics.fireRate > 0) {
    const emptiesIn = metrics.magazine / metrics.fireRate
    if (emptiesIn < metrics.reload * 1.5) {
      hints.push({ title: 'Magazine', tone: 'neutral', text: `Empties its ${metrics.magazine}-round magazine in ${emptiesIn.toFixed(1)} s and reloads for ${metrics.reload} s, so it spends a lot of time reloading. Magazine or Reload Speed can be worth a slot for sustained DPS.` })
    }
  }

  if (weapon.category === 'Melee') {
    hints.push({ title: 'Melee', tone: 'neutral', text: 'Melee crit chance is often pushed by Blood Rush with combo, so a Crit Chance riven is usually worth less than Crit Damage or an element.' })
  }
  return hints
}
