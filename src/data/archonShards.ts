// Archon Shards (wiki.warframe.com/w/Archon_Shard): 5 slots on a Warframe, one buff per shard, Tauforged = x1.5.
// "Bonuses from different shards stack additively, independent of their color", and the weapon ones are additive with
// the matching mods (Melee Crit Damage goes in with Organ Shatter). they also apply to exalted weapons of the same class.
// only the weapon ones and Strength/Duration/energy/armor/health/shields change numbers here, the rest are listed but
// marked not modeled (ability damage vs a status, orb effects, casting speed...)

export type ShardColor = 'Crimson' | 'Azure' | 'Amber' | 'Violet' | 'Topaz' | 'Emerald'

export type ShardEffect =
  | 'strength' | 'duration' // fractions
  | 'meleeCritDamage' | 'primaryStatusChance' | 'secondaryCritChance' // additive with mods
  | 'violetMeleeCritDamage' // doubles above 500 max Energy
  | 'primaryElectricity' // +45% tauforged, +15% per Crimson/Azure/Violet shard
  | 'topazSecondaryCritChance' // per Heat kill, taken at its max
  | 'toxinStatusDamage'
  | 'energy' | 'armor' | 'health' | 'shields' // flat, after all bonuses
  | 'none'

export interface ShardBuff {
  id: string
  color: ShardColor
  label: string // "+25% Melee Critical Damage" at normal value
  normal: number
  tauforged: number
  effect: ShardEffect
  perShard?: { normal: number; tauforged: number } // Violet's electricity extra per Crimson/Azure/Violet shard
  quote: string // wiki line
}

const buff = (id: string, color: ShardColor, label: string, normal: number, effect: ShardEffect, quote: string, extra: Partial<ShardBuff> = {}): ShardBuff =>
  ({ id, color, label, normal, tauforged: normal * 1.5, effect, quote, ...extra })

