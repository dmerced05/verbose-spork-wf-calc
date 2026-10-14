// your Warframe: pick the frame, mod it like the in-game screen (2x4 grid, aura, exilus; Jade gets two auras),
// and the panel works out Ability Strength, armor and squad auras from the mods. abilities scale with that strength
// (yours) or a teammate's strength (other frames' abilities in the squad)
import { useEffect, useMemo, useState } from 'react'
import type { SlotPolarity } from '../calc/capacity'
import { GLADIATOR_MAX_PIECES } from '../calc/constants'
import { warframeStateFor, warframeTotals, type WarframeBuild } from '../calc/warframeStats'
import { getWarframeMods, isAuraMod, modsById, warframeBaseName, warframes, warframesById } from '../data'
import { WARFRAME_ABILITIES, abilityApplies, scaledValue, strengthFor, type AbilityEffect, type WarframeAbility, type WarframeState } from '../data/warframeAbilities'
import type { Buffs, Warframe } from '../types'
import { AURA_SLOT_START, EXILUS_SLOT, ModSlots, TOTAL_SLOTS, type ModSlot } from './ModSlots'
import { SearchSelect } from './SearchSelect'

interface Props {
  buffs: Buffs
  isMelee: boolean
  onBuffsChange: (buffs: Buffs) => void
  onWarframeChange: (state: WarframeState, corrosiveProjections: number) => void
}

