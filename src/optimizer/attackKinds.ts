// which kind of attack a leaderboard entry is, for the attack-type filter. the export has no such field, so it's the
// weapon category + the data's AoE flag (explosions, radial hits) + the attack name. names are free text, so the
// alt-fire list is a best guess: anything that isn't recognised as alt-fire on a gun counts as primary fire
import type { Attack, Weapon } from '../types'

export type AttackKind = 'normal' | 'heavy' | 'slam' | 'meleeOther' | 'primaryFire' | 'altFire' | 'aoe' | 'incarnon'

export const ATTACK_KINDS: { id: AttackKind; label: string; melee: boolean }[] = [
  { id: 'normal', label: 'Normal attacks', melee: true },
  { id: 'heavy', label: 'Heavy attacks / glaive detonations', melee: true },
  { id: 'slam', label: 'Slams', melee: true },
  { id: 'meleeOther', label: 'Throws / other melee', melee: true },
  { id: 'primaryFire', label: 'Primary fire', melee: false },
  { id: 'altFire', label: 'Alt-fire', melee: false },
  { id: 'aoe', label: 'Explosions / AoE', melee: false },
  { id: 'incarnon', label: 'Incarnon form', melee: false },
]

const ALT_FIRE = /alt[- ]?fire|secondary fire|cannon mode|barrage mode|lock-?on|grenade|air burst|harpoon|throw|cube|bubble|orb|spectral|glaive|plasma bomb|cluster bomb|attraction field|soul swarm|energy disk|energy wave|corrosive (wave|pool|dot)|spore|disc/i

export function attackKind(weapon: Weapon, attack: Pick<Attack, 'name' | 'isAoE' | 'heavy'>): AttackKind {
  const name = attack.name
  if (weapon.category === 'Melee') {
    if (/slam/i.test(name)) return 'slam'
    // glaive detonations are heavies too (build-data marks them)
    if (/heavy attack/i.test(name) || attack.heavy) return 'heavy'
    if (/^normal attack$/i.test(name)) return 'normal'
    return 'meleeOther'
  }
  if (/incarnon/i.test(name)) return 'incarnon'
  if (attack.isAoE || /explosion|detonation|radial|\baoe\b|cloud|blast|collapse|merging/i.test(name)) return 'aoe'
  if (ALT_FIRE.test(name)) return 'altFire'
  return 'primaryFire'
}
