// turns the hand-collected Incarnon perk text (src/data/incarnon.ts) into effects the calc understands
import { INCARNON_FAMILIES } from '../data/incarnon'
import { parseStatLine, triggerUptime, type ModEffect, type TriggerContext } from './parseMod'

export type PerkMode = 'both' | 'normal' | 'incarnon'
export type BaseStat = 'damage' | 'critChance' | 'critMultiplier' | 'statusChance' | 'multishot'

export type PerkEffect =
  | { kind: 'base'; stat: BaseStat; value: number } // added to the weapon's base stats before mods
  | { kind: 'flat'; stat: 'critChance' | 'statusChance'; value: number } // native Incarnons: added after mods
  | { kind: 'mod'; effect: ModEffect } // works like a mod line (+% Damage, +% Multishot, ...)
  | { kind: 'mods'; effects: ModEffect[] } // a line that's more than one mod effect (King's Gambit)
  | { kind: 'nonCritBonus'; chance: number; value: number } // Devouring/Devastating Attrition
  | { kind: 'armorStripPerPuncture'; value: number } // Latron's Flensing Spikes
  // Wiseman's Regard / Decisive Stature: base chance goes up by a share of the other modded chance, capped
  | { kind: 'convert'; stat: 'critChance' | 'statusChance'; from: 'critChance' | 'statusChance'; ratio: number; max: number }
  // Final Fusillade (Torid) / Forceful Finality (Burston): a base bonus on the last shot / burst of each magazine only
  | { kind: 'lastShot'; stat: 'multishot'; value: number; burst: boolean }
  // Plentiful Mayhem (Torid, Miter): every extra projectile from multishot uses a round of the magazine, and on Torid the
  // extra projectiles hit harder (or, in the Incarnon form, multishot bonuses are 60% bigger)
  | { kind: 'multishotCostsAmmo'; damage: number }
  // Incarnon Efficiency / Catalyst: "+50% Incarnon charge" per weak point hit, so the form refills in fewer hits
  | { kind: 'chargeGain'; value: number }
  // Survivor's Edge: "Base Status Chance set to 12%", replaces the base instead of adding to it
  | { kind: 'baseSet'; stat: 'critChance' | 'statusChance' | 'critMultiplier'; value: number }

export interface PerkStatement {
  text: string
  effect: PerkEffect | null // null = not modeled (ammo, recoil, combo...)
  mode: PerkMode
  condition: string | null
  maxStacks: number
}

export interface IncarnonPerk {
  tier: string
  name: string
  statements: PerkStatement[]
  maxStacks: number // 0 = no conditional part, 1 = on/off, more = stacks
}

export interface IncarnonTier {
  tier: string
  perks: IncarnonPerk[]
}

const TIER_ORDER = ['II', 'III', 'IV', 'V']
const percent = (text: string) => Number(text) / 100