const percent = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`
const frameOptions = warframes.map((frame) => ({ id: frame.uniqueName, label: frame.name }))
const defaultFrameId = warframes.find((frame) => frame.name === 'Excalibur')?.uniqueName ?? warframes[0].uniqueName

const slotCountFor = (frame: Warframe) => TOTAL_SLOTS + Math.max(1, frame.auraPolarities.length)
const emptySlotsFor = (frame: Warframe) => Array<ModSlot | null>(slotCountFor(frame)).fill(null)
// pre-installed polarities fill the first slots, then exilus, then the aura slot(s)
const polaritiesFor = (frame: Warframe): SlotPolarity[] =>
  Array.from({ length: slotCountFor(frame) }, (_, index) => {
    if (index < EXILUS_SLOT) return (frame.polarities[index] ?? null) as SlotPolarity
    if (index === EXILUS_SLOT) return (frame.exilusPolarity ?? null) as SlotPolarity
    return (frame.auraPolarities[index - AURA_SLOT_START] ?? null) as SlotPolarity
  })

// "+87.5% faction damage" at the strength the ability uses
function describe(effect: AbilityEffect, value: number) {
  switch (effect.kind) {
    case 'factionDamage': return `+${percent(value)} faction damage`
    case 'damageMultiplier': return `×${(1 + value).toFixed(2)} damage`
    case 'baseDamage': return `+${percent(value)} damage (like Serration)`
    case 'element': return `+${percent(value)} ${effect.damageType}${effect.combines ? '' : ' (doesn\'t combine)'}`
    case 'extraHit': return `+${percent(value)} as a separate ${effect.damageType} hit`
    case 'attackSpeed': return `+${percent(value)} attack speed`
    case 'flatCritChance': return `+${percent(value)} crit chance after mods`
    case 'critDamageMultiplier': return `×${(1 + value).toFixed(1)} crit damage`
  }
}

export function WarframePanel({ buffs, isMelee, onBuffsChange, onWarframeChange }: Props) {
  const [frameId, setFrameId] = useState(defaultFrameId)
  const frame = warframesById.get(frameId)!
  const [slots, setSlots] = useState(() => emptySlotsFor(frame))
  const [polarities, setPolarities] = useState(() => polaritiesFor(frame))
  const [hasReactor, setHasReactor] = useState(true)
  const [extraStrength, setExtraStrength] = useState(0)
  const [extraArmor, setExtraArmor] = useState(0)
  const [teammateStrength, setTeammateStrength] = useState(1)
  const [abilities, setAbilities] = useState<Record<string, boolean>>({})

  const compatibleMods = useMemo(() => getWarframeMods(frame), [frame])
  const build: WarframeBuild = {
    frame,
    mods: slots.flatMap((slot) => (slot ? [{ mod: modsById.get(slot.modId)!, rank: slot.rank }] : [])),
    extraStrength,
    extraArmor,
    teammateStrength,
    abilities,
  }
  const totals = warframeTotals(build)
  const state = warframeStateFor(build, totals)

  // push the derived numbers up to the calculator whenever they change
  const stateKey = JSON.stringify([state, totals.corrosiveProjections])
  useEffect(() => onWarframeChange(state, totals.corrosiveProjections), [stateKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickFrame = (id: string | null) => {
    if (!id) return
    const next = warframesById.get(id)!
    setFrameId(id)
    setSlots(emptySlotsFor(next)) // augments and slot counts differ per frame
    setPolarities(polaritiesFor(next))
  }

  const baseName = warframeBaseName(frame.name)
  // your frame's abilities first, then what teammates can bring
  const sorted = [...WARFRAME_ABILITIES].sort((a, b) => Number(b.warframe === baseName) - Number(a.warframe === baseName))
  const renderAbility = (ability: WarframeAbility) => {
    const yours = ability.warframe === baseName
    const applies = abilityApplies(ability, isMelee) && (!ability.selfOnly || yours)
    const on = Boolean(abilities[ability.id])
    const strength = strengthFor(ability, state)
    return (
      <label key={ability.id} className={`ability ${on ? 'active' : ''} ${applies ? '' : 'inactive'}`} title={`“${ability.quote}”${ability.note ? `\n${ability.note}` : ''}`}>
        <input type="checkbox" checked={on} onChange={(event) => setAbilities({ ...abilities, [ability.id]: event.target.checked })} />
        <span className="ability-name">{ability.name}</span>
        <span className="muted-inline">{ability.warframe} · {yours ? 'yours' : ability.selfOnly ? `needs ${ability.warframe}` : 'teammate'}</span>
        <span className="ability-effect">
          {ability.effects.map((effect) => describe(effect, scaledValue(ability, effect.value, strength))).join(' · ')}
          {ability.scalesWithStrength ? ` (at ${percent(strength)} strength)` : ''}
          {!abilityApplies(ability, isMelee) && ` · ${ability.appliesTo === 'melee' ? 'melee only' : 'guns only'}`}
        </span>
      </label>
    )
  }

  return (
    <section className="panel warframe-panel">
      <div className="row spread">
        <h2>Warframe</h2>
        <div className="row">
          <SearchSelect options={frameOptions} selectedId={frameId} onSelect={pickFrame} placeholder="Search Warframes" />
        </div>
      </div>

      <div className="warframe-stats">
        <div><span className="label">Ability Strength</span><span className="value">{percent(totals.abilityStrength)}</span></div>
        <div><span className="label">Armor</span><span className="value">{totals.armor.toLocaleString()}</span></div>
        <div><span className="label">Energy</span><span className="value">{frame.energy}</span></div>
        <div><span className="label">Shields</span><span className="value">{frame.shield}</span></div>
      </div>
      {frame.passive && <p className="proc-note">Passive: {frame.passive.replace(/\|[A-Z_]+\|/g, 'X')}</p>}

      <ModSlots
        weaponName={frame.name}
        capacityLabel="Orokin Reactor"
        isMelee={isMelee}
        compatibleMods={compatibleMods}
        compatibleArcanes={[]}
        slots={slots}
        arcaneSlot={null}
        polarities={polarities}
        hasCatalyst={hasReactor}
        auraCount={frame.auraPolarities.length || 1}
        showArcane={false}
        isAura={isAuraMod}
        onSlotsChange={setSlots}
        onArcaneChange={() => {}}
        onPolaritiesChange={setPolarities}
        onCatalystChange={setHasReactor}
      />

      <div className="form-grid">
        <label title="Archon Shards, arcanes, anything not in the mods (+%)">
          Extra Ability Strength %
          <input type="number" step={1} value={Math.round(extraStrength * 100)} onChange={(event) => setExtraStrength(Number(event.target.value) / 100)} />
        </label>
        <label title="Flat armor from Archon Shards etc. Feeds Primary Bulwark (+1% damage per armor past 1,000)">
          Extra armor
          <input type="number" min={0} step={10} value={extraArmor} onChange={(event) => setExtraArmor(Math.max(0, Number(event.target.value)))} />
        </label>
        <label title="Strength used for abilities from other Warframes in your squad (Roar from a teammate's Rhino, ...)">
          Teammate strength %
          <input type="number" min={0} step={1} value={Math.round(teammateStrength * 100)} onChange={(event) => setTeammateStrength(Math.max(0, Number(event.target.value)) / 100)} />
        </label>
        <label title="Gladiator mods on your Warframe count toward the set bonus with the ones on your melee weapon (+10% crit chance per piece per combo multiplier)">
          Gladiator pieces
          <input
            type="number" min={0} max={GLADIATOR_MAX_PIECES - 3} value={buffs.gladiatorWarframePieces ?? 0}
            onChange={(event) => onBuffsChange({ ...buffs, gladiatorWarframePieces: Math.min(GLADIATOR_MAX_PIECES - 3, Math.max(0, Number(event.target.value))) })}
          />
        </label>
      </div>
      {totals.lines.length > 0 && <p className="proc-note">From mods: {totals.lines.join(' · ')}</p>}

      <h3>Abilities and passives</h3>
      <div className="ability-list">{sorted.map(renderAbility)}</div>
      <p className="muted">
        Max-rank wiki values × Ability Strength (yours for your frame's abilities, the teammate strength for the rest). Hover an ability
        for the wiki line. The leaderboard scenario has no Warframe, so none of this changes the rankings.
      </p>
    </section>
  )
}
