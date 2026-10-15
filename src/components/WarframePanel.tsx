// your Warframe: pick the frame, mod it like the in-game screen (2x4 grid, aura, exilus; Jade gets two auras),
// and the panel works out Ability Strength, armor and squad auras from the mods. under the mods: the frame's 4 abilities,
// one of which can be swapped for a Helminth ability, then the allies' abilities (cast at the teammate strength)
import { useEffect, useMemo, useState } from 'react'
import type { SlotPolarity } from '../calc/capacity'
import { setSummary } from '../calc/modSets'
import { warframeStateFor, warframeTotals, type WarframeBuild } from '../calc/warframeStats'
import { arcanes, arcanesById, getWarframeMods, helminthAbilities, isAuraMod, modsById, warframeBaseName, warframes, warframesById } from '../data'
import {
  SUBSUMABLE, WARFRAME_ABILITIES, abilitiesById, abilityApplies, canSubsumeInto, effectsFor, modeledAbility, modeledVariants, scaledValue,
  helpsAllies, type AbilityCast, type AbilityEffect, type CastBy, type DefenseEffect, type WarframeAbility, type WarframeState,
} from '../data/warframeAbilities'
import type { Warframe, WarframeAbilityInfo, Weapon } from '../types'
import { AURA_SLOT_START, EXILUS_SLOT, ModSlots, TOTAL_SLOTS, type ArcaneSlot, type ModSlot } from './ModSlots'
import { SearchSelect } from './SearchSelect'

