// tags for the niche mechanics an attack has that the game doesn't spell out (beam multishot, multiplicative CO...).
// everything here comes from flags the calc already uses, so a tag means the calc is treating it that way
import { resolveCoBehavior } from './conditionOverload'
import type { Attack, Weapon } from '../types'

export interface MechanicTag {
  label: string
  explanation: string // hover text
  tone?: 'good' | 'bad' // multiplicative CO is a buff, no CO / no multishot mods is a loss
}

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`

export function mechanicTags(weapon: Weapon, attack: Attack): MechanicTag[] {
  const tags: MechanicTag[] = []
  const isMelee = weapon.category === 'Melee'
  const isIncarnon = /incarnon/i.test(attack.name)

  // Vinquibus: a rifle and a bayonet in one, each half modded on its own (the melee half is its own entry here)
  if (/^Vinquibus/.test(weapon.name)) {
    tags.push({
      label: isMelee ? 'Bayonet half' : 'Rifle half',
      explanation:
        'Vinquibus sits in both the primary and the melee slot at once, with a separate mod setup and riven for each half (polarities are shared). ' +
        `Here the halves are two entries: "Vinquibus" for the rifle and "Vinquibus (Melee)" for the bayonet. This is the ${isMelee ? 'bayonet' : 'rifle'}.`,
    })
  }

  if (attack.continuous) {
    tags.push({
      label: 'Beam',
      explanation:
        'Continuous weapon. Multishot doesn\'t add separate hits here: the extra beams on one enemy merge into a single damage tick ' +
        'worth all of them, with their status chance added together (wiki Multishot: "additional beams that hit the same target ' +
        'instead merge into a singular damage tick"). So one tick shows the full multishot damage.\n\n' +
        'Damaging statuses (Slash, Heat, Toxin, Electricity, Blast, Gas) get multishot twice on beams, once from the bigger tick and once ' +
        'from the extra procs, which is why Heat beams scale so hard with multishot. Forced procs still land once per tick.\n\n' +
        'Not modeled: damage ramps from 20% to 100% over 0.6 s of firing (wiki, Catabolyst page).',
    })
  }

  const co = resolveCoBehavior(weapon, attack)
  if (co.mode === 'multiply') {
    tags.push({
      label: 'Multiplicative CO',
      tone: 'good',
      explanation:
        'Condition Overload / Galvanized / Secondary Shiver multiply on this attack instead of adding to the base damage mods: ' +
        'base x (1 + Serration etc.) x (1 + CO) instead of base x (1 + Serration etc. + CO). With a big damage mod stack that\'s ' +
        `a lot more damage per status type on the enemy (wiki Condition Overload (Mechanic), ${co.source === 'sheet' ? 'GunCO sheet' : 'wiki table'}). ` +
        'The game doesn\'t mean it to work this way, so it can get fixed.' + (co.note ? `\n\n${co.note}` : ''),
    })
  } else if (co.mode === 'none') {
    tags.push({ label: 'No CO', tone: 'bad', explanation: `Condition Overload / Galvanized bonuses don't apply to this attack. ${co.note ?? ''}`.trim() })
  } else if (co.note) {
    tags.push({ label: co.scale !== 1 ? `CO at ${pct(co.scale)}` : 'CO: direct hit only', explanation: co.note })
  } else if (co.scale !== 1) {
    tags.push({ label: `CO at ${pct(co.scale)}`, explanation: `Condition Overload / Galvanized scale off ${pct(co.scale)} of this attack's damage.` })
  }

  if (attack.noMultishotMods && !attack.continuous && !isMelee) {
    tags.push({
      label: 'Ignores multishot mods',
      tone: 'bad',
      explanation:
        'Multishot mods and arcanes do nothing on this attack. It keeps its innate multishot: hitscan explosions (one per hit), ' +
        'beam blasts, speargun throws and some Incarnon forms work this way (GunCO sheet: "no MS, but gets CO").',
    })
  }

  if (isIncarnon && !isMelee && weapon.multishot > 1) {
    tags.push({
      label: 'Single projectile',
      explanation: `The Incarnon form fires one projectile, the normal form's ${weapon.multishot} pellets don't carry over. Multishot mods still add more.`,
    })
  }

  if (attack.baseDamagePool) {
    tags.push({
      label: 'Part of one shot',
      explanation:
        `This attack is one part of a shot worth ${attack.baseDamagePool} base damage in total. "+N Base Damage" Incarnon perks grow every part ` +
        `by (${attack.baseDamagePool} + N) / ${attack.baseDamagePool}, they don't add N to each part.`,
    })
  }

  if (attack.forcedProcs?.length) {
    tags.push({
      label: `Forced ${attack.forcedProcs.join(' + ')}`,
      explanation: `Every hit forces ${attack.forcedProcs.join(' and ')} proc${attack.forcedProcs.length > 1 ? 's' : ''} on top of its normal status rolls.`,
    })
  }

  if (attack.hitscanAoE && co.mode !== 'none' && !co.note) {
    tags.push({ label: 'Hitscan explosion', explanation: 'The explosion of a hitscan shot: only the enemy the shot hit directly gets CO, the rest of the radius doesn\'t.' })
  }

  return tags
}