function parsePerkBody(body: string, native: boolean): PerkEffect | null {
  // Attrition perks (Devouring on Laetum/Phenmor, Devastating on Felarx): the hit deals its normal damage plus 2000% on
  // top, so x21 total. wiki Phenmor's Evolution V section words it "+2000% damage" (the overview table drops the plus).
  // Underframe uses x20, I'm going with x21
  const nonCrit = body.match(/^([\d.]+)% chance (?:to deal|for) \+?([\d.]+)% Damage$/)
  if (nonCrit) return { kind: 'nonCritBonus', chance: percent(nonCrit[1]), value: percent(nonCrit[2]) }

  const armorStrip = body.match(/^Remove ([\d.]+)% Armor per Puncture stack$/)
  if (armorStrip) return { kind: 'armorStripPerPuncture', value: percent(armorStrip[1]) }

  // King's Gambit (Sicarus): "Bodyshots can't crit, weak point hits get +150% Critical Chance" -> two mod-like lines, the
  // second only counts on heads like Acuity's weak point crit
  const kingsGambit = body.match(/^Bodyshots can't crit, weak point hits get \+([\d.]+)% Critical Chance$/)
  if (kingsGambit) return { kind: 'mods', effects: [{ kind: 'noBodyCrit' }, { kind: 'stat', stat: 'weakpointCritChance', value: percent(kingsGambit[1]) }] }
  const baseSet = body.match(/^Base (Critical Chance|Status Chance|Critical Multiplier) set to ([\d.]+)(%|x)$/)
  if (baseSet) {
    const stat = baseSet[1] === 'Critical Chance' ? 'critChance' : baseSet[1] === 'Status Chance' ? 'statusChance' : 'critMultiplier'
    return { kind: 'baseSet', stat, value: baseSet[3] === '%' ? percent(baseSet[2]) : Number(baseSet[2]) }
  }
  // High Ground / Wiseman's Regard written the other way: "Converts 25% of current Status Chance to Base Critical Chance, max 35%"
  const converts = body.match(/^Converts ([\d.]+)% of current (Critical|Status) Chance to Base (Critical|Status) Chance, max ([\d.]+)%$/)
  const convert = converts ?? body.match(/^\+([\d.]+)% of current (Critical|Status) Chance as Base (Critical|Status) Chance, up to ([\d.]+)%$/)
  if (convert) {
    const statOf = (word: string) => (word === 'Critical' ? 'critChance' : 'statusChance')
    return { kind: 'convert', stat: statOf(convert[3]), from: statOf(convert[2]), ratio: percent(convert[1]), max: percent(convert[4]) }
  }
  // timed genesis buffs whose wiki text has no "Base" (Prolific Perforation, Piercing Stature): I read them as flat after mods
  const flatChance = body.match(/^([+-][\d.]+)% Flat (Critical|Status) Chance$/)
  if (flatChance) return { kind: 'flat', stat: flatChance[2] === 'Critical' ? 'critChance' : 'statusChance', value: percent(flatChance[1]) }

  const baseDamage = body.match(/^\+?(-?[\d.]+) Base Damage$/)
  if (baseDamage) return { kind: 'base', stat: 'damage', value: Number(baseDamage[1]) }
  const baseCrit = body.match(/^([+-][\d.]+)% Base Critical Chance$/)
  if (baseCrit) return { kind: 'base', stat: 'critChance', value: percent(baseCrit[1]) }
  const baseCritMultiplier = body.match(/^([+-][\d.]+)x? Base Critical Multiplier$/)
  if (baseCritMultiplier) return { kind: 'base', stat: 'critMultiplier', value: Number(baseCritMultiplier[1]) }
  const baseStatus = body.match(/^([+-][\d.]+)% Base Status Chance$/)
  if (baseStatus) return { kind: 'base', stat: 'statusChance', value: percent(baseStatus[1]) }
  const baseMultishot = body.match(/^([+-][\d.]+) Base Multishot$/)
  if (baseMultishot) return { kind: 'base', stat: 'multishot', value: Number(baseMultishot[1]) }

  // plain crit/status chance: the native Incarnons add these flat after mods. on genesis weapons the
  // wiki text is "Base" (my notes dropped the word in a couple of spots), so treat it as base there
  const plainChance = body.match(/^([+-][\d.]+)% (Critical|Status) Chance$/)
  if (plainChance) {
    const stat = plainChance[2] === 'Critical' ? 'critChance' : 'statusChance'
    return native ? { kind: 'flat', stat, value: percent(plainChance[1]) } : { kind: 'base', stat, value: percent(plainChance[1]) }
  }

  const modEffect = parseStatLine(body)
  return modEffect ? { kind: 'mod', effect: modEffect } : null
}

function parsePerkLine(effects: string, native: boolean): PerkStatement[] {
  const statements: PerkStatement[] = []
  let condition: string | null = null

  for (const rawStatement of effects.split(/;\s*/).map((part) => part.trim()).filter(Boolean)) {
    const stackCap = rawStatement.match(/^Stacks up to (\d+)x\.?$/)
    if (stackCap) {
      // the cap belongs to whatever condition is running
      for (const statement of statements) if (statement.condition === condition && condition) statement.maxStacks = Number(stackCap[1])
      continue
    }

    let text = rawStatement
    let mode: PerkMode = 'both'
    const modeTag = text.match(/\s*\[(Incarnon Form only|Normal only)\]$/)
    if (modeTag) {
      mode = modeTag[1] === 'Normal only' ? 'normal' : 'incarnon'
      text = text.slice(0, modeTag.index).trim()
    }

    // "On last shot in magazine: +3 Base Multishot" isn't a buff you keep up, it's one shot (or one burst) per magazine.
    // damage.ts spreads it over the magazine as an average
    const lastShot = text.match(/^On (last shot in magazine|final magazine burst):\s*\+([\d.]+) Base Multishot$/i)
    if (lastShot) {
      statements.push({ text: rawStatement, effect: { kind: 'lastShot', stat: 'multishot', value: Number(lastShot[2]), burst: /burst/i.test(lastShot[1]) }, mode, condition: null, maxStacks: 1 })
      continue
    }
    // the refill already assumes weak point hits, so "On Weakpoint Hit: +50% Incarnon charge" is just always on
    const chargeGain = text.match(/^On (?:Weakpoint Hit|Headshot):\s*\+([\d.]+)% Incarnon charge$/i)
    if (chargeGain) {
      statements.push({ text: rawStatement, effect: { kind: 'chargeGain', value: percent(chargeGain[1]) }, mode: 'both', condition: null, maxStacks: 1 })
      continue
    }
    const costsAmmo = text.match(/^Multishot consumes ammo from Capacity(?: and increases Damage by \+([\d.]+)%)?$/i)
    if (costsAmmo) {
      statements.push({ text: rawStatement, effect: { kind: 'multishotCostsAmmo', damage: costsAmmo[1] ? percent(costsAmmo[1]) : 0 }, mode, condition: null, maxStacks: 1 })
      continue
    }

    // "On Non-Critical Hit: 50% chance to deal 2000% Damage" is a chance roll, not something you toggle
    const nonCrit = text.match(/^On Non-Critical Hit:\s*(.+)$/)
    if (nonCrit) {
      statements.push({ text: rawStatement, effect: parsePerkBody(nonCrit[1], native), mode, condition: null, maxStacks: 1 })
      continue
    }

    // "When ...:" / "On ...:" starts a condition that sticks for the rest of the line
    const conditional = text.match(/^((?:When|On|While|With)\b[^:]*):\s*(.+)$/)
    if (conditional) {
      condition = conditional[1]
      text = conditional[2]
    }

    // "+10 Base Damage and +10% Fire Rate" -> two statements
    for (const part of text.split(/\s+and\s+(?=[+-]?\d)/)) {
      statements.push({ text: rawStatement, effect: parsePerkBody(part.trim(), native), mode, condition, maxStacks: 1 })
    }
  }
  return statements
}

// tiers + perks for one weapon. VARIANT lines win over ALL lines, and if neither matches I fall back to
// the family's first variant so the picker still shows something
export function getIncarnonTiers(weaponName: string): IncarnonTier[] | null {
  const family = INCARNON_FAMILIES.find((candidate) => candidate.variants.includes(weaponName))
  if (!family) return null

  const rows = family.lines
    .trim()
    .split('\n')
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length === 4)
    .map(([tier, name, variant, effects]) => ({ tier, name, variant, effects }))

  const tiers: IncarnonTier[] = []
  for (const tier of TIER_ORDER) {
    const perkNames = [...new Set(rows.filter((row) => row.tier === tier).map((row) => row.name))]
    if (!perkNames.length) continue
    const perks = perkNames.map((name) => {
      const candidates = rows.filter((row) => row.tier === tier && row.name === name)
      const row =
        candidates.find((candidate) => candidate.variant === weaponName) ??
        candidates.find((candidate) => candidate.variant === 'ALL') ??
        candidates[0]
      const statements = parsePerkLine(row.effects, Boolean(family.native))
      const conditionalStacks = statements.filter((statement) => statement.condition && statement.effect).map((statement) => statement.maxStacks)
      return { tier, name, statements, maxStacks: conditionalStacks.length ? Math.max(...conditionalStacks) : 0 }
    })
    tiers.push({ tier, perks })
  }
  return tiers
}

