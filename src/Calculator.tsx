import { useEffect, useMemo, useRef, useState } from 'react'
import { Info } from './components/Tip'
import { STATUS_TYPES, factionLabel, hitsPerComboTier, maxComboFor } from './calc/constants'
import { calculate } from './calc/damage'
import { arcanesById, enemies, getCompatibleArcanes, getCompatibleMods, modsById, warframesById, weapons, weaponsById } from './data'
import { estimateKill } from './calc/kill'
import { FightDialog } from './components/FightDialog'
import { CO_MODE_LABELS, resolveCoBehavior, type CoMode } from './calc/conditionOverload'
import { IncarnonPanel } from './components/IncarnonPanel'
import { getIncarnonTiers, scenarioPerkStacks, type SelectedPerk } from './calc/incarnon'
import { TargetBox } from './components/TargetBox'
import { PassivesPanel } from './components/PassivesPanel'
import { WarframePanel, type FrameSnapshot } from './components/WarframePanel'
import { decodeLoadout, encodeLoadout } from './calc/loadoutCode'
import { addRecent, browserStore, codeFromUrl, readRecent, setUrlCode, type BuildLabel } from './calc/buildStorage'
import { BuildStorageDialog } from './components/BuildStorageDialog'
import { BaseStats } from './components/BaseStats'
import { hasBonusElement, passivesFor, type BonusElement } from './data/passives'
import { heavyComboFor, type HeavyMode } from './data/heavyAttacks'
import type { WarframeState } from './data/warframeAbilities'
import { ModSlots, TOTAL_SLOTS, EXILUS_SLOT, type ArcaneSlot, type ModSlot } from './components/ModSlots'
import { BuildAdvisor } from './components/BuildAdvisor'
import { equipMod } from './optimizer/optimize'
import type { SlotPolarity } from './calc/capacity'
import { SearchSelect } from './components/SearchSelect'
import { RivenEditor } from './components/RivenEditor'
import { RIVEN_MOD_ID, emptyRiven, rivenMod, rivenTypeFor, type RivenConfig, RIVEN_DISPOSITION } from './calc/riven'
import type { CompareScenario } from './optimizer/compare'
import type { FrameLoad } from './optimizer/damageCap'
import { FormulaPanel } from './components/FormulaPanel'
import { StatsPanel } from './components/StatsPanel'
import { ResultsBar } from './components/ResultsBar'
import { Thumb } from './components/Thumb'
import { resolveArmor, resolveEnemy } from './components/TargetPanel'
import type { Buffs, Debuffs, EquippedMod, TargetSettings } from './types'
import type { LeaderboardEntry } from './optimizer/leaderboardTypes'
import { SCENARIO_BUFFS, SCENARIO_DEBUFFS, SCENARIO_TARGET } from './optimizer/scenario'
import { STANCES, bestCombo, comboLabel, stancesFor, usesStance } from './data/stances'
import { isIncarnonAttackName } from './calc/incarnonForm'

// a leaderboard build to load into the calculator. the nonce lets the same entry be loaded twice in a row
export interface BuildToLoad {
  entry: LeaderboardEntry
  nonce: number
  riven?: RivenConfig | null // Compare tab builds can carry one
  keepScenario?: boolean // Compare runs against the calculator's own target keep it
  // Damage Cap steps: the rest of the step's setup. frame 'keep' = leave the Warframe panel alone (panel-mode runs)
  setup?: { headshot: boolean; debuffs: Debuffs; combo: number; frame: FrameLoad | 'clear' | 'keep'; target?: TargetSettings }
}

const emptySlots = () => Array<ModSlot | null>(TOTAL_SLOTS).fill(null)
// pre-installed polarities fill the normal slots in order, exilus starts unpolarized
const defaultPolarities = (weaponPolarities: string[]): SlotPolarity[] =>
  Array.from({ length: TOTAL_SLOTS }, (_, index) => (index === EXILUS_SLOT ? null : ((weaponPolarities[index] ?? null) as SlotPolarity)))
const defaultWeaponId = weapons.find((weapon) => weapon.name === 'Braton Prime')?.uniqueName ?? weapons[0].uniqueName
// conditional passives start at what the leaderboard assumes (usually on)
const defaultPassiveStacks = (weaponName: string) =>
  Object.fromEntries(
    passivesFor(weaponName)
      .filter((passive) => passive.condition)
      .map((passive) => [passive.name, passive.scenarioStacks ?? passive.maxStacks ?? 1]),
  )
const weaponOptions = weapons.map((weapon) => ({ id: weapon.uniqueName, label: weapon.name }))

const defaultEnemy = enemies.find((enemy) => enemy.name === 'Heavy Gunner')
const DEFAULT_TARGET: TargetSettings = {
  faction: 'Grineer',
  layer: 'health',
  enemyId: defaultEnemy?.uniqueName ?? null,
  baseLevel: 1,
  level: 100,
  steelPath: false,
  manualArmor: 500,
  headshot: false,
  headshotMultiplier: null, // auto from faction
  headcrit: null,
}
const DEFAULT_DEBUFFS: Debuffs = {
  stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, 0])),
  heatArmorStrip: 0,
  corrosiveProjections: 0,
  otherArmorReduction: 0,
  damageVulnerability: 0,
  liftedOrKnockedDown: false,
  statusTypeSource: 'build',
}