export const SHARD_BUFFS: ShardBuff[] = [
  buff('crimson-melee-cd', 'Crimson', 'Melee Critical Damage', 0.25, 'meleeCritDamage', '+25% (+37.5%) Melee Critical Damage'),
  buff('crimson-primary-sc', 'Crimson', 'Primary Status Chance', 0.25, 'primaryStatusChance', '+25% (+37.5%) Primary Status Chance'),
  buff('crimson-secondary-cc', 'Crimson', 'Secondary Critical Chance', 0.25, 'secondaryCritChance', '+25% (+37.5%) Secondary Critical Chance'),
  buff('crimson-strength', 'Crimson', 'Ability Strength', 0.1, 'strength', '+10% (+15%) Ability Strength'),
  buff('crimson-duration', 'Crimson', 'Ability Duration', 0.1, 'duration', '+10% (+15%) Ability Duration'),

  buff('azure-health', 'Azure', 'Max Health', 150, 'health', '+150 (+225) Max Health'),
  buff('azure-shields', 'Azure', 'Shield Capacity', 150, 'shields', '+150 (+225) Shield Capacity'),
  buff('azure-energy', 'Azure', 'Max Energy', 50, 'energy', '+50 (+75) Energy Max. "Flat value increase after all bonuses are applied"'),
  buff('azure-armor', 'Azure', 'Armor', 150, 'armor', '+150 (+225) Armor'),
  buff('azure-regen', 'Azure', 'Health Regen /s', 5, 'none', '+5 (+7.5) Health regenerated per second'),

  buff('amber-starting-energy', 'Amber', 'Starting Energy', 0.3, 'none', '+30% (+45%) Max Energy filled on spawn'),
  buff('amber-health-orbs', 'Amber', 'Health Orb Effectiveness', 1, 'none', '+100% (+150%) Health Orb effectiveness'),
  buff('amber-energy-orbs', 'Amber', 'Energy Orb Effectiveness', 0.5, 'none', '+50% (+75%) Energy Orb effectiveness'),
  buff('amber-casting', 'Amber', 'Casting Speed', 0.25, 'none', '+25% (+37.5%) Casting Speed'),
  buff('amber-parkour', 'Amber', 'Parkour Velocity', 0.15, 'none', '+15% (+22.5%) Parkour Velocity'),

  buff('violet-melee-cd', 'Violet', 'Melee Critical Damage (x2 above 500 Energy)', 0.25, 'violetMeleeCritDamage',
    'Gain +25% (+37.5%) Melee Critical Damage. When Max Energy is over 500, the damage boost doubles. (501 or more)'),
  buff('violet-primary-electricity', 'Violet', 'Primary Electricity Damage', 0.3, 'primaryElectricity',
    'Gain +30% (+45%) Primary Electricity Damage. Gain an additional +10% (+15%) per Crimson, Azure, or Violet Archon Shard equipped.',
    { perShard: { normal: 0.1, tauforged: 0.15 } }),
  buff('violet-ability-electricity', 'Violet', 'Ability Damage vs Electricity', 0.1, 'none', 'Gain +10% (+15%) Ability Damage on enemies affected by Electricity Status'),
  buff('violet-orbs', 'Violet', 'Orb conversion', 0.2, 'none', 'Health and Energy pickup conversion'),

  buff('topaz-secondary-cc', 'Topaz', 'Secondary Crit Chance per Heat kill (at max)', 0.5, 'topazSecondaryCritChance',
    'Increase Secondary Critical Chance by 1% (1.5%) every time you kill an enemy affected by Heat Status. Max 50% (75%).'),
  buff('topaz-ability-radiation', 'Topaz', 'Ability Damage vs Radiation', 0.1, 'none', '+10% (+15%) Ability Damage vs. Radiation-affected enemies'),
  buff('topaz-blast-health', 'Topaz', 'Max Health per Blast kill', 300, 'none', 'Gain 1 (2) Max Health per Blast kill, max 300 (450)'),
  buff('topaz-blast-shield', 'Topaz', 'Shield regen per Blast kill', 5, 'none', 'Regenerate 5 (7.5) Shield per Blast kill'),

  buff('emerald-toxin-status', 'Emerald', 'Toxin Status Damage', 0.3, 'toxinStatusDamage', '+30% (+45%) Toxin Status damage'),
  buff('emerald-corrosion-stacks', 'Emerald', 'Max Corrosion stacks', 2, 'none', '+2 (+3) max Corrosion stacks'),
  buff('emerald-ability-corrosion', 'Emerald', 'Ability Damage vs Corrosion', 0.1, 'none', '+10% (+15%) Ability Damage vs. Corrosion-affected enemies'),
  buff('emerald-toxin-heal', 'Emerald', 'Health per Toxin tick', 2, 'none', 'Recover 2 (3) Health per Toxin tick'),
]
export const shardBuffsById = new Map(SHARD_BUFFS.map((shard) => [shard.id, shard]))
export const SHARD_COLORS: ShardColor[] = ['Crimson', 'Azure', 'Amber', 'Violet', 'Topaz', 'Emerald']
export const SHARD_SLOTS = 5
export const VIOLET_ENERGY_THRESHOLD = 500 // "does NOT trigger at 500 Maximum Energy, you must have 501 or more"

export interface ShardSlot {
  buffId: string
  tauforged: boolean
}

// what the shards do to weapons, handed to the damage calc
export interface ShardWeaponBonus {
  meleeCritDamage: number
  primaryStatusChance: number
  secondaryCritChance: number
  primaryElectricity: number
  toxinStatusDamage: number
}
export const NO_SHARD_BONUS: ShardWeaponBonus = { meleeCritDamage: 0, primaryStatusChance: 0, secondaryCritChance: 0, primaryElectricity: 0, toxinStatusDamage: 0 }

export interface ShardTotals {
  weapon: ShardWeaponBonus
  strength: number
  duration: number
  energy: number // flat
  armor: number
  health: number
  shields: number
  violetDoubled: boolean
  lines: string[]
}

const fmt = (value: number) => `${Math.round(value * 1000) / 10}%`