export interface SelectedPerk {
  perk: IncarnonPerk
  stacks: number // how many stacks of the conditional part are up (0 = off)
}

// how much of a perk's conditional part the usual fight assumes (the leaderboard, Compare, and a freshly picked perk in the
// calculator). same rules as mod conditionals (parseMod triggerUptime: max stacks, headshot hits off on body shots, kills
// off on the boss board), and on top of that the ones that need something the scenario doesn't have:
//  - another specific weapon equipped (Stalker's Vendetta / Resentment need Dread + Hate / Despair)
//  - a crowd or a position (enemies within 6 m, none within 5 m, impaling 5) or a hurt / fresh target (below half health,
//    undamaged, fewer than 3 statuses): the scenario is one full-health target with the build's own statuses on it
// status triggers ("On Puncture Status Effect", "On hitting Electricity-affected enemies") start at max like mods do, and the
// calc turns them back off when the build never applies that status (damage.ts statusTrigger). Prelude of Might's "When
// Critical Chance below 40%" is checked against the build's real crit chance there too
const NOT_IN_SCENARIO = /equipped(?!:)|Dread and|Hate and|within \d+ ?m|impaling|below half Health|undamaged|Undamaged|fewer than \d+ Status/i
export function perkConditionUptime(condition: string, context: TriggerContext): number {
  if (NOT_IN_SCENARIO.test(condition) && !/Melee Weapon equipped|No Primary equipped|equip from Primary/i.test(condition)) return 0
  return triggerUptime(condition, context)
}
export function scenarioPerkStacks(perk: IncarnonPerk, context: TriggerContext): number {
  if (!perk.maxStacks) return 0
  const uptimes = perk.statements.filter((statement) => statement.condition && statement.effect).map((statement) => perkConditionUptime(statement.condition!, context))
  return uptimes.length ? Math.floor(perk.maxStacks * Math.max(...uptimes)) : 0
}

