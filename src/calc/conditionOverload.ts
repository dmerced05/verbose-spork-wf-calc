// how "per status type" bonuses (Condition Overload, Galvanized Aptitude/Savvy/Shot, Secondary Shiver) apply,
// per wiki.warframe.com/w/Condition_Overload_(Mechanic):
//   additive (intended):  base x [(1 + damage mods) x other multipliers + CO]
//   multiplicative:       base x (1 + damage mods) x (1 + CO) x other multipliers
// mostly projectile attacks multiply. some attacks get a scaled bonus (Ballistica charged 25%), some get none.
// the wiki says anything not in its table is additive at 100%. I treat unlisted AoE as none since
// CO doesn't apply to radial damage on enemies that weren't hit directly.
import type { Attack, Weapon } from '../types'

export type CoMode = 'add' | 'multiply' | 'none'

export interface CoBehavior {
  mode: CoMode
  scale: number // 1 = full bonus, 0.25 = Ballistica charged shot etc.
  source: 'wiki' | 'default' | 'override'
  note?: string
}

interface CoRule {
  weapons: string[]
  attack: RegExp // matched against warframe-items attack names, which differ from the wiki's wording
  mode: CoMode
  scale?: number
  note?: string
}

// from the wiki's attack catalog. the secondaries table past Ballistica and the melee table didn't come
// through when I pulled the page, so those fall back to the default (use the override in the UI if needed)
const CO_RULES: CoRule[] = [
  // primaries
  { weapons: ['Aeolak'], attack: /^(Normal Attack|Alt-Fire)$/, mode: 'multiply' },
  { weapons: ['Alternox', 'Alternox Prime'], attack: /^Normal Attack$/, mode: 'multiply' },
  { weapons: ['Arca Plasmor', 'Tenet Arca Plasmor'], attack: /^Normal Attack$/, mode: 'multiply' },
  { weapons: ['Basmu'], attack: /^Auto$/, mode: 'multiply' },
  { weapons: ['Battacor'], attack: /^Normal Attack$/, mode: 'multiply' },
  { weapons: ['Bubonico'], attack: /^(Auto|Burst)$/, mode: 'multiply' },
  { weapons: ['Buzlok'], attack: /^(Normal Attack|Beacon)$/, mode: 'multiply' },
  { weapons: ['Cedo', 'Cedo Prime'], attack: /^Alt-Fire Glaive$/, mode: 'multiply' },
  { weapons: ['Coda Bassocyst', 'Coda Hema', 'Hema', 'Exergis', 'Steflos', 'Shedu'], attack: /^Normal Attack$/, mode: 'multiply' },
  { weapons: ['Mutalist Cernos'], attack: /^Uncharged Shot$/, mode: 'multiply' },
  { weapons: ['Mutalist Cernos'], attack: /^Toxin Cloud$/, mode: 'add', note: 'Wiki: uncharged cloud multiplies, charged cloud adds' },
  { weapons: ['Cinta'], attack: /^(Quick Shot|Charged Shot|Perfect Shot)$/, mode: 'multiply' },
  { weapons: ['Dread'], attack: /^Incarnon Form/, mode: 'multiply' },
  { weapons: ['Evensong'], attack: /^Charged Radial Attack$/, mode: 'none' },
  { weapons: ['Felarx'], attack: /^(Normal Attack|Incarnon Form)$/, mode: 'multiply' },
  { weapons: ['Fulmin'], attack: /^Semi-Auto Mode$/, mode: 'multiply' },
  { weapons: ['Harpak'], attack: /^Harpoon$/, mode: 'multiply' },
  { weapons: ['Javlok'], attack: /^Projectile Impact$/, mode: 'multiply' },
  { weapons: ['Latron', 'Latron Prime', 'Miter'], attack: /^Incarnon Form$/, mode: 'multiply' },
  { weapons: ['Nataruk'], attack: /^(Charged Shot|Perfect Shot)$/, mode: 'multiply' },
  { weapons: ['Paracyst'], attack: /^Infested Harpoon/, mode: 'multiply' },
  { weapons: ['Paris', 'Paris Prime'], attack: /^Incarnon Form/, mode: 'multiply' },
  { weapons: ['Mk1-Paris'], attack: /^Charged Shot$/, mode: 'add', scale: 0.5, note: 'Wiki: CO only applies to the uncharged base damage' },
  { weapons: ['Phantasma', 'Phantasma Prime'], attack: /^Cluster Bombs Impact$/, mode: 'multiply' },
  { weapons: ['Proboscis Cernos'], attack: /^(Appendages|Charged Shot Explosion)$/, mode: 'none' },
  { weapons: ['Quellor'], attack: /^Alt-Fire$/, mode: 'multiply' },
  { weapons: ['Scourge', 'Scourge Prime'], attack: /^Spear Throw( Impact)?$/, mode: 'multiply' },
  { weapons: ['Stahlta'], attack: /^(Auto|Alt-Fire)$/, mode: 'multiply' },
  { weapons: ['Tenet Envoy'], attack: /^Grenade Impact$/, mode: 'multiply' },
  { weapons: ['Torid'], attack: /^(Grenade Impact|Poison Cloud)$/, mode: 'multiply' },
  { weapons: ['Trumna'], attack: /^Auto AoE$/, mode: 'add', scale: 1.64, note: 'Wiki: only on the enemy the laser hits directly' },
  { weapons: ['Trumna'], attack: /^Grenade Impact$/, mode: 'multiply' },
  { weapons: ['Zarr'], attack: /^Cannon Mode Cluster Bomb/, mode: 'add', scale: 1.67 },
  { weapons: ['Kuva Zarr'], attack: /^Cannon Mode Cluster Bomb/, mode: 'add', scale: 3.33 },
  { weapons: ['Zhuge Prime'], attack: /^Arrow Explosion$/, mode: 'none' },
  // AoE attacks the wiki says DO get the (additive) bonus
  { weapons: ['Ambassador'], attack: /^Charged AoE$/, mode: 'add' },
  { weapons: ['Braton', 'Mk1-Braton', 'Braton Prime', 'Braton Vandal', 'Burston', 'Burston Prime'], attack: /^Incarnon Form (AoE|Radial Attack)$/, mode: 'add' },
  { weapons: ['Ferrox', 'Tenet Ferrox', 'Glaxion Vandal', 'Opticor', 'Opticor Vandal'], attack: /AoE|Radial|Explosion/, mode: 'add' },
  // secondaries
  { weapons: ['Akarius Prime'], attack: /^Rocket Impact$/, mode: 'multiply' },
  { weapons: ['Aegrit'], attack: /^Direct Hit$/, mode: 'multiply' },
  { weapons: ['Angstrum', 'Prisma Angstrum'], attack: /^Incarnon Form$/, mode: 'multiply' },
  { weapons: ['Azima'], attack: /^Turret/, mode: 'none' },
  { weapons: ['Ballistica'], attack: /^Charged Shot$/, mode: 'add', scale: 0.25 },
  // Secondary Shiver's wiki page: multiplicative with Hornet Strike on these
  { weapons: ['Cyanex', 'Catchmoon', 'Epitaph', 'Seer', 'Kuva Seer', 'Sepulcrum', 'Tenet Spirex'], attack: /^(?!.*(AoE|Explosion|Radial)).*/, mode: 'multiply', note: 'From the Secondary Shiver wiki page' },
]

export function resolveCoBehavior(weapon: Weapon, attack: Attack): CoBehavior {
  const rule = CO_RULES.find((candidate) => candidate.weapons.includes(weapon.name) && candidate.attack.test(attack.name))
  if (rule) return { mode: rule.mode, scale: rule.scale ?? 1, source: 'wiki', note: rule.note }
  return attack.isAoE
    ? { mode: 'none', scale: 1, source: 'default', note: 'Radial damage doesn\'t get CO on enemies that weren\'t hit directly' }
    : { mode: 'add', scale: 1, source: 'default' }
}

export const CO_MODE_LABELS: Record<CoMode, string> = { add: 'Additive', multiply: 'Multiplicative', none: 'Doesn\'t apply' }
