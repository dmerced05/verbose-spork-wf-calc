import { useMemo, useState } from 'react'
import { auraCapacity, capacityFor, modDrain, nextPolarity, type SlotPolarity } from '../calc/capacity'
import { defaultConditionalStacks, maxConditionalStacks, raisesFireRate } from '../calc/parseMod'
import { blockingMod } from '../calc/modConflicts'
import { arcanesById, modsById } from '../data'
import type { Arcane, Mod } from '../types'
import { PolarityIcon } from './PolarityIcon'
import { IMAGE_BASE } from './Thumb' // WFCD's image CDN, keyed by the imageName in warframe-items

export interface ModSlot {
  modId: string
  rank: number
  conditionalStacks: number
}

export interface ArcaneSlot {
  arcaneId: string
  rank: number
  conditionalStacks: number
}

// 8 normal slots in a 2x4 grid like the game, then exilus, then the arcane slot
export const NORMAL_SLOT_COUNT = 8
export const EXILUS_SLOT = 8
export const TOTAL_SLOTS = 9
// arcane slots are selected as 100, 101... (only for selection, the arcanes live in their own state)
const ARCANE_SLOT = 100
// Warframes: aura slots come after the exilus (index 9, Jade's second aura 10)
export const AURA_SLOT_START = TOTAL_SLOTS


interface Props {
  weaponName: string // shown in the header ("Upgrades: Braton Prime")
  capacityLabel?: string // 'Orokin Catalyst' for weapons, 'Orokin Reactor' for Warframes
  auraCount?: number // Warframes: 1 aura slot (Jade 2)
  isAura?: (mod: Mod) => boolean
  isMelee: boolean // melee-kill triggers (Dexterity) start at half stacks on guns
  compatibleMods: Mod[]
  compatibleArcanes: Arcane[]
  slots: (ModSlot | null)[]
  arcaneSlots: (ArcaneSlot | null)[] // weapons have one arcane slot, Warframes two, [] = none
  polarities: SlotPolarity[]
  hasCatalyst: boolean
  onSlotsChange: (slots: (ModSlot | null)[]) => void
  onArcanesChange: (arcaneSlots: (ArcaneSlot | null)[]) => void
  onPolaritiesChange: (polarities: SlotPolarity[]) => void
  onCatalystChange: (hasCatalyst: boolean) => void
  // weapons that take a riven: the synthesized riven Mod (src/calc/riven.ts) and its editor
  riven?: { mod: Mod; editor: React.ReactNode } | null
}

const maxRankOf = (levelStats: string[][]) => levelStats.length - 1
const statLinesAt = (levelStats: string[][], rank: number) =>
  (levelStats[rank] ?? levelStats.at(-1) ?? [])
    // arcanes repeat passive lines inside the full description, so only show the first block
    .slice(0, 1).concat((levelStats[rank] ?? []).slice(1).filter((line) => !(levelStats[rank]?.[0] ?? '').includes(line)))
    .map((line) => line.replace(/\\n/g, ' ').replace(/\s*\+1 Arcane Revive/g, '').trim())
    .filter(Boolean)

function ModArt({ imageName }: { imageName: string | null }) {
  if (!imageName) return null
  return (
    <img
      className="mod-art" src={IMAGE_BASE + imageName} alt="" loading="lazy"
      onError={(event) => (event.currentTarget.style.display = 'none')}
    />
  )
}

function RankPips({ rank, maxRank }: { rank: number; maxRank: number }) {
  return (
    <div className="rank-pips" aria-label={`rank ${rank} of ${maxRank}`}>
      {Array.from({ length: maxRank }, (_, pip) => (
        <span key={pip} className={pip < rank ? 'filled' : ''} />
      ))}
    </div>
  )
}

interface CardShellProps {
  selected: boolean
  rarity: string | null
  isEmpty: boolean
  extraClass?: string
  onSelect: () => void
  children: React.ReactNode
}

