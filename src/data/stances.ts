// stance combos for melee Normal Attack DPS (wiki Module:Stances/data, summed per combo in scripts/wiki-stances.txt).
// a combo is N hits over "Length @ 1.0 Attack Speed" seconds, each hit at some % of the weapon's damage. so with a
// stance a Normal Attack lands hits / length x attack speed hits a second, each worth multiplier / hits on average,
// instead of the one 100% swing per point of attack speed I had before. the wiki's own stance tables rank combos the
// same way ("average damage multiplier per second" = total multiplier / length)
import stancesJson from './stances.json'
import { meleeClassOf } from './weaponClasses'
import type { Attack, Weapon } from '../types'

export interface StanceCombo {
  name: string
  duration: number // seconds at 1.0 attack speed
  hits: number
  multiplier: number // all hits' damage multipliers added up (Ruin: 5 hits = 6x)
  slash: number // damage-weighted SlashMultiplier etc. over the combo's hits
  impact: number
  puncture: number
  status: number // average status chance multiplier per hit
  bleeds: number // forced Slash procs (wiki "Bleed") in one run of the combo
}
export interface Stance {
  weaponType: string
  uniqueToWeapon?: boolean
  stanceless?: boolean // what the weapon does with no stance equipped
  combos: Record<string, StanceCombo>
}
export const STANCES = stancesJson as Record<string, Stance>

// which combo, null = let the calc pick the best one
export interface StanceChoice { stance: string; combo: string }

// exalted weapons use their own stance, listed under its own weapon type in the wiki data. the rest stay on plain swings:
//  - Diwata runs the archwing moveset (wiki Diwata: "an inbuilt stance mod called Razorwing with one combo called Faerie's
//    Waltz. Its attack animations are identical to that of Veritux's"), and the wiki has no combo table for it
//    (Archmelee: "There are currently no Stance mods for Archmelee weapons")
//  - Landslide Fists, Whipclaw, Shattered Lash, Shadow Clones are ability casts (pseudo-exalted in exalted.ts). Landslide's
//    three-punch chain only grows the radius ("On the 2nd punch, the impact radius is increased to ... 6 meters", 3rd "8"),
//    its damage scaling is the ability combo, already in exalted.ts: "Landslide gains 1x additional damage per combo
//    multiplier, up to 12x damage at 12x combo"
const EXALTED_STANCE: Record<string, string> = {
  'Exalted Blade': 'Exalted Blade', 'Exalted Prime Blade': 'Exalted Blade', 'Exalted Umbra Blade': 'Exalted Blade',
  'Valkyr Talons': 'Hysteria', 'Valkyr Prime Talons': 'Hysteria',
  'Iron Staff': 'Primal Fury', 'Iron Staff Prime': 'Primal Fury',
  'Shadow Claws': 'Ravenous Wraith', 'Shadow Claws Prime': 'Ravenous Wraith',
  'Desert Wind': 'Serene Storm', 'Desert Wind Prime': 'Serene Storm',
}

// every stance this weapon can run: its exalted stance, or the class's stances plus its own unique one. the
// stanceless moveset only if the class has nothing else
export function stancesFor(weapon: Weapon): string[] {
  if (weapon.category !== 'Melee') return []
  const exalted = EXALTED_STANCE[weapon.name]
  if (exalted) return STANCES[exalted] ? [exalted] : []
  const weaponClass = meleeClassOf(weapon.name)
  if (!weaponClass) return []
  const own = Object.entries(STANCES).filter(([name, stance]) => stance.weaponType === weaponClass && (!stance.uniqueToWeapon || weapon.name.startsWith(name)))
  const real = own.filter(([, stance]) => !stance.stanceless)
  return (real.length ? real : own).map(([name]) => name)
}

// a combo's DPS weight: damage multiplier per second at 1.0 attack speed, physical type multipliers and bleeds left out
export const comboRate = (combo: StanceCombo) => combo.multiplier / combo.duration

export function bestCombo(weapon: Weapon): StanceChoice | null {
  let best: { choice: StanceChoice; rate: number } | null = null
  for (const stance of stancesFor(weapon)) {
    for (const [combo, data] of Object.entries(STANCES[stance].combos)) {
      if (data.duration > 0 && (!best || comboRate(data) > best.rate)) best = { choice: { stance, combo }, rate: comboRate(data) }
    }
  }
  return best?.choice ?? null
}

// only the plain Normal Attack follows a stance. heavies, slams, slides and throws have their own numbers
export const usesStance = (weapon: Weapon, attack: Attack) =>
  weapon.category === 'Melee' && (attack.name === 'Normal Attack' || Boolean(attack.followsStance)) && !attack.heavy

// the Normal Attack as one "average combo hit": damage x average multiplier (with the physical type multipliers),
// hits per second from the combo length, status x the combo's status multiplier, bleeds as a forced Slash share
export function applyStance(attack: Attack, combo: StanceCombo): { attack: Attack; forcedSlashPerHit: number } {
  const perHit = combo.multiplier / combo.hits
  const typeFactor: Record<string, number> = { slash: combo.slash, impact: combo.impact, puncture: combo.puncture }
  const damage = Object.fromEntries(Object.entries(attack.damage).map(([type, amount]) => [type, amount * perHit * (typeFactor[type] ?? 1)]))
  return {
    attack: { ...attack, damage, fireRate: attack.fireRate * combo.hits / combo.duration, statusChance: attack.statusChance * combo.status },
    forcedSlashPerHit: combo.bleeds / combo.hits,
  }
}

export const comboLabel = (choice: StanceChoice) => {
  const combo = STANCES[choice.stance]?.combos[choice.combo]
  return `${choice.stance}, ${choice.combo}${combo?.name ? ` (${combo.name})` : ''}`
}