interface Props {
  isMelee: boolean
  weapon: Weapon // the calculator's weapon: which abilities apply, and Valkyr Talons switch Hysteria on
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
function describeDefense(effect: DefenseEffect, ability: WarframeAbility, by: CastBy, strength: number, duration: number) {
  if (effect.kind === 'damageReduction') {
    const cap = by === 'helminth' ? effect.helminthCap ?? effect.cap : effect.cap
    // Null Star: particle count from Ability Duration
    const stacks = effect.stacksScaleWithDuration ? Math.round(effect.stacks * duration) : effect.stacks
    const count = effect.stacksScaleWithDuration ? `${stacks} ${effect.stackLabel ?? 'stacks'} at ${percent(duration)} duration, ` : ''
    return `${count}${percent(Math.min(cap, scaledValue(ability, effect.perStack * stacks, strength)))} damage reduction (cap ${percent(cap)})${effect.selfOnly && by === 'ally' ? ', not on you' : ''}`
  }
  return `+${percent(scaledValue(ability, effect.value, strength))} ${effect.kind.replace('Percent', '')}`
}
const effectText = (ability: WarframeAbility, by: CastBy, strength: number, duration = 1) =>
  [
    ...effectsFor(ability, by).map((effect) => describe(effect, scaledValue(ability, effect.value, strength))),
    ...(ability.defense ?? []).map((effect) => describeDefense(effect, ability, by, strength, duration)),
  ].join(' · ') + (ability.scalesWithStrength ? ` (at ${percent(strength)} strength)` : '')
const APPLIES_LABEL = { all: '', melee: 'melee only', guns: 'guns only', primary: 'primaries only' } as const
// the frame's two arcane slots take Warframe arcanes
const WARFRAME_ARCANES = arcanes.filter((arcane) => arcane.type === 'Warframe Arcane')

// everything the Helminth can give: one ability per Warframe plus the Helminth's own
interface SubsumeOption {
  key: string // "Rhino:Roar", "Helminth:Empower"
  name: string
  from: string
  info: WarframeAbilityInfo | undefined
}
const baseFrames = new Map(warframes.map((frame) => [warframeBaseName(frame.name), frame]))
const SUBSUME_OPTIONS: SubsumeOption[] = [
  ...Object.entries(SUBSUMABLE).map(([from, name]) => ({
    key: `${from}:${name}`, name, from, info: baseFrames.get(from)?.abilities.find((ability) => ability.name.toLowerCase() === name.toLowerCase()),
  })),
  ...helminthAbilities.map((info) => ({ key: `Helminth:${info.name}`, name: info.name, from: 'Helminth', info })),
].sort((a, b) => a.name.localeCompare(b.name))
const subsumeByKey = new Map(SUBSUME_OPTIONS.map((option) => [option.key, option]))

// abilities an ally can bring (passives can't be shared)
const ALLY_OPTIONS = WARFRAME_ABILITIES.filter(helpsAllies)

export function WarframePanel({ isMelee, weapon, onWarframeChange }: Props) {
  const [frameId, setFrameId] = useState(defaultFrameId)
  const frame = warframesById.get(frameId)!
  const baseName = warframeBaseName(frame.name)
  const [slots, setSlots] = useState(() => emptySlotsFor(frame))
  const [polarities, setPolarities] = useState(() => polaritiesFor(frame))
  const [hasReactor, setHasReactor] = useState(true)
  const [extraStrength, setExtraStrength] = useState(0)
  const [extraDuration, setExtraDuration] = useState(0)
  const [extraArmor, setExtraArmor] = useState(0)
  const [teammateStrength, setTeammateStrength] = useState(1)
  // the Helminth swap: which of the 4 slots, and what goes in it
  const [helminth, setHelminth] = useState<{ slot: number; key: string } | null>(null)
  const [activeOwn, setActiveOwn] = useState<Record<string, boolean>>({}) // modeled ability id (or 'helminth') -> on
  const [variantPick, setVariantPick] = useState<Record<string, string>>({}) // slot -> picked cast (Thermal Transfer heat/cold/blast)
  const [abilityStacks, setAbilityStacks] = useState<Record<string, number>>({}) // Thrall Pact's Thralls
  const [allies, setAllies] = useState<string[]>([])
  const [arcaneSlots, setArcaneSlots] = useState<(ArcaneSlot | null)[]>([null, null])
  const [shieldInnateDr, setShieldInnateDr] = useState(true)
  const [otherDr, setOtherDr] = useState(0)

  const subsumed = helminth ? subsumeByKey.get(helminth.key) ?? null : null
  const compatibleMods = useMemo(
    () => getWarframeMods(frame, subsumed && subsumed.from !== 'Helminth' ? { warframe: subsumed.from, ability: subsumed.name } : null),
    [frame, subsumed],
  )
  const equippedNames = new Set(slots.flatMap((slot) => (slot ? [modsById.get(slot.modId)!.name] : [])))
  const hasAugment = (ability: WarframeAbility) => !ability.augment || equippedNames.has(ability.augment)

  // the frame's 4 abilities, with the subsumed one swapped in
  const kit = frame.abilities.map((info, index) => {
    if (helminth?.slot === index && subsumed) {
      const from = subsumed.from === 'Helminth' ? '' : subsumed.from
      return { info: subsumed.info ?? { name: subsumed.name, description: '', imageName: null }, replaced: info.name, by: 'helminth' as const,
        variants: from ? modeledVariants(from, subsumed.name) : [], modeled: from ? modeledAbility(from, subsumed.name, variantPick.helminth) : undefined, activeKey: 'helminth' }
    }
    const activeKey = `own:${info.name}`
    return { info, replaced: null, by: 'self' as const, variants: modeledVariants(baseName, info.name), modeled: modeledAbility(baseName, info.name, variantPick[activeKey]), activeKey }
  })
  // passives and passive augments (Biting Frost) have no ability name
  const passives = WARFRAME_ABILITIES.filter((ability) => ability.selfOnly && !ability.ability && ability.warframe === baseName)

  const casts: AbilityCast[] = [
    ...kit.flatMap((entry) => (entry.modeled && activeOwn[entry.activeKey] && hasAugment(entry.modeled) ? [{ id: entry.modeled.id, by: entry.by, stacks: abilityStacks[entry.modeled.id] }] : [])),
    ...passives.filter((passive) => activeOwn[passive.id] && hasAugment(passive)).map((passive) => ({ id: passive.id, by: 'self' as const })),
    ...allies.map((id) => ({ id, by: 'ally' as const })),
    // holding Valkyr Talons means Hysteria is up (Warcry's armor x3)
    ...(baseName === 'Valkyr' && /^Valkyr( Prime)? Talons/.test(weapon.name) && !kit.some((entry) => entry.modeled?.id === 'hysteria' && activeOwn[entry.activeKey])
      ? [{ id: 'hysteria', by: 'self' as const }] : []),
  ]
  const build: WarframeBuild = {
    frame,
    mods: slots.flatMap((slot) => (slot ? [{ mod: modsById.get(slot.modId)!, rank: slot.rank, conditionalStacks: slot.conditionalStacks }] : [])),
    arcanes: arcaneSlots.flatMap((slot) => (slot ? [{ arcane: arcanesById.get(slot.arcaneId)!, rank: slot.rank, conditionalStacks: slot.conditionalStacks }] : [])),
    shieldInnateDr,
    otherDr,
    extraStrength,
    extraDuration,
    extraArmor,
    teammateStrength,
    casts,
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
    setHelminth(null)
    setActiveOwn({})
  }
  const pickSubsume = (slot: number, key: string) => {
    setHelminth(key ? { slot, key } : null)
    setActiveOwn({ ...activeOwn, helminth: false })
  }

  const renderKitEntry = (entry: (typeof kit)[number], index: number) => {
    const { modeled } = entry
    const on = Boolean(modeled && activeOwn[entry.activeKey])
    const applies = modeled ? abilityApplies(modeled, weapon) : false
    const missingAugment = modeled && !hasAugment(modeled)
    // the Helminth list for this slot: not this frame's own ability, and damage buffs only where the game allows
    const slotName = entry.replaced ?? entry.info.name
    const options = SUBSUME_OPTIONS.filter((option) => option.from !== baseName && canSubsumeInto(baseName, slotName, option.name))
    return (
      <div key={index} className={`kit-ability ${entry.by === 'helminth' ? 'subsumed' : ''} ${on && applies && !missingAugment ? 'active' : ''}`}>
        <div className="kit-head">
          <span className="kit-index">{index + 1}</span>
          <span className="ability-name">{entry.info.name}</span>
          {entry.by === 'helminth' && <span className="helminth-tag" title={`Replaces ${entry.replaced}`}>Helminth · from {subsumed?.from}</span>}
          <select
            className="helminth-select" value={helminth?.slot === index ? helminth.key : ''}
            title="Subsume a Helminth ability into this slot (only one slot at a time)"
            onChange={(event) => pickSubsume(index, event.target.value)}
          >
            <option value="">{helminth?.slot === index ? `Restore ${entry.replaced}` : 'Helminth…'}</option>
            {options.map((option) => <option key={option.key} value={option.key}>{option.name} ({option.from})</option>)}
          </select>
        </div>
        {entry.info.description && <div className="kit-description">{entry.info.description}</div>}
        {modeled ? (
          <label className={`kit-effect ${applies ? '' : 'inactive'}`} title={`“${entry.by === 'helminth' && modeled.helminth ? modeled.helminth.quote : modeled.quote}”${modeled.note ? `\n${modeled.note}` : ''}`}>
            <input
              type="checkbox" checked={on} disabled={Boolean(missingAugment)}
              onChange={(event) => setActiveOwn({ ...activeOwn, [entry.activeKey]: event.target.checked })}
            />
            {modeled.name !== entry.info.name ? `${modeled.name}: ` : 'Active: '}
            {effectText(modeled, entry.by, state.abilityStrength, totals.abilityDuration)}
            {entry.by === 'helminth' && modeled.helminth && ' · subsumed value'}
            {!applies && ` · ${APPLIES_LABEL[modeled.appliesTo]}`}
            {missingAugment && ` · equip ${modeled.augment} to use it`}
          </label>
        ) : null}
        {entry.variants.length > 1 && modeled && (
          <label className="inline-number kit-stacks">
            Cast
            <select value={modeled.id} onChange={(event) => setVariantPick({ ...variantPick, [entry.activeKey]: event.target.value })}>
              {entry.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.variant ?? variant.name}</option>)}
            </select>
          </label>
        )}
        {modeled?.stacks ? (
          <label className="inline-number kit-stacks">
            {modeled.stacks.label}
            <input
              type="number" min={0} max={modeled.stacks.max} value={abilityStacks[modeled.id] ?? modeled.stacks.default}
              onChange={(event) => setAbilityStacks({ ...abilityStacks, [modeled.id]: Math.min(modeled.stacks!.max, Math.max(0, Number(event.target.value))) })}
            />
          </label>
        ) : null}
        {!modeled && <div className="kit-effect inactive">No weapon buff modeled</div>}
      </div>
    )
  }

  const allyOptions = ALLY_OPTIONS.filter((ability) => !allies.includes(ability.id))

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
        <div><span className="label">Ability Duration</span><span className="value">{percent(totals.abilityDuration)}</span></div>
        <div><span className="label">Health</span><span className="value">{totals.health.toLocaleString()}</span></div>
        <div><span className="label">Shields</span><span className="value">{totals.shields.toLocaleString()}</span></div>
        <div><span className="label">Armor</span><span className="value">{totals.armor.toLocaleString()}</span></div>
        <div><span className="label">Energy</span><span className="value">{frame.energy}</span></div>
      </div>

      <ModSlots
        weaponName={frame.name}
        capacityLabel="Orokin Reactor"
        isMelee={isMelee}
        compatibleMods={compatibleMods}
        compatibleArcanes={WARFRAME_ARCANES}
        slots={slots}
        arcaneSlots={arcaneSlots}
        polarities={polarities}
        hasCatalyst={hasReactor}
        auraCount={frame.auraPolarities.length || 1}
        isAura={isAuraMod}
        onSlotsChange={setSlots}
        onArcanesChange={setArcaneSlots}
        onPolaritiesChange={setPolarities}
        onCatalystChange={setHasReactor}
      />

      <div className="form-grid">
        <label title="Archon Shards, arcanes, anything not in the mods (+%)">
          Extra Ability Strength %
          <input type="number" step={1} value={Math.round(extraStrength * 100)} onChange={(event) => setExtraStrength(Number(event.target.value) / 100)} />
        </label>
        <label title="Archon Shards, arcanes, anything not in the mods (+%). Null Star's particle count scales with it">
          Extra Ability Duration %
          <input type="number" step={1} value={Math.round(extraDuration * 100)} onChange={(event) => setExtraDuration(Number(event.target.value) / 100)} />
        </label>
        <label title="Flat armor from Archon Shards etc. Feeds Primary Bulwark (+1% damage per armor past 1,000)">
          Extra armor
          <input type="number" min={0} step={10} value={extraArmor} onChange={(event) => setExtraArmor(Math.max(0, Number(event.target.value)))} />
        </label>
      </div>
      {totals.lines.length > 0 && <p className="proc-note">From mods: {totals.lines.join(' · ')}</p>}
      {setSummary(totals.setPieces).length > 0 && (
        <p className="proc-note" title="Set pieces on the Warframe count together with the ones on the weapon in the calculator. The weapon side shows in the results">
          Sets on the frame: {setSummary(totals.setPieces).map((set) => `${set.name} ${set.count}/${set.pieces}: ${set.text}`).join(' · ')}
        </p>
      )}

      <h3>Survivability</h3>
      <div className="survivability">
        <table>
          <tbody>
            {totals.drSources.map((source) => (
              <tr key={source.label}>
                <td>{source.label}</td>
                <td className="muted-inline">{source.on === 'both' ? 'health + shields' : source.on}</td>
                <td>{percent(source.value)}</td>
              </tr>
            ))}
            <tr className="total"><td>Damage reduction on health</td><td /><td>{percent(totals.healthDr)}</td></tr>
            <tr className="total"><td>Damage reduction on shields</td><td /><td>{totals.shields > 0 ? percent(totals.shieldDr) : '–'}</td></tr>
            {totals.damageCap && (
              <tr className={totals.damageCap.active ? 'total' : 'inactive-row'} title="Magnetic Status and Ability Nullifying Effects disable this protection">
                <td>{totals.damageCap.source}: max {totals.damageCap.perSecond.toLocaleString()} damage/s</td>
                <td className="muted-inline">armor above {totals.damageCap.armorNeeded.toLocaleString()}</td>
                <td>{totals.damageCap.active ? 'on' : 'off (not enough armor)'}</td>
              </tr>
            )}
            <tr className="total" title="health / (1 − health DR) + shields / (1 − shield DR). Toxin skips shields, so vs Toxin it's only the health part">
              <td>Effective health</td><td className="muted-inline">raw {(totals.health + totals.shields).toLocaleString()}</td><td>{Math.round(totals.effectiveHealth).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
        <div className="row">
          <label className="inline-check" title="The wiki's Damage Reduction example gives shields an innate 50% DR">
            <input type="checkbox" checked={shieldInnateDr} onChange={(event) => setShieldInnateDr(event.target.checked)} />
            Shields' innate 50% DR
          </label>
          <label className="inline-number" title="Any other damage reduction source (Gara, Baruuk, Rolling Guard...), stacked multiplicatively">
            Other DR %
            <input type="number" min={0} max={99} step={1} value={Math.round(otherDr * 100)} onChange={(event) => setOtherDr(Math.min(0.99, Math.max(0, Number(event.target.value) / 100)))} />
          </label>
        </div>
        <p className="muted">
          Armor DR = armor / (armor + 300), health only. Every source multiplies with the others ("Sources of damage reduction
          (including armor) stack multiplicatively with each other", wiki Damage_Reduction).
        </p>
      </div>

      <h3>{frame.name}'s abilities</h3>
      <div className="kit-list">{kit.map(renderKitEntry)}</div>
      {frame.passive && (
        <div className={`kit-ability passive ${passives.some((passive) => activeOwn[passive.id] && hasAugment(passive)) ? 'active' : ''}`}>
          <div className="kit-head"><span className="kit-index">P</span><span className="ability-name">Passive</span></div>
          <div className="kit-description">{frame.passive.replace(/\|[A-Z_]+\|/g, 'X')}</div>
          {passives.map((passive) => (
            <label key={passive.id} className={`kit-effect ${abilityApplies(passive, weapon) ? '' : 'inactive'}`} title={`“${passive.quote}”${passive.note ? `\n${passive.note}` : ''}`}>
              <input
                type="checkbox" checked={Boolean(activeOwn[passive.id])} disabled={!hasAugment(passive)}
                onChange={(event) => setActiveOwn({ ...activeOwn, [passive.id]: event.target.checked })}
              />
              {passive.augment ? `${passive.name}: ` : 'Active: '}{effectText(passive, 'self', state.abilityStrength, totals.abilityDuration)}
              {passive.condition && ` · ${passive.condition}`}
              {!hasAugment(passive) && ` · equip ${passive.augment} to use it`}
            </label>
          ))}
        </div>
      )}

      <h3>Allies' abilities</h3>
      <div className="row ally-row">
        <select value="" onChange={(event) => event.target.value && setAllies([...allies, event.target.value])}>
          <option value="">Add an ally's ability…</option>
          {allyOptions.map((ability) => <option key={ability.id} value={ability.id}>{ability.warframe}: {ability.name}</option>)}
        </select>
        <label title="Ability Strength your allies cast at" className="inline-number">
          Ally strength %
          <input type="number" min={0} step={1} value={Math.round(teammateStrength * 100)} onChange={(event) => setTeammateStrength(Math.max(0, Number(event.target.value)) / 100)} />
        </label>
      </div>
      <div className="ally-list">
        {allies.map((id) => {
          const ability = abilitiesById.get(id)!
          const applies = abilityApplies(ability, weapon)
          return (
            <div key={id} className={`ally-chip ${applies ? '' : 'inactive'}`} title={`“${ability.quote}”${ability.note ? `\n${ability.note}` : ''}`}>
              <span className="ability-name">{ability.name}</span>
              <span className="muted-inline">{ability.warframe}</span>
              <span className="ability-effect">
                {effectText(ability, 'ally', teammateStrength)}
                {!applies && ` · ${APPLIES_LABEL[ability.appliesTo]}`}
              </span>
              <button className="remove-inline" title="Remove" onClick={() => setAllies(allies.filter((other) => other !== id))}>×</button>
            </div>
          )
        })}
      </div>
      <p className="muted">
        Max-rank wiki values × Ability Strength. Your abilities and your subsumed one use your strength (so your mods scale them),
        allies' use the ally strength. Subsumed versions use the Helminth numbers where the wiki lists them (Roar, Eclipse, Nourish,
        Warcry, Wrathful Advance). Hover for the wiki line. The leaderboard has no Warframe, so none of this changes the rankings.
      </p>
    </section>
  )
}