function CardShell({ selected, rarity, isEmpty, extraClass = '', onSelect, children }: CardShellProps) {
  return (
    <div
      className={`mod-card ${extraClass} ${selected ? 'selected' : ''} ${isEmpty ? 'empty' : `rarity-${(rarity ?? 'common').toLowerCase()}`}`}
      role="button" tabIndex={0} onClick={onSelect}
      onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && onSelect()}
    >
      {children}
    </div>
  )
}

const RemoveButton = ({ onRemove }: { onRemove: () => void }) => (
  <button className="remove" title="Remove" onClick={(event) => { event.stopPropagation(); onRemove() }}>×</button>
)

interface ModCardProps {
  slot: ModSlot | null
  mod: Mod | undefined
  conflictWith: string | null // another equipped mod this one can't go with (old/loaded builds)
  slotPolarity: SlotPolarity
  isExilusSlot: boolean
  isAuraSlot?: boolean
  selected: boolean
  onSelect: () => void
  onCyclePolarity: () => void
  onRemove: () => void
}

function ModCard({ slot, mod, conflictWith, slotPolarity, isExilusSlot, isAuraSlot, selected, onSelect, onCyclePolarity, onRemove }: ModCardProps) {
  // auras add capacity (shown as +N), everything else uses it
  const auraBonus = mod && slot && isAuraSlot ? auraCapacity(mod.baseDrain, slot.rank, mod.polarity, slotPolarity) : 0
  const drain = mod && slot ? (isAuraSlot ? -auraBonus : modDrain(mod.baseDrain, slot.rank, mod.polarity, slotPolarity)) : 0
  const rawDrain = mod && slot ? (isAuraSlot ? -(Math.abs(mod.baseDrain) + slot.rank) : mod.baseDrain + slot.rank) : 0
  const drainClass = drain < rawDrain ? 'matched' : drain > rawDrain ? 'mismatched' : ''

  return (
    <CardShell selected={selected} rarity={mod?.rarity ?? null} isEmpty={!mod} extraClass={conflictWith ? 'conflict' : ''} onSelect={onSelect}>
      <div className="mod-card-top">
        <button
          className="polarity-button" title={`Slot polarity: ${slotPolarity ?? 'none'} (click to change)`}
          onClick={(event) => { event.stopPropagation(); onCyclePolarity() }}
        >
          <PolarityIcon polarity={slotPolarity} />
        </button>
        {mod && (
          <span className={`drain ${drainClass}`} title={isAuraSlot ? `Adds ${auraBonus} capacity` : `Drain ${drain} (base ${rawDrain})`}>
            {isAuraSlot ? `+${auraBonus}` : drain} <PolarityIcon polarity={mod.polarity} size={11} />
          </span>
        )}
      </div>
      {mod && slot ? (
        <>
          <ModArt imageName={mod.imageName} />
          <div className="mod-name">
            {mod.name}
            {raisesFireRate(mod.levelStats, slot.rank) && <span className="fr-tag" title="Fire rate / attack speed mod">FR</span>}
          </div>
          <ul className="mod-lines">
            {statLinesAt(mod.levelStats, slot.rank).map((line) => <li key={line}>{line}</li>)}
          </ul>
          <RankPips rank={slot.rank} maxRank={mod.fusionLimit} />
          {conflictWith && <div className="conflict-label">Can't go with {conflictWith}</div>}
          <RemoveButton onRemove={onRemove} />
        </>
      ) : (
        <div className="empty-label">{isExilusSlot ? 'EXILUS' : isAuraSlot ? 'AURA' : ''}</div>
      )}
    </CardShell>
  )
}

interface ArcaneCardProps {
  slot: ArcaneSlot | null
  selected: boolean
  onSelect: () => void
  onRemove: () => void
}

function ArcaneCard({ slot, selected, onSelect, onRemove }: ArcaneCardProps) {
  const arcane = slot ? arcanesById.get(slot.arcaneId) : undefined
  return (
    <CardShell selected={selected} rarity={arcane?.rarity ?? null} isEmpty={!arcane} extraClass="arcane-card" onSelect={onSelect}>
      {arcane && slot ? (
        <>
          <ModArt imageName={arcane.imageName} />
          <div className="arcane-label">Arcane</div>
          <div className="mod-name">{arcane.name}</div>
          <ul className="mod-lines">
            {statLinesAt(arcane.levelStats, slot.rank).map((line) => <li key={line}>{line}</li>)}
          </ul>
          <RankPips rank={slot.rank} maxRank={maxRankOf(arcane.levelStats)} />
          <RemoveButton onRemove={onRemove} />
        </>
      ) : (
        <div className="empty-label">ARCANE</div>
      )}
    </CardShell>
  )
}

export function ModSlots(props: Props) {
  const {
    weaponName, isMelee, compatibleMods, compatibleArcanes, slots, arcaneSlots, polarities, hasCatalyst,
    onSlotsChange, onArcanesChange, onPolaritiesChange, onCatalystChange,
    capacityLabel = 'Orokin Catalyst', auraCount = 0, isAura = () => false, riven = null,
  } = props
  // the riven isn't in the mod data, it's built from the user's stats
  const modFor = (modId: string) => (riven && modId === riven.mod.uniqueName ? riven.mod : modsById.get(modId))
  const rivenEquipped = Boolean(riven && slots.some((slot) => slot?.modId === riven.mod.uniqueName))
  const isAuraIndex = (index: number) => index >= AURA_SLOT_START && index < AURA_SLOT_START + auraCount
  // nothing selected = no mod browser. clicking a slot opens it, clicking it again (or Close / Esc) hides it
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const toggleSlot = (index: number) => setSelectedSlot(selectedSlot === index ? null : index)
  const [search, setSearch] = useState('')
  const arcaneIndex = selectedSlot !== null && selectedSlot >= ARCANE_SLOT ? selectedSlot - ARCANE_SLOT : null
  const arcaneSelected = arcaneIndex !== null
  const arcaneSlot = arcaneIndex !== null ? arcaneSlots[arcaneIndex] ?? null : null
  const setArcane = (index: number, next: ArcaneSlot | null) => onArcanesChange(arcaneSlots.map((slot, other) => (other === index ? next : slot)))
  const exilusSelected = selectedSlot === EXILUS_SLOT
  const auraSelected = selectedSlot !== null && isAuraIndex(selectedSlot)

  // auras add to the capacity, every other slot uses it
  const auraBonus = slots.reduce((total, slot, index) => {
    const mod = slot && isAuraIndex(index) ? modFor(slot.modId) : undefined
    return mod && slot ? total + auraCapacity(mod.baseDrain, slot.rank, mod.polarity, polarities[index]) : total
  }, 0)
  const capacity = capacityFor(hasCatalyst) + auraBonus
  const usedCapacity = slots.reduce((total, slot, index) => {
    const mod = slot && !isAuraIndex(index) ? modFor(slot.modId) : undefined
    return mod && slot ? total + modDrain(mod.baseDrain, slot.rank, mod.polarity, polarities[index]) : total
  }, 0)

  const updateSlot = (index: number, slot: ModSlot | null) => {
    const nextSlots = [...slots]
    nextSlots[index] = slot
    onSlotsChange(nextSlots)
  }
  const cyclePolarity = (index: number) => {
    const nextPolarities = [...polarities]
    nextPolarities[index] = nextPolarity(polarities[index])
    onPolaritiesChange(nextPolarities)
  }

  // same-named mods can't stack in game, so the browser dedupes by name and hides equipped ones
  const uniqueMods = useMemo(() => {
    const byName = new Map<string, Mod>()
    for (const mod of compatibleMods) {
      const existing = byName.get(mod.name)
      if (!existing || mod.fusionLimit > existing.fusionLimit) byName.set(mod.name, mod)
    }
    return [...byName.values()]
  }, [compatibleMods])
  const equippedNames = new Set(slots.flatMap((slot) => (slot ? [modFor(slot.modId)!.name] : [])))
  // incompatible pairs (Serration + Spectral Serration, Hell's Chamber + Galvanized Hell...). the mod in the slot
  // being filled doesn't count, since picking a new one replaces it
  const equippedExcept = (skipIndex: number) =>
    slots.flatMap((slot, index) => (slot && index !== skipIndex ? [modFor(slot.modId)!] : []))
  const othersForSelected = equippedExcept(selectedSlot ?? -1)
  const blockerFor = (mod: Mod) => blockingMod(mod, othersForSelected)

  // name matches first (starts-with before contains), then things that only match on a stat line
  const searchText = search.trim().toLowerCase()
  const searchRank = (name: string, levelStats: string[][]) => {
    if (!searchText) return 0
    const lowerName = name.toLowerCase()
    if (lowerName.startsWith(searchText)) return 0
    if (lowerName.includes(searchText)) return 1
    return (levelStats.at(-1) ?? []).some((line) => line.toLowerCase().includes(searchText)) ? 2 : -1
  }
  const bySearch = <T extends { name: string; levelStats: string[][] }>(items: T[]) =>
    items
      .map((item) => ({ item, rank: searchRank(item.name, item.levelStats) }))
      .filter(({ rank }) => rank !== -1)
      .sort((a, b) => a.rank - b.rank)
      .map(({ item }) => item)

  const browserMods = arcaneSelected || selectedSlot === null
    ? []
    : bySearch(uniqueMods.filter((mod) =>
        // aura slots only take auras, exilus only exilus mods, auras go nowhere else
        !equippedNames.has(mod.name) && (auraSelected ? isAura(mod) : !isAura(mod) && (!exilusSelected || mod.isExilus)))
      )
        // incompatible ones stay listed (greyed out, at the end) so it's clear why they can't go in
        .map((mod) => ({ mod, blocker: blockerFor(mod) }))
        .sort((a, b) => Number(Boolean(a.blocker)) - Number(Boolean(b.blocker)))
  // the same arcane can't go in twice
  const equippedArcaneIds = new Set(arcaneSlots.flatMap((slot) => (slot ? [slot.arcaneId] : [])))
  const browserArcanes = arcaneSelected ? bySearch(compatibleArcanes.filter((arcane) => !equippedArcaneIds.has(arcane.uniqueName))) : []

  const equipMod = (mod: Mod) => {
    if (selectedSlot === null) return
    updateSlot(selectedSlot, { modId: mod.uniqueName, rank: mod.fusionLimit, conditionalStacks: defaultConditionalStacks(mod.levelStats, mod.fusionLimit, { isMelee, bodyShots: false }) })
    // jump to the next empty normal slot so filling a build is quick
    if (!exilusSelected && !auraSelected) {
      const nextEmpty = slots.findIndex((slot, index) => index < NORMAL_SLOT_COUNT && index !== selectedSlot && !slot)
      if (nextEmpty !== -1) setSelectedSlot(nextEmpty)
    }
  }
  const equipArcane = (arcane: Arcane) => {
    const maxRank = maxRankOf(arcane.levelStats)
    if (arcaneIndex === null) return
    setArcane(arcaneIndex, { arcaneId: arcane.uniqueName, rank: maxRank, conditionalStacks: defaultConditionalStacks(arcane.levelStats, maxRank, { isMelee, bodyShots: false }) })
  }

  // the selected thing's controls (rank, conditional stacks) work the same for mods and the arcane
  const selectedMod = !arcaneSelected && selectedSlot !== null && slots[selectedSlot] ? modFor(slots[selectedSlot]!.modId) : undefined
  const selectedArcane = arcaneSelected && arcaneSlot ? arcanesById.get(arcaneSlot.arcaneId) : undefined
  const selectedState = arcaneSelected ? arcaneSlot : selectedSlot !== null ? slots[selectedSlot] : null
  const selectedItem = selectedMod ?? selectedArcane
  const selectedMaxRank = selectedMod ? selectedMod.fusionLimit : selectedArcane ? maxRankOf(selectedArcane.levelStats) : 0
  const updateSelected = (changes: { rank?: number; conditionalStacks?: number }) => {
    if (arcaneIndex !== null && arcaneSlot) setArcane(arcaneIndex, { ...arcaneSlot, ...changes })
    else if (selectedSlot !== null && slots[selectedSlot]) updateSlot(selectedSlot, { ...slots[selectedSlot]!, ...changes })
  }
  const selectedMaxStacks = selectedItem && selectedState ? maxConditionalStacks(selectedItem.levelStats, selectedState.rank) : 0

  const renderArcaneCard = (index: number) => (
    <ArcaneCard
      key={`arcane-${index}`}
      slot={arcaneSlots[index]}
      selected={arcaneIndex === index}
      onSelect={() => toggleSlot(ARCANE_SLOT + index)}
      onRemove={() => setArcane(index, null)}
    />
  )

  const renderModCard = (index: number) => (
    <ModCard
      key={index}
      slot={slots[index]}
      mod={slots[index] ? modFor(slots[index]!.modId) : undefined}
      conflictWith={(() => {
        const mod = slots[index] ? modFor(slots[index]!.modId) : undefined
        return mod ? blockingMod(mod, equippedExcept(index))?.name ?? null : null
      })()}
      slotPolarity={polarities[index]}
      isExilusSlot={index === EXILUS_SLOT}
      isAuraSlot={isAuraIndex(index)}
      selected={selectedSlot === index}
      onSelect={() => toggleSlot(index)}
      onCyclePolarity={() => cyclePolarity(index)}
      onRemove={() => updateSlot(index, null)}
    />
  )

  return (
    <section className="panel upgrades">
      <div className="upgrades-header">
        <h2>
          Upgrades: <span className="accent">{weaponName}</span> <span className="muted-inline">Rank 30</span>
        </h2>
        <div className="row">
          <label className="inline-check">
            <input type="checkbox" checked={hasCatalyst} onChange={(event) => onCatalystChange(event.target.checked)} />
            {capacityLabel}
          </label>
          <span className={`capacity ${usedCapacity > capacity ? 'over' : ''}`}>
            Capacity <b>{capacity - usedCapacity}/{capacity}</b>
          </span>
          <button onClick={() => { onSlotsChange(Array(TOTAL_SLOTS + auraCount).fill(null)); onArcanesChange(arcaneSlots.map(() => null)) }}>Clear</button>
        </div>
      </div>

      <div className="mod-layout">
        <div className="mod-grid">{Array.from({ length: NORMAL_SLOT_COUNT }, (_, index) => renderModCard(index))}</div>
        <div className={`side-column ${auraCount > 1 ? 'double-aura' : ''}`}>
          {Array.from({ length: auraCount }, (_, offset) => renderModCard(AURA_SLOT_START + offset))}
          {arcaneSlots.length === 1 && renderArcaneCard(0)}
          {renderModCard(EXILUS_SLOT)}
        </div>
      </div>
      {/* Warframes: two arcane slots in their own row under the grid */}
      {arcaneSlots.length > 1 && <div className="arcane-row">{arcaneSlots.map((_, index) => renderArcaneCard(index))}</div>}

      {selectedItem && selectedState && (
        <div className="selected-mod row">
          <span className="accent">{selectedItem.name}</span>
          <span className="stepper">
            Rank
            <button onClick={() => updateSelected({ rank: Math.max(0, selectedState.rank - 1) })}>−</button>
            {selectedState.rank}/{selectedMaxRank}
            <button onClick={() => updateSelected({ rank: Math.min(selectedMaxRank, selectedState.rank + 1) })}>+</button>
          </span>
          {selectedMaxStacks > 0 && (
            <span className="stepper">
              Conditional stacks
              <button onClick={() => updateSelected({ conditionalStacks: Math.max(0, selectedState.conditionalStacks - 1) })}>−</button>
              {selectedMaxStacks > 20 ? (
                // Primary Bulwark has 500 "stacks" (armor points), typing beats clicking
                <input
                  type="number" min={0} max={selectedMaxStacks} className="stack-input"
                  value={Math.min(selectedState.conditionalStacks, selectedMaxStacks)}
                  onChange={(event) => updateSelected({ conditionalStacks: Math.min(selectedMaxStacks, Math.max(0, Number(event.target.value))) })}
                />
              ) : (
                Math.min(selectedState.conditionalStacks, selectedMaxStacks)
              )}/{selectedMaxStacks}
              <button onClick={() => updateSelected({ conditionalStacks: Math.min(selectedMaxStacks, selectedState.conditionalStacks + 1) })}>+</button>
            </span>
          )}
        </div>
      )}

      {riven && rivenEquipped && riven.editor}

      {selectedSlot === null && <p className="muted-inline slot-hint">Click a slot to add or change a mod.</p>}
      {selectedSlot !== null && (
      <div className="mod-browser" onKeyDown={(event) => event.key === 'Escape' && setSelectedSlot(null)}>
        <div className="row spread">
          <input autoFocus className="mod-search" placeholder={arcaneSelected ? 'Search arcanes' : 'Search mods or stats'} value={search} onChange={(event) => setSearch(event.target.value)} />
          <span className="muted-inline">
            {arcaneSelected
              ? `${browserArcanes.length} arcanes · filling arcane slot${arcaneSlots.length > 1 ? ` ${arcaneIndex! + 1}` : ''}`
              : `${browserMods.length} mods · filling ${
                  exilusSelected ? 'Exilus slot (exilus mods only)' : auraSelected ? 'aura slot (auras only)' : `slot ${selectedSlot + 1}`
                }`}
            <button className="link-button" onClick={() => setSelectedSlot(null)}>Close</button>
          </span>
        </div>
        <div className="browser-grid">
          {riven && !rivenEquipped && !arcaneSelected && !exilusSelected && !auraSelected && !searchText && (
            <button className="browser-card rarity-riven" onClick={() => equipMod(riven.mod)}>
              <span className="browser-top">
                <span className="mod-name">Riven Mod</span>
                <span className="muted-inline">your rolls</span>
              </span>
              <span className="browser-line">Type in your riven's stats. Not used by the optimizer or leaderboard.</span>
            </button>
          )}
          {browserMods.map(({ mod, blocker }) => (
            <button
              key={mod.uniqueName}
              className={`browser-card rarity-${(mod.rarity ?? 'common').toLowerCase()} ${blocker ? 'blocked' : ''}`}
              disabled={Boolean(blocker)}
              title={blocker ? `Can't be equipped with ${blocker.name}` : undefined}
              onClick={() => equipMod(mod)}
            >
              <span className="browser-top">
                <span className="mod-name">{mod.name}</span>
                <span className="drain">{mod.baseDrain + mod.fusionLimit} <PolarityIcon polarity={mod.polarity} size={11} /></span>
              </span>
              <span className="browser-line">{statLinesAt(mod.levelStats, mod.fusionLimit).join(' · ')}</span>
              {mod.isExilus && <span className="exilus-tag">Exilus</span>}
              {raisesFireRate(mod.levelStats, mod.fusionLimit) && <span className="fr-tag" title="Fire rate / attack speed mod">FR</span>}
              {blocker && <span className="conflict-label">Incompatible with {blocker.name}</span>}
            </button>
          ))}
          {browserArcanes.map((arcane) => (
            <button key={arcane.uniqueName} className={`browser-card rarity-${(arcane.rarity ?? 'common').toLowerCase()}`} onClick={() => equipArcane(arcane)}>
              <span className="browser-top">
                <span className="mod-name">{arcane.name}</span>
                <span className="muted-inline">{arcane.type.replace(' Arcane', '')}</span>
              </span>
              <span className="browser-line">{statLinesAt(arcane.levelStats, maxRankOf(arcane.levelStats)).join(' · ')}</span>
            </button>
          ))}
        </div>
      </div>
      )}
    </section>
  )
}