// maxEnergyBeforeShards: rank-30 energy x (1 + Flow etc.), the Azure flat bonus goes on top before the 500 check
export function shardTotals(slots: (ShardSlot | null)[], maxEnergyBeforeShards: number): ShardTotals {
  const totals: ShardTotals = { weapon: { ...NO_SHARD_BONUS }, strength: 0, duration: 0, energy: 0, armor: 0, health: 0, shields: 0, violetDoubled: false, lines: [] }
  const picked = slots.flatMap((slot) => {
    const shard = slot && shardBuffsById.get(slot.buffId)
    return shard ? [{ shard, value: slot.tauforged ? shard.tauforged : shard.normal, tauforged: slot.tauforged }] : []
  })
  for (const { shard, value } of picked) if (shard.effect === 'energy') totals.energy += value
  totals.violetDoubled = maxEnergyBeforeShards + totals.energy > VIOLET_ENERGY_THRESHOLD
  const electricityColors = picked.filter(({ shard }) => shard.color === 'Crimson' || shard.color === 'Azure' || shard.color === 'Violet').length

  for (const { shard, value, tauforged } of picked) {
    switch (shard.effect) {
      case 'strength': totals.strength += value; break
      case 'duration': totals.duration += value; break
      case 'armor': totals.armor += value; break
      case 'health': totals.health += value; break
      case 'shields': totals.shields += value; break
      case 'meleeCritDamage': totals.weapon.meleeCritDamage += value; break
      case 'violetMeleeCritDamage': totals.weapon.meleeCritDamage += value * (totals.violetDoubled ? 2 : 1); break
      case 'primaryStatusChance': totals.weapon.primaryStatusChance += value; break
      case 'secondaryCritChance': case 'topazSecondaryCritChance': totals.weapon.secondaryCritChance += value; break
      case 'toxinStatusDamage': totals.weapon.toxinStatusDamage += value; break
      case 'primaryElectricity': {
        // I count every Crimson/Azure/Violet shard equipped, this one included
        const extra = shard.perShard ? (tauforged ? shard.perShard.tauforged : shard.perShard.normal) * electricityColors : 0
        totals.weapon.primaryElectricity += value + extra
        break
      }
    }
  }
  const { weapon } = totals
  if (totals.strength) totals.lines.push(`+${fmt(totals.strength)} strength`)
  if (totals.duration) totals.lines.push(`+${fmt(totals.duration)} duration`)
  if (weapon.meleeCritDamage) totals.lines.push(`+${fmt(weapon.meleeCritDamage)} melee crit damage${picked.some(({ shard }) => shard.effect === 'violetMeleeCritDamage') ? (totals.violetDoubled ? ' (Violet doubled)' : ' (Violet not doubled, 500 Energy or less)') : ''}`)
  if (weapon.primaryStatusChance) totals.lines.push(`+${fmt(weapon.primaryStatusChance)} primary status chance`)
  if (weapon.secondaryCritChance) totals.lines.push(`+${fmt(weapon.secondaryCritChance)} secondary crit chance`)
  if (weapon.primaryElectricity) totals.lines.push(`+${fmt(weapon.primaryElectricity)} primary Electricity`)
  if (weapon.toxinStatusDamage) totals.lines.push(`+${fmt(weapon.toxinStatusDamage)} Toxin status damage`)
  if (totals.energy) totals.lines.push(`+${totals.energy} energy`)
  if (totals.armor) totals.lines.push(`+${totals.armor} armor`)
  if (totals.health) totals.lines.push(`+${totals.health} health`)
  if (totals.shields) totals.lines.push(`+${totals.shields} shields`)
  return totals
}

// rank-30 energy (wiki Energy table). most frames are rank 0 + 50, these aren't
const RANK30_ENERGY: Record<string, number> = {
  'Baruuk': 300, 'Baruuk Prime': 300, 'Chroma Prime': 300, 'Dante': 270, 'Garuda': 240, 'Garuda Prime': 320,
  'Hildryn': 0, 'Hildryn Prime': 0, 'Koumei': 222, 'Lavos': 0, 'Lavos Prime': 0, 'Narin': 290, 'Saryn Prime': 300,
  'Volt Prime': 300, 'Wisp': 300, 'Wisp Prime': 300, 'Xaku': 230, 'Xaku Prime': 251, 'Yareli': 300, 'Yareli Prime': 315,
}
export const rank30Energy = (frame: { name: string; energy: number }) =>
  RANK30_ENERGY[frame.name] ?? (frame.energy > 0 ? frame.energy + 50 : 0)
