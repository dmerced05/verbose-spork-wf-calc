// mod capacity + drain, per wiki.warframe.com/w/Polarity
//   matching polarity: drain halved, rounded up
//   mismatched polarity: drain +25%, rounded up
//   universal ("Any") slot matches everything except Umbra

export const WEAPON_SLOT_POLARITIES = [null, 'madurai', 'vazarin', 'naramon', 'zenurik', 'unairu', 'umbra', 'universal'] as const
export type SlotPolarity = (typeof WEAPON_SLOT_POLARITIES)[number]

export const BASE_CAPACITY = 30 // rank 30 weapon
export const capacityFor = (hasCatalyst: boolean) => BASE_CAPACITY * (hasCatalyst ? 2 : 1)

export function modDrain(baseDrain: number, rank: number, modPolarity: string | null, slotPolarity: SlotPolarity): number {
  const drain = baseDrain + rank
  if (!slotPolarity || !modPolarity) return drain
  const matches = slotPolarity === modPolarity || (slotPolarity === 'universal' && modPolarity !== 'umbra')
  return matches ? Math.ceil(drain / 2) : Math.ceil(drain * 1.25)
}

// aura mods add capacity instead of using it (negative base drain). matching polarity doubles the bonus,
// a mismatch takes 20% off (rounded, my reading of the wiki's Polarity page)
export function auraCapacity(baseDrain: number, rank: number, modPolarity: string | null, slotPolarity: SlotPolarity): number {
  const bonus = Math.abs(baseDrain) + rank
  if (!slotPolarity || !modPolarity) return bonus
  const matches = slotPolarity === modPolarity || slotPolarity === 'universal'
  return matches ? bonus * 2 : Math.round(bonus * 0.8)
}

export const nextPolarity = (current: SlotPolarity): SlotPolarity =>
  WEAPON_SLOT_POLARITIES[(WEAPON_SLOT_POLARITIES.indexOf(current) + 1) % WEAPON_SLOT_POLARITIES.length]