// what a loadout code holds (calc/loadoutCode.ts packs it). v is the shape's version, for if it ever changes
interface CalcSnapshot {
  v: 1
  weaponId: string
  attackIndex: number
  slots: (ModSlot | null)[]
  polarities: SlotPolarity[]
  hasCatalyst: boolean
  arcaneSlot: ArcaneSlot | null
  coOverride: CoMode | 'auto'
  incarnonSelection: Record<string, string | null>
  incarnonStacks: Record<string, number>
  target: TargetSettings
  debuffs: Debuffs
  buffs: Buffs
  passiveStacks: Record<string, number>
  bonusElement: BonusElement | null
  heavyMode: HeavyMode
  stancePick: string
  rivenConfig: RivenConfig
  frame: FrameSnapshot | null
}

interface CalculatorProps {
  buildToLoad: BuildToLoad | null
  frameToLoad?: { frame: string; nonce: number } | null // just pick this Warframe, no mods or abilities on
  onScenarioChange?: (scenario: CompareScenario) => void
  onRivenChange?: (riven: { weaponId: string; config: RivenConfig }) => void
  active?: boolean // the Calculator tab is showing: only then does the address bar carry the build (?b=)
}

export function Calculator({ buildToLoad, frameToLoad, onScenarioChange, onRivenChange, active = true }: CalculatorProps) {
  const [weaponId, setWeaponId] = useState(defaultWeaponId)
  const [attackIndex, setAttackIndex] = useState(0)
  const [slots, setSlots] = useState(emptySlots)
  const [polarities, setPolarities] = useState(() => defaultPolarities(weaponsById.get(defaultWeaponId)!.polarities))
  const [hasCatalyst, setHasCatalyst] = useState(true)
  const [arcaneSlot, setArcaneSlot] = useState<ArcaneSlot | null>(null)
  const [coOverride, setCoOverride] = useState<CoMode | 'auto'>('auto')
  const [incarnonSelection, setIncarnonSelection] = useState<Record<string, string | null>>({})
  const [incarnonStacks, setIncarnonStacks] = useState<Record<string, number>>({}) // only what you changed, the rest is scenarioPerkStacks
  const [target, setTarget] = useState(DEFAULT_TARGET)
  const [debuffs, setDebuffs] = useState(DEFAULT_DEBUFFS)
  const [buffs, setBuffs] = useState<Buffs>({ roar: 0, combo: 1, gladiatorWarframePieces: 0 })
  const [passiveStacks, setPassiveStacks] = useState<Record<string, number>>(() => defaultPassiveStacks(weaponsById.get(defaultWeaponId)!.name))
  const [bonusElement, setBonusElement] = useState<BonusElement | null>(null)
  const [heavyMode, setHeavyMode] = useState<HeavyMode>('biggestHit')
  // melee Normal Attack stance combo: 'auto' = the best one, 'none' = one plain swing per attack speed
  const [stancePick, setStancePick] = useState<string>('auto')
  // from the Warframe panel: strength/armor/abilities/auras, and how many Corrosive Projections your auras bring
  const [warframeState, setWarframeState] = useState<WarframeState | null>(null)
  const [warframeCorrosive, setWarframeCorrosive] = useState(0)
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null)
  // the riven's stats live here, the slot just holds RIVEN_MOD_ID. per weapon, so it resets when the weapon changes
  const [rivenConfig, setRivenConfig] = useState(emptyRiven)
  // passed down to the Warframe panel when a loaded build brings (or clears) a Warframe setup
  const [frameLoad, setFrameLoad] = useState<{ nonce: number; load: FrameLoad | 'clear' } | null>(null)
  // loadout codes: the Warframe panel's latest setup (a ref, it only matters when copying), a pasted one going back down,
  // and the little "copied / loaded / that's not a code" note next to the buttons
  const frameSnapshot = useRef<FrameSnapshot | null>(null)
  const [frameRestore, setFrameRestore] = useState<{ nonce: number; snapshot: Partial<FrameSnapshot> } | null>(null)
  const [codeNote, setCodeNote] = useState<string | null>(null)
  const [shownCode, setShownCode] = useState<string | null>(null) // the fallback box when the clipboard won't take it
  const [simOpen, setSimOpen] = useState(false) // the damage simulator box
  // local build storage + build links: the Warframe side bumps frameVersion so the build's code (and the URL) follows it too
  const [frameVersion, setFrameVersion] = useState(0)
  const [currentCode, setCurrentCode] = useState<string | null>(null)
  const [storageOpen, setStorageOpen] = useState(false)
  const [recentVersion, setRecentVersion] = useState(0)
  const recordNext = useRef(false) // the next settled code is a load: record it right away
  const firstCode = useRef<string | null>(null) // the default build the page opened on, not worth recording

  // "Load build" on the leaderboard: set the weapon, attack, mods, arcane and perks, and switch the target/debuffs
  // to the leaderboard scenario so the numbers match what the leaderboard showed
  useEffect(() => {
    if (!buildToLoad) return
    const { entry, riven, keepScenario, setup } = buildToLoad
    const loadedWeapon = weaponsById.get(entry.weaponId)
    if (!loadedWeapon) return
    const nextSlots = emptySlots()
    entry.mods.forEach((mod, index) => {
      if (index < EXILUS_SLOT && (modsById.has(mod.id) || (mod.id === RIVEN_MOD_ID && riven))) {
        nextSlots[index] = { modId: mod.id, rank: mod.rank, conditionalStacks: mod.conditionalStacks }
      }
    })
    setWeaponId(entry.weaponId)
    setAttackIndex(Math.max(0, loadedWeapon.attacks.findIndex((option) => option.name === entry.attack)))
    setSlots(nextSlots)
    setPolarities(defaultPolarities(loadedWeapon.polarities))
    setArcaneSlot(
      entry.arcane && arcanesById.has(entry.arcane.id)
        ? { arcaneId: entry.arcane.id, rank: entry.arcane.rank, conditionalStacks: entry.arcane.conditionalStacks }
        : null,
    )
    setCoOverride('auto')
    setIncarnonSelection(Object.fromEntries(entry.perks.map((perk) => [perk.tier, perk.name])))
    setIncarnonStacks({})
    setPassiveStacks(defaultPassiveStacks(loadedWeapon.name))
    setBonusElement(entry.bonusElement ?? null)
    setRivenConfig(riven ?? emptyRiven()) // leaderboard builds never have one
    if (setup) {
      // a Damage Cap step: its headshot / debuffs / combo, and its Warframe setup into the panel
      setTarget((current) => ({ ...(setup.target ?? current), headshot: setup.headshot }))
      setDebuffs(setup.debuffs)
      setBuffs((current) => ({ ...current, roar: 0, combo: setup.combo }))
      if (setup.frame !== 'keep') setFrameLoad({ nonce: buildToLoad.nonce, load: setup.frame })
    } else if (!keepScenario) {
      // leaderboard builds are scored with no Warframe, so the panel's abilities, allies and arcanes go off too
      setTarget(SCENARIO_TARGET)
      setDebuffs(SCENARIO_DEBUFFS)
      setBuffs(SCENARIO_BUFFS)
      setFrameLoad({ nonce: buildToLoad.nonce, load: 'clear' })
    }
    setLoadedFrom(keepScenario ? null : `${entry.weaponName} (${entry.attack})`)
    recordNext.current = true
  }, [buildToLoad])
  useEffect(() => {
    if (!frameToLoad) return
    setFrameLoad({ nonce: frameToLoad.nonce, load: { frame: frameToLoad.frame, allyStrength: 1, casts: [], subsume: null, arcaneIds: [], mods: { regular: [], aura: [], exilus: null } } })
  }, [frameToLoad])

  const weapon = weaponsById.get(weaponId)!
  const attack = weapon.attacks[attackIndex] ?? weapon.attacks[0]
  const isMelee = weapon.category === 'Melee'
  const maxCombo = maxComboFor(weapon.name)
  const combo = Math.min(maxCombo, Math.max(1, buffs.combo ?? 1))
  const compatibleMods = useMemo(() => getCompatibleMods(weapon), [weapon])
  const compatibleArcanes = useMemo(() => getCompatibleArcanes(weapon), [weapon])
  const incarnonTiers = useMemo(() => getIncarnonTiers(weapon.name), [weapon])
  // a perk's conditional part starts where the leaderboard has it (incarnon.ts scenarioPerkStacks: status / kill / channel /
  // overshield conditions on, headshot hits only with headshots on), until you change it in the panel
  const perkStacks: Record<string, number> = Object.fromEntries((incarnonTiers ?? []).flatMap(({ perks }) => perks.map((perk) => [
    perk.name, incarnonStacks[perk.name] ?? scenarioPerkStacks(perk, { isMelee, bodyShots: !target.headshot }),
  ])))
  const incarnonPerks: SelectedPerk[] = (incarnonTiers ?? []).flatMap(({ tier, perks }) => {
    const perk = perks.find((candidate) => candidate.name === incarnonSelection[tier])
    return perk ? [{ perk, stacks: perkStacks[perk.name] ?? 0 }] : []
  })

  const weaponPassives = useMemo(() => passivesFor(weapon.name), [weapon])
  const selectedPassives = weaponPassives.map((passive) => ({ passive, stacks: passiveStacks[passive.name] ?? 0 }))
  const showBonusElement = hasBonusElement(weapon.name)

  const rivenType = rivenTypeFor(weapon)
  const riven = useMemo(() => rivenMod(weapon, rivenConfig), [weapon, rivenConfig])
  const modFor = (modId: string) => (modId === RIVEN_MOD_ID ? riven : modsById.get(modId))
  const equippedMods: EquippedMod[] = slots.flatMap((slot) => {
    const mod = slot ? modFor(slot.modId) : null
    return slot && mod ? [{ mod, rank: slot.rank, conditionalStacks: slot.conditionalStacks }] : []
  })
  const equippedArcane = arcaneSlot
    ? { arcane: arcanesById.get(arcaneSlot.arcaneId)!, rank: arcaneSlot.rank, conditionalStacks: arcaneSlot.conditionalStacks }
    : null
  const wikiCo = resolveCoBehavior(weapon, attack)
  const coBehavior = coOverride === 'auto' ? wikiCo : { mode: coOverride, scale: 1, source: 'override' as const }
  const weaponStances = stancesFor(weapon)
  const stance = stancePick === 'auto' ? null : stancePick === 'none' ? 'none' as const
    : weaponStances.some((name) => stancePick.startsWith(`${name}|`)) ? { stance: stancePick.split('|')[0], combo: stancePick.split('|')[1] } : null
  const calcInput = { weapon, attack, mods: equippedMods, arcane: equippedArcane, coBehavior, incarnonPerks, passives: selectedPassives, bonusElement, heavyMode, stance, armor: resolveArmor(target),
    debuffs: { ...debuffs, corrosiveProjections: Math.min(4, debuffs.corrosiveProjections + warframeCorrosive) },
    buffs: { ...buffs, warframe: warframeState ?? undefined } }
  // body and head are always both calculated so the results can show them side by side,
  // the "assume headshots" toggle just picks which one drives the main numbers
  const bodyResult = calculate({ ...calcInput, target: { ...target, headshot: false } })
  const headResult = calculate({ ...calcInput, target: { ...target, headshot: true } })
  const result = target.headshot ? headResult : bodyResult
  // what the in-game arsenal screen shows: mods' always-on stats only. no On Kill / On Status stacks, no Warframe
  // abilities, no combo, no status types on the target (so no CO). and the weapon with no mods at all next to it
  const arsenalInput = {
    ...calcInput,
    mods: equippedMods.map((mod) => ({ ...mod, conditionalStacks: 0 })),
    arcane: equippedArcane ? { ...equippedArcane, conditionalStacks: 0 } : null,
    incarnonPerks: incarnonPerks.map((perk) => ({ ...perk, stacks: 0 })),
    passives: selectedPassives.map((passive) => ({ ...passive, stacks: 0 })),
    debuffs: { ...debuffs, stacks: {}, liftedOrKnockedDown: false, statusTypeSource: 'debuffs' as const },
    buffs: { roar: 0, combo: 1, gladiatorWarframePieces: buffs.gladiatorWarframePieces, tenaciousBond: buffs.tenaciousBond }, // the arsenal shows Tenacious Bond too
    target: { ...target, headshot: false },
  }
  const arsenalResult = calculate(arsenalInput)
  const unmoddedResult = calculate({ ...arsenalInput, mods: [], arcane: null })

  // the enemy box needs health and shield numbers no matter which layer the main results show
  const scaledEnemy = resolveEnemy(target)
  const killFor = (headshot: boolean) => {
    if (!scaledEnemy) return null
    const vsHealth = calculate({ ...calcInput, target: { ...target, headshot, layer: 'health' } })
    const vsShield = calculate({ ...calcInput, target: { ...target, headshot, layer: 'shield' } })
    return { vsHealth, kill: estimateKill(scaledEnemy.health, scaledEnemy.shield, vsHealth, vsShield) }
  }
  // what the closed Target drawer says about itself (target + debuffs)
  const targetSummary = [
    scaledEnemy ? `${scaledEnemy.enemy.name} Lv ${scaledEnemy.effectiveLevel}` : `${factionLabel(target.faction)}, ${resolveArmor(target)} armor`,
    target.steelPath ? 'Steel Path' : null,
    target.headshot ? 'headshots' : null,
    target.statusMode && target.statusMode !== 'normal' ? (target.statusMode === 'immune' ? 'status immune' : 'status capped') : null,
  ].filter(Boolean).join(' · ')
  const activeDebuffs = Object.values(debuffs.stacks).filter((stacks) => stacks > 0).length +
    (debuffs.heatArmorStrip > 0 ? 1 : 0) + (debuffs.corrosiveProjections + warframeCorrosive > 0 ? 1 : 0) + (debuffs.otherArmorReduction > 0 ? 1 : 0) +
    (debuffs.damageVulnerability > 0 ? 1 : 0) + (debuffs.liftedOrKnockedDown ? 1 : 0) + (buffs.tenaciousBond ? 1 : 0)
  const bodyKill = killFor(false)
  const headKill = killFor(true)

  // the Compare tab can run against this setup. state values as deps so it only fires on real changes
  useEffect(() => {
    onScenarioChange?.({
      target, armor: resolveArmor(target),
      debuffs: { ...debuffs, corrosiveProjections: Math.min(4, debuffs.corrosiveProjections + warframeCorrosive) },
      buffs: { ...buffs, warframe: warframeState ?? undefined },
    })
  }, [target, debuffs, buffs, warframeState, warframeCorrosive, onScenarioChange])
  useEffect(() => onRivenChange?.({ weaponId, config: rivenConfig }), [weaponId, rivenConfig, onRivenChange])

  const pickWeapon = (id: string | null) => {
    if (!id) return
    setWeaponId(id)
    setAttackIndex(0)
    setSlots(emptySlots()) // mods from the old weapon type won't fit anyway
    setPolarities(defaultPolarities(weaponsById.get(id)!.polarities))
    setArcaneSlot(null) // primary/secondary/melee arcanes don't carry over either
    setCoOverride('auto')
    setIncarnonSelection({}) // perks are per weapon
    setIncarnonStacks({})
    setPassiveStacks(defaultPassiveStacks(weaponsById.get(id)!.name))
    setBonusElement(null)
    setRivenConfig(emptyRiven()) // a riven belongs to one weapon
  }

  // loadout codes. what goes in is the raw state, the same thing the panels themselves hold, so pasting it back is just
  // setting it all again. the weapon must exist; mods/arcanes this version doesn't know are dropped, missing fields get defaults
  const currentSetup = (): CalcSnapshot => ({
    v: 1, weaponId, attackIndex, slots, polarities, hasCatalyst, arcaneSlot, coOverride, incarnonSelection, incarnonStacks,
    target, debuffs, buffs, passiveStacks, bonusElement, heavyMode, stancePick, rivenConfig, frame: frameSnapshot.current,
  })
  // what a stored build shows in the list, made when it's recorded so the list never has to unpack codes
  const currentLabel = (): BuildLabel => {
    const current = weaponsById.get(weaponId)!
    const frameId = frameSnapshot.current?.frameId
    return { weapon: current.name, attack: current.attacks[attackIndex]?.name ?? '', frame: frameId ? warframesById.get(frameId)?.name ?? null : null }
  }
  const remember = (code: string) => {
    addRecent(browserStore(), code, currentLabel())
    setRecentVersion((version) => version + 1)
  }
  // the clipboard, for codes and links. Safari only lets the click itself write, and packing a code takes a moment, so the
  // write starts right away with the text as a promise. older browsers without ClipboardItem get the plain write
  const copyText = async (text: string | Promise<string>, what: string): Promise<boolean> => {
    const pending = Promise.resolve(text)
    setShownCode(null)
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': pending.then((value) => new Blob([value], { type: 'text/plain' })) })])
      } else {
        await navigator.clipboard.writeText(await pending)
      }
      setCodeNote(`${what} copied (${(await pending).length} characters)`)
      return true
    } catch {
      // clipboard blocked (or not there at all on a plain http:// address): show it to copy by hand
      setShownCode(await pending)
      setCodeNote(`Your browser blocked the clipboard, copy the ${what.toLowerCase()} from the box`)
      return false
    }
  }
  const copyCode = async () => {
    const code = encodeLoadout(currentSetup())
    await copyText(code, 'Loadout code')
    remember(await code)
  }
  // every way in (paste, a link, the storage box) goes through here; the error message when it isn't a usable code
  const loadCode = async (text: string): Promise<string | null> => {
    try {
      applySnapshot((await decodeLoadout(text)) as Partial<CalcSnapshot>)
      recordNext.current = true
      return null
    } catch (error) {
      setCodeNote((error as Error).message)
      return (error as Error).message
    }
  }
  const pasteCode = async () => {
    let text: string | null = null
    try { text = await navigator.clipboard.readText() } catch { /* blocked or unsupported: ask instead */ }
    if (!text?.trim().startsWith('VS1.')) text = window.prompt('Paste a loadout code')
    if (!text) return
    setShownCode(null)
    await loadCode(text)
  }

  // a build link (?b=<code>) opens straight onto that build
  useEffect(() => {
    const linked = codeFromUrl()
    if (linked) void loadCode(linked)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // the current build as a code, re-packed a second after the last change (the Warframe side settles a render or two
  // after a load, the wait covers that too)
  useEffect(() => {
    let stale = false
    const timer = window.setTimeout(() => {
      encodeLoadout(currentSetup()).then((code) => { if (!stale) setCurrentCode(code) }).catch(() => {})
    }, 1000)
    return () => { stale = true; window.clearTimeout(timer) }
  }, [weaponId, attackIndex, slots, polarities, hasCatalyst, arcaneSlot, coOverride, incarnonSelection, incarnonStacks, target, debuffs, buffs, passiveStacks, bonusElement, heavyMode, stancePick, rivenConfig, frameVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // the address bar follows the build while this tab is showing (replaceState: no history spam), and lets go when it isn't
  useEffect(() => { setUrlCode(active ? currentCode : null) }, [active, currentCode])

  // recent builds, recorded on their own: a load goes in as soon as it settles, anything else after 10 s without changes
  // (if it differs from the newest one). the default build the page opened on isn't worth a slot
  useEffect(() => {
    if (!currentCode) return
    if (firstCode.current === null && !recordNext.current) { firstCode.current = currentCode; return }
    if (recordNext.current) { recordNext.current = false; remember(currentCode); return }
    if (currentCode === firstCode.current) return
    const timer = window.setTimeout(() => {
      if (readRecent(browserStore())[0]?.code !== currentCode) remember(currentCode)
    }, 10_000)
    return () => window.clearTimeout(timer)
  }, [currentCode]) // eslint-disable-line react-hooks/exhaustive-deps
  const applySnapshot = (saved: Partial<CalcSnapshot>) => {
    const loaded = saved.weaponId ? weaponsById.get(saved.weaponId) : undefined
    if (!loaded) throw new Error("That code's weapon isn't in this version's data")
    const known = (slot: ModSlot | null | undefined) => (slot && (modsById.has(slot.modId) || slot.modId === RIVEN_MOD_ID) ? slot : null)
    setWeaponId(loaded.uniqueName)
    setAttackIndex(Math.min(saved.attackIndex ?? 0, loaded.attacks.length - 1))
    setSlots(Array.from({ length: TOTAL_SLOTS }, (_, index) => known(saved.slots?.[index])))
    setPolarities(saved.polarities?.length === TOTAL_SLOTS ? saved.polarities : defaultPolarities(loaded.polarities))
    setHasCatalyst(saved.hasCatalyst ?? true)
    setArcaneSlot(saved.arcaneSlot && arcanesById.has(saved.arcaneSlot.arcaneId) ? saved.arcaneSlot : null)
    setCoOverride(saved.coOverride ?? 'auto')
    setIncarnonSelection(saved.incarnonSelection ?? {})
    setIncarnonStacks(saved.incarnonStacks ?? {})
    setTarget({ ...DEFAULT_TARGET, ...saved.target })
    setDebuffs({ ...DEFAULT_DEBUFFS, ...saved.debuffs })
    setBuffs({ roar: 0, combo: 1, gladiatorWarframePieces: 0, ...saved.buffs })
    setPassiveStacks(saved.passiveStacks ?? defaultPassiveStacks(loaded.name))
    setBonusElement(saved.bonusElement ?? null)
    setHeavyMode(saved.heavyMode ?? 'biggestHit')
    setStancePick(saved.stancePick ?? 'auto')
    setRivenConfig(saved.rivenConfig ?? emptyRiven())
    if (saved.frame) setFrameRestore({ nonce: Date.now(), snapshot: saved.frame })
    setLoadedFrom(null)
    setCodeNote(`Loaded ${loaded.name} from a code`)
  }

  // every box folds up: click its title to collapse/expand it. done on the DOM (one class on the panel) so the panels
  // themselves don't need to know, nested ones (the Warframe's mod grid) fold on their own
  const togglePanel = (event: React.MouseEvent) => {
    const target = event.target as Element
    if (target.closest('input, select, button, a, label')) return
    const title = target.closest('h2')
    const panel = title?.closest('.panel')
    if (panel) panel.classList.toggle('collapsed')
  }

  return (
    <>
      {loadedFrom && (
        <div className="load-banner">
          Loaded the leaderboard build for <b>{loadedFrom}</b>. Target and debuffs were switched to the leaderboard scenario
          (no faction, no armor, status types from the build) so the numbers match. Change them in the Target drawer at the top to test it against something else.
          <button className="link-button" onClick={() => setLoadedFrom(null)}>dismiss</button>
        </div>
      )}
      <div className="loadout-code">
        <button onClick={copyCode} title="The whole setup, weapon and Warframe, as one code on your clipboard">Copy loadout code</button>
        <button onClick={pasteCode} title="Load a setup from a code on your clipboard">Paste loadout code</button>
        <button onClick={() => setSimOpen(true)} title="Fight the target shot by shot, a few hundred times, in a floating box">Damage simulator</button>
        <button onClick={() => setStorageOpen(true)} title="Your recent and saved builds in this browser, with links to share or bookmark">Local build storage</button>
        {codeNote && <span className="muted-inline" role="status">{codeNote}</span>}
        {shownCode && (
          <input
            className="loadout-code-box" readOnly value={shownCode} aria-label="Loadout code" autoFocus
            onFocus={(event) => event.target.select()} onClick={(event) => event.currentTarget.select()}
          />
        )}
      </div>
      {storageOpen && (
        <BuildStorageDialog
          current={currentCode ? { code: currentCode, label: currentLabel() } : null}
          recentVersion={recentVersion}
          onLoad={loadCode}
          onCopy={copyText}
          onClose={() => setStorageOpen(false)}
        />
      )}
      {simOpen && <FightDialog input={{ ...calcInput, target }} enemy={scaledEnemy} onClose={() => setSimOpen(false)} />}
      <div className="layout" onClick={togglePanel}>
        <ResultsBar
          result={result}
          enemy={scaledEnemy}
          bodyKill={bodyKill?.kill ?? null}
          headKill={headKill?.kill ?? null}
          canHeadshot={!attack.isAoE}
          drawers={[
            {
              // target, debuffs and kill details in one box (TargetBox)
              id: 'target', label: 'Target', summary: `${targetSummary} · ${activeDebuffs ? `${activeDebuffs} debuffs` : 'no debuffs'}`,
              content: (
                <TargetBox
                  target={target} onTargetChange={setTarget}
                  debuffs={debuffs} buffs={buffs} onDebuffsChange={setDebuffs} onBuffsChange={setBuffs}
                  scaled={scaledEnemy} vsHealth={bodyKill?.vsHealth ?? result}
                  kill={bodyKill?.kill ?? null} headKill={headKill?.kill ?? null} canHeadshot={!attack.isAoE}
                />
              ),
            },
            { id: 'results', label: 'Full results', summary: 'DoT, head vs body, procs', content: <StatsPanel result={result} body={bodyResult} head={headResult} arsenal={arsenalResult} unmodded={unmoddedResult} canHeadshot={!attack.isAoE} bodyKill={bodyKill?.kill ?? null} headKill={headKill?.kill ?? null} /> },
          ]}
        />
        {/* weapon side and Warframe side, 50/50 on wide screens, stacked otherwise */}
        <div className="build">
          <div className="build-col">
          <section className="panel">
            <h2>Weapon</h2>
            <div className="row">
              <Thumb imageName={weapon.imageName} wikiImage={weapon.wikiImage} alt={weapon.name} wide />
              <SearchSelect options={weaponOptions} selectedId={weaponId} onSelect={pickWeapon} placeholder="Search weapons" />
              {weapon.attacks.length > 1 && (
                <select value={attackIndex} onChange={(event) => { setAttackIndex(Number(event.target.value)); setCoOverride('auto') }}>
                  {weapon.attacks.map((option, index) => (
                    <option key={option.name} value={index}>{option.name}</option>
                  ))}
                </select>
              )}
            </div>
            <p className="muted">
              {weapon.type} · {compatibleMods.length} compatible mods
              {attack.isAoE && ' · AoE attack (no headshots, no Puncture/Cold crit bonus)'}
            </p>
            <BaseStats weapon={weapon} attack={attack} />
            <div className="co-row">
              <label htmlFor="co-mode">Condition Overload / Galvanized / Shiver</label>
              <select id="co-mode" value={coOverride} onChange={(event) => setCoOverride(event.target.value as CoMode | 'auto')}>
                <option value="auto">
                  Auto: {CO_MODE_LABELS[wikiCo.mode]}{wikiCo.scale !== 1 ? ` (${Math.round(wikiCo.scale * 100)}%)` : ''}
                  {wikiCo.source === 'wiki' ? ' (wiki)' : wikiCo.source === 'sheet' ? ' (GunCO sheet)' : ' (default)'}
                </option>
                <option value="add">Additive</option>
                <option value="multiply">Multiplicative</option>
                <option value="none">Doesn't apply</option>
              </select>
              {coOverride === 'auto' && wikiCo.note && <span className="muted-inline">{wikiCo.note}</span>}
            </div>
            {isMelee && (
              <div className="melee-row">
                <label htmlFor="combo">
                  Combo <b>{combo}x</b>
                  <span className="muted-inline"> ({(combo - 1) * hitsPerComboTier(weapon.name)} hits)</span>
                </label>
                <input
                  id="combo" type="range" min={1} max={maxCombo} step={1} value={combo}
                  onChange={(event) => setBuffs({ ...buffs, combo: Number(event.target.value) })}
                />
                {usesStance(weapon, attack) && weaponStances.length > 0 && (
                  <label>
                    Stance combo
                    <select value={stancePick} onChange={(event) => setStancePick(event.target.value)}>
                      <option value="auto">Best combo ({(() => { const best = bestCombo(weapon); return best ? comboLabel(best) : 'none' })()})</option>
                      {weaponStances.flatMap((name) => Object.entries(STANCES[name].combos).map(([combo, data]) => (
                        <option key={`${name}|${combo}`} value={`${name}|${combo}`}>
                          {comboLabel({ stance: name, combo })}: {data.hits} hits, {data.multiplier}x in {data.duration} s
                        </option>
                      )))}
                      <option value="none">No stance math (one 100% swing per attack speed)</option>
                    </select> <Info>Normal Attack DPS follows a stance combo on repeat: its hits per second and damage multipliers (wiki stance tables, length at 1.0 attack speed)</Info>
                  </label>
                )}
                {attack.heavy && attack.heavyMultiplier && heavyComboFor(weapon.name) && (
                  <label>
                    Heavy attack
                    <select value={heavyMode} onChange={(event) => setHeavyMode(event.target.value as HeavyMode)}>
                      <option value="biggestHit">Biggest hit</option>
                      <option value="fullCombo">Full heavy (all hits)</option>
                    </select> <Info>This heavy hits more than once. Biggest hit = one damage instance, full heavy = every hit added up</Info>
                  </label>
                )}
                <p className="muted">
                  What combo does
                  <Info>
                    Combo multiplies Heavy Attack / Heavy Slam damage and feeds Blood Rush, Weeping Wounds and the Gladiator set
                    (bonus × (combo − 1)) on every melee attack. Gladiator pieces on your Warframe are in the Warframe panel. Normal swings don't get the damage multiplier.
                    {attack.heavy && ' Heavies read the combo before spending it.'}
                  </Info>
                </p>
              </div>
            )}
          {(weaponPassives.length > 0 || showBonusElement) && (
            <PassivesPanel
              passives={weaponPassives}
              stacks={passiveStacks}
              attackName={attack.name}
              showBonusElement={showBonusElement}
              bonusElement={bonusElement}
              onStacksChange={setPassiveStacks}
              onBonusElementChange={setBonusElement}
            />
          )}

          {incarnonTiers && (
            <IncarnonPanel
              tiers={incarnonTiers}
              selection={incarnonSelection}
              stacks={perkStacks}
              isIncarnonAttack={isIncarnonAttackName(attack.name)}
              isMelee={weapon.category === 'Melee'}
              onSelectionChange={setIncarnonSelection}
              onStacksChange={setIncarnonStacks}
            />
          )}
          </section>

          <ModSlots
            weaponName={weapon.name}
            isMelee={isMelee}
            compatibleMods={compatibleMods}
            compatibleArcanes={compatibleArcanes}
            slots={slots}
            arcaneSlots={[arcaneSlot]}
            onArcanesChange={(next) => setArcaneSlot(next[0] ?? null)}
            polarities={polarities}
            hasCatalyst={hasCatalyst}
            onSlotsChange={setSlots}
            onPolaritiesChange={setPolarities}
            onCatalystChange={setHasCatalyst}
            riven={riven && rivenType ? {
              mod: riven,
              editor: (
                <RivenEditor type={rivenType} disposition={RIVEN_DISPOSITION}
                  config={rivenConfig} onChange={setRivenConfig} />
              ),
            } : null}
          />

          <BuildAdvisor
            input={{ ...calcInput, target }}
            compatibleMods={compatibleMods}
            compatibleArcanes={compatibleArcanes}
            keep={equippedMods.filter((slot) => slot.mod.uniqueName === RIVEN_MOD_ID)}
            onEquipArcane={(arcane) => setArcaneSlot({ arcaneId: arcane.arcane.uniqueName, rank: arcane.rank, conditionalStacks: arcane.conditionalStacks })}
            onAddMod={(mod, replaces) => {
              // into the slot of the mod it beats when the build is full, else the first free normal slot (the exilus
              // slot last, and only for exilus mods)
              const equipped = equipMod(mod, isMelee)
              const slot = { modId: mod.uniqueName, rank: equipped.rank, conditionalStacks: equipped.conditionalStacks }
              const replaceAt = replaces ? slots.findIndex((other) => other && modFor(other.modId)?.name === replaces) : -1
              const freeAt = slots.findIndex((other, index) => !other && index < EXILUS_SLOT)
              const target = replaceAt >= 0 ? replaceAt : freeAt >= 0 ? freeAt : mod.isExilus && !slots[EXILUS_SLOT] ? EXILUS_SLOT : -1
              if (target < 0) return
              setSlots(slots.map((other, index) => (index === target ? slot : other)))
            }}
            onLoadPath={(pathMods, pathArcane) => {
              // the riven keeps its slot, the path fills the rest in order
              const next = emptySlots()
              const rivenSlot = slots.find((slot) => slot?.modId === RIVEN_MOD_ID)
              let index = 0
              if (rivenSlot) next[index++] = rivenSlot
              for (const mod of pathMods) {
                if (index >= EXILUS_SLOT) break
                const equipped = equipMod(mod, isMelee)
                next[index++] = { modId: mod.uniqueName, rank: equipped.rank, conditionalStacks: equipped.conditionalStacks }
              }
              setSlots(next)
              setArcaneSlot(pathArcane ? { arcaneId: pathArcane.arcane.uniqueName, rank: pathArcane.rank, conditionalStacks: pathArcane.conditionalStacks } : null)
            }}
          />
          </div>

          <div className="build-col">
          <WarframePanel
            isMelee={isMelee} weapon={weapon}
            onWarframeChange={(state, corrosive) => { setWarframeState(state); setWarframeCorrosive(corrosive) }}
            loadRequest={frameLoad}
            onSnapshot={(snapshot) => { frameSnapshot.current = snapshot; setFrameVersion((version) => version + 1) }}
            restoreRequest={frameRestore}
            abilityTarget={{
              faction: target.faction, armor: resolveArmor(target),
              debuffs: { ...debuffs, corrosiveProjections: Math.min(4, debuffs.corrosiveProjections + warframeCorrosive) },
              health: scaledEnemy?.health ?? 0, shield: scaledEnemy?.shield ?? 0,
            }}
          />
          </div>
        </div>

      </div>
      <FormulaPanel result={result} />
    </>
  )
}