// melee Incarnon form is a state, not a separate attack in the data, so mode tags don't filter melee
export const perkAppliesTo = (mode: PerkMode, isIncarnonAttack: boolean, isMelee: boolean) =>
  mode === 'both' || isMelee || (mode === 'incarnon') === isIncarnonAttack

// how a perk line stacks with mods, for the hover text (the game never says)
export function stackingNote(effect: PerkEffect | null): string | null {
  if (!effect) return null
  switch (effect.kind) {
    case 'base':
      return {
        damage: 'Added to the weapon\'s base damage before mods, so Serration-type mods, elements and CO all multiply it.',
        critChance: 'Added to the base crit chance, so Point Strike-type mods multiply it (+20% base with +200% mods = +60%).',
        critMultiplier: 'Added to the base crit multiplier, so Vital Sense-type mods multiply it.',
        statusChance: 'Added to the base status chance, so status chance mods multiply it.',
        multishot: 'Added to the base multishot, so multishot mods multiply it.',
      }[effect.stat]
    case 'flat':
      return `Flat ${effect.stat === 'critChance' ? 'crit' : 'status'} chance added after mods: mods don't multiply it, it just adds on at the end.`
    case 'lastShot':
      return `Only the last ${effect.burst ? 'burst' : 'shot'} of each magazine gets it, so over a magazine it's +${effect.value} spread across every shot (more with a small magazine).`
    case 'chargeGain':
      return `Each weak point hit fills ${Math.round(effect.value * 100)}% more of the gauge, so the Incarnon form comes back in fewer normal-form hits.`
    case 'multishotCostsAmmo':
      return 'Every extra projectile multishot adds uses a round, so a magazine lasts magazine / multishot trigger pulls.' +
        (effect.damage ? ` The extra projectiles get +${Math.round(effect.damage * 100)}% damage, multiplying with Serration (Incarnon form: multishot bonuses are 60% bigger instead).` : '')
    case 'baseSet':
      return `Replaces the base ${effect.stat === 'critMultiplier' ? 'crit multiplier' : effect.stat === 'critChance' ? 'crit chance' : 'status chance'} (other base bonuses don't add on top), then mods multiply it.`
    case 'mods':
      return 'Body shots never crit with it on. Weak point hits get the crit chance like Primary Acuity: in with crit mods, heads only.'
    case 'mod':
      return 'Works like one more mod line: it adds in with mods of the same stat (a +% Damage line adds to Serration, +% Multishot to Split Chamber).'
    case 'nonCritBonus':
      return `Multiplicative: a non-crit hit that rolls it does x${1 + effect.value} (the perk's "${Math.round((1 + effect.value) * 100)}% damage") on top of everything else, ` +
        'base damage mods like Serration, elements, faction and CO included, it doesn\'t add to Serration. ' +
        `${Math.round(effect.chance * 100)}% of non-crits roll it, and crits never do, so it fades out as crit chance goes up and does nothing at 100%+.`
    case 'armorStripPerPuncture':
      return 'Multiplies the armor that\'s left after Corrosive / Heat / other strips (it doesn\'t add to them). 5 Puncture stacks max.'
    case 'convert':
      return `Takes ${Math.round(effect.ratio * 100)}% of your ${effect.from === 'critChance' ? 'crit' : 'status'} chance after mods and adds it to the base ` +
        `${effect.stat === 'critChance' ? 'crit' : 'status'} chance (max ${Math.round(effect.max * 100)}%), so ${effect.stat === 'critChance' ? 'crit' : 'status'} mods then multiply it.`
  }
}
