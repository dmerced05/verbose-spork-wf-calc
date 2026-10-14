import { DAMAGE_TYPES } from './constants'

export type StatKey =
  | 'damage'
  | 'damagePerStatusType' // Condition Overload, Galvanized Aptitude/Savvy/Shot
  | 'damagePerColdStack' // Secondary Shiver
  | 'critChance'
  | 'weakpointCritChance' // only on headshots: Primary Acuity, Cascadia Accuracy
  | 'critDamage'
  | 'multishot'
  | 'fireRate'
  | 'statusChance'
  | 'statusDamage'
  | 'headshotMultiplier'
  | 'weakpointDamage' // Primary/Secondary Acuity, added to the weak point multiplier (x1.5 on heads)
  | 'magazineCapacity'
  | 'reloadSpeed'
  | 'critChancePerCombo' // Blood Rush, x (combo multiplier - 1)
  | 'statusChancePerCombo' // Weeping Wounds, x (combo multiplier - 1)
  | 'heavyCritChance' // crit chance that only counts on heavy attacks (Melee Animosity, the 2nd half of "x2 for Heavy Attacks")
  | 'heavyDamage' // Killing Blow: "+120% Melee Damage on Heavy Attack"
  | 'heavyWindUpSpeed'
  | 'heavyEfficiency' // how much combo a heavy attack keeps
  | 'statusDuration' // longer DoTs = more ticks

export type ModEffect =
  | { kind: 'stat'; stat: StatKey; value: number }
  | { kind: 'damageType'; damageType: string; value: number }
  | { kind: 'faction'; faction: string; value: number } // value is the bonus part, x1.3 -> 0.3
  | { kind: 'slashOnCrit'; value: number } // Hunter Munitions
  | { kind: 'slashOnImpact'; value: number } // Internal Bleeding
  | { kind: 'overguardMultiplier'; value: number } // Secondary Fortifier
  | { kind: 'damageMultiplier'; value: number } // separate multiplier, e.g. Longbow Sharpshot's next shot bonus
  | { kind: 'lockMultishot' } // Primary/Pistol Acuity: multishot mods stop working
  | { kind: 'heavyScaledCritChance'; value: number; heavyFactor: number } // "(x2 for Heavy Attacks)"

export interface ConditionalEffect {
  trigger: string // "On Kill:", "On Toxin Status Effect:", "While Overshields Active:" ...
  effect: ModEffect
  maxStacks: number
}

export interface ParsedUpgrade {
  effects: ModEffect[]
  conditionals: ConditionalEffect[]
  unparsed: string[] // lines I don't model yet, shown in the UI so nothing fails silently
}

const percent = (text: string) => Number(text) / 100

// anchored on purpose so stuff like "+40% Critical Chance stacks with Combo Multiplier" doesn't match
const STAT_PATTERNS: [RegExp, StatKey][] = [
  [/^([+-][\d.]+)% (?:Melee |Direct )?Damage (?:per|for each) Status Type affecting (?:the )?target$/i, 'damagePerStatusType'],
  [/^([+-][\d.]+)% (?:Melee )?[Dd]amage$/, 'damage'],
  [/^Enemies take ([+-][\d.]+)% damage per Cold Status$/i, 'damagePerColdStack'],
  [/^([+-][\d.]+)% (?:Weak Point Critical Chance|Critical Chance on Weakpoint Hits)\b/, 'weakpointCritChance'],
  [/^([+-][\d.]+)% Critical Chance$/, 'critChance'],
  [/^([+-][\d.]+)% Critical Chance stacks with Combo Multiplier$/, 'critChancePerCombo'],
  [/^([+-][\d.]+)% Status Chance per Combo Multiplier$/, 'statusChancePerCombo'],
  [/^([+-][\d.]+)% Critical Chance on (?:your )?next Heavy Attack\b/, 'heavyCritChance'],
  [/^([+-][\d.]+)% (?:Melee )?Damage on Heavy Attacks?\b/, 'heavyDamage'],
  [/^([+-][\d.]+)% Heavy Attack Wind Up Speed$/, 'heavyWindUpSpeed'],
  [/^([+-][\d.]+)% Heavy Attack Efficiency$/, 'heavyEfficiency'],
  [/^([+-][\d.]+)% Status Duration$/, 'statusDuration'],
  [/^([+-][\d.]+)% Critical Damage$/, 'critDamage'],
  [/^([+-][\d.]+)% Multishot$/, 'multishot'],
  [/^([+-][\d.]+)% (?:Fire Rate|Attack Speed)(?: \(x[\d.]+ for Bows\))?$/, 'fireRate'],
  [/^([+-][\d.]+)% Status Chance$/, 'statusChance'],
  [/^([+-][\d.]+)% Status Damage$/, 'statusDamage'],
  [/^([+-][\d.]+)% (?:to Headshot Multiplier|Headshot Damage)$/, 'headshotMultiplier'],
  [/^([+-][\d.]+)% Weak Point Damage$/, 'weakpointDamage'],
  [/^([+-][\d.]+)% Magazine Capacity$/, 'magazineCapacity'],
  [/^([+-][\d.]+)% Reload Speed$/, 'reloadSpeed'],
]

export function parseStatLine(line: string): ModEffect | null {
  // True Steel family: "+120% Critical Chance (x2 for Heavy Attacks)". per the Galvanized Steel hotfix, heavies get
  // the doubled value instead of the normal one (+240% total, not +360%)
  const heavyScaled = line.match(/^([+-][\d.]+)% Critical Chance \(x([\d.]+) for Heavy Attacks\)$/)
  if (heavyScaled) return { kind: 'heavyScaledCritChance', value: percent(heavyScaled[1]), heavyFactor: Number(heavyScaled[2]) }

  for (const [pattern, stat] of STAT_PATTERNS) {
    const match = line.match(pattern)
    if (match) return { kind: 'stat', stat, value: percent(match[1]) }
  }

  // "+90% Heat", also "+60% Corrosive Damage" (Melee Exposure)
  const damageTypeMatch = line.match(/^([+-][\d.]+)% (\w+)(?: Damage)?$/)
  if (damageTypeMatch && DAMAGE_TYPES.includes(damageTypeMatch[2].toLowerCase())) {
    return { kind: 'damageType', damageType: damageTypeMatch[2].toLowerCase(), value: percent(damageTypeMatch[1]) }
  }

  const factionMatch = line.match(/^x([\d.]+) Damage to (?:the )?(\w+)$/)
  if (factionMatch) return { kind: 'faction', faction: factionMatch[2], value: Number(factionMatch[1]) - 1 }

  const slashOnCritMatch = line.match(/^\+?([\d.]+)% chance to apply Slash on Critical$/)
  if (slashOnCritMatch) return { kind: 'slashOnCrit', value: percent(slashOnCritMatch[1]) }

  const slashOnImpactMatch = line.match(/^Impact Status Effects have ([\d.]+)% chance to apply a Slash Status Effect/)
  if (slashOnImpactMatch) return { kind: 'slashOnImpact', value: percent(slashOnImpactMatch[1]) }

  const overguardMatch = line.match(/^Deals x([\d.]+) Extra Damage to Overguard\.?$/)
  if (overguardMatch) return { kind: 'overguardMultiplier', value: Number(overguardMatch[1]) }

  return null
}

// strips the duration/stack tails and filler words so the stat part parses like a normal mod line
const cleanConditionalBody = (body: string) => {
  const cleaned = body
    .replace(/^Gain\s+/i, '')
    .replace(/\s+when Aiming.*$/, '')
    .replace(/\s+on (?:your )?next shot\.?$/i, '')
    .replace(/\s+on Melee strikes/i, '')
    .replace(/\s+for [\d.]+s\.?.*$/, '')
    .replace(/\.$/, '')
    .trim()
  return /^\d/.test(cleaned) ? `+${cleaned}` : cleaned // "60% Corrosive" -> "+60% Corrosive"
}

// parsing is regex-heavy and the optimizer calls the calc millions of times, so results are cached
// per levelStats array (each mod/arcane has its own) and rank
const parseCache = new WeakMap<string[][], Map<number, ParsedUpgrade>>()

export function parseUpgrade(levelStats: string[][], rank: number): ParsedUpgrade {
  let byRank = parseCache.get(levelStats)
  if (!byRank) parseCache.set(levelStats, (byRank = new Map()))
  let parsed = byRank.get(rank)
  if (!parsed) byRank.set(rank, (parsed = parseUpgradeUncached(levelStats, rank)))
  return parsed
}

// works for mods and arcanes, both use the same levelStats text format
function parseUpgradeUncached(levelStats: string[][], rank: number): ParsedUpgrade {
  const parsed: ParsedUpgrade = { effects: [], conditionals: [], unparsed: [] }
  const lines = levelStats[Math.min(Math.max(rank, 0), levelStats.length - 1)] ?? []
  // arcanes repeat their passive lines: once inside the full description and once on their own.
  // the export uses a literal backslash-n between segments, not a real newline
  const splitSegments = (line: string) => line.split(/\\n|\n/).map((segment) => segment.trim()).filter(Boolean)
  const standaloneLines = new Set(lines.filter((line) => splitSegments(line).length === 1).map((line) => line.trim()))

  const addConditional = (trigger: string, body: string) => {
    const stackCount = body.match(/Stacks up to (\d+)x/)
    // Cascadia Flare: "+12% ... Stacks up to 480%", Melee Animosity: "42% Critical Chance on your next Heavy Attack, up to 420%"
    const stackPercentCap = body.match(/(?:Stacks|,) up to ([\d.]+)%/)
    const parts = cleanConditionalBody(body).split(/\s+and\s+(?=[+-]?\d)/)
    for (const part of parts) {
      const effect = parseStatLine(/^\d/.test(part) ? `+${part}` : part)
      if (!effect) {
        parsed.unparsed.push(`${trigger} ${part}`)
        continue
      }
      // "next shot" bonuses (Longbow Sharpshot) are their own multiplier, the CO wiki page lists them
      // with range falloff as multipliers that additive CO ignores
      if (/next shot/i.test(body) && effect.kind === 'stat' && effect.stat === 'damage') {
        parsed.conditionals.push({ trigger, effect: { kind: 'damageMultiplier', value: effect.value }, maxStacks: 1 })
        continue
      }
      let maxStacks = stackCount ? Number(stackCount[1]) : 1
      if (stackPercentCap && 'value' in effect && effect.value > 0) {
        maxStacks = Math.round(percent(stackPercentCap[1]) / effect.value)
      }
      parsed.conditionals.push({ trigger, effect, maxStacks })
    }
  }

  for (const line of lines) {
    const segments = splitSegments(line)
    let trigger: string | null = null

    for (const segment of segments) {
      if (segments.length > 1 && standaloneLines.has(segment)) continue // it gets parsed on its own line
      if (segment.endsWith(':')) {
        trigger = segment
        continue
      }
      const inlineTrigger = segment.match(/^((?:On|While|After) [^:]+):\s*(.+)$/)
      if (inlineTrigger) {
        addConditional(`${inlineTrigger[1]}:`, inlineTrigger[2])
        continue
      }
      if (trigger) {
        addConditional(trigger, segment)
        continue
      }
      // Primary Bulwark: "Gain +1% damage for each unit of armor past 1,000, up to a max of +500%". one stack = one armor
      // point past the threshold, so the stepper reads as "armor over 1,000"
      const armorScaling = segment.match(/^Gain \+?([\d.]+)% damage for each unit of armor past ([\d,]+), up to a max of \+?([\d.]+)%/i)
      if (armorScaling) {
        const perArmor = percent(armorScaling[1])
        parsed.conditionals.push({
          trigger: `Warframe armor past ${armorScaling[2]} (1 stack = 1 armor):`,
          effect: { kind: 'stat', stat: 'damage', value: perArmor },
          maxStacks: Math.round(percent(armorScaling[3]) / perArmor),
        })
        continue
      }
      const effect = parseStatLine(segment)
      if (effect) parsed.effects.push(effect)
      else parsed.unparsed.push(segment)
      // Acuity tacks its drawback onto the crit line: "+350% Weak Point Critical Chance. Multishot cannot be modified."
      if (/Multishot cannot be modified/i.test(segment)) parsed.effects.push({ kind: 'lockMultishot' })
    }
  }
  return parsed
}

export const maxConditionalStacks = (levelStats: string[][], rank: number, includeTrigger: (trigger: string) => boolean = () => true) =>
  Math.max(
    0,
    ...parseUpgrade(levelStats, rank)
      .conditionals.filter((conditional) => includeTrigger(conditional.trigger))
      .map((conditional) => conditional.maxStacks),
  )

// fire rate / attack speed mods (positive only, so Critical Delay's -fire rate doesn't count), for the "FR" tag and the
// leaderboard's "no fire rate mods" rankings
export const raisesFireRate = (levelStats: string[][], rank = levelStats.length - 1) => {
  const parsed = parseUpgrade(levelStats, rank)
  return [...parsed.effects, ...parsed.conditionals.map((conditional) => conditional.effect)].some(
    (effect) => effect.kind === 'stat' && effect.stat === 'fireRate' && effect.value > 0,
  )
}

export const isHeadshotTrigger = (trigger: string) => /headshot|weak ?point/i.test(trigger)

// how much of a conditional the "usual fight" assumes (leaderboard scenario, and the default when you equip something).
// most triggers are easy to keep up, so they sit at max stacks. the exceptions:
//  - headshot / weak point *hit* triggers (Primary Crux, Longbow Sharpshot): off when the scenario is body shots.
//    headshot *kill* triggers (Deadhead) stay on, the buff then works on every shot
//  - melee kills on a gun (Primary/Secondary Dexterity): you have to swap and kill with melee, so half the stacks
//  - armor thresholds (Primary Bulwark): needs a tank frame, half of the max (+250%)
export function triggerUptime(trigger: string, { isMelee, bodyShots }: { isMelee: boolean; bodyShots: boolean }): number {
  if (isHeadshotTrigger(trigger) && !/kill/i.test(trigger)) return bodyShots ? 0 : 1
  if (/melee kill/i.test(trigger) && !isMelee) return 0.5
  if (/armor past/i.test(trigger)) return 0.5
  return 1
}

export const defaultConditionalStacks = (levelStats: string[][], rank: number, context: { isMelee: boolean; bodyShots: boolean }) =>
  Math.max(
    0,
    ...parseUpgrade(levelStats, rank).conditionals.map((conditional) =>
      Math.floor(conditional.maxStacks * triggerUptime(conditional.trigger, context)),
    ),
  )

// stuff that doesn't show up in a body-shot damage score but is still worth having when two picks tie
// (Deadhead's headshot multiplier, Merciless's reload speed)
// reload counts half when the ranking is a single hit (no reloads in it), so Deadhead beats Merciless there
export const utilityValue = (levelStats: string[][], rank: number, singleHit = false) => {
  const parsed = parseUpgrade(levelStats, rank)
  const weights: Record<string, number> = {
    headshotMultiplier: 1, weakpointDamage: 1, weakpointCritChance: 1, reloadSpeed: singleHit ? 0.5 : 1,
  }
  return [...parsed.effects, ...parsed.conditionals.map((conditional) => conditional.effect)].reduce(
    (total, effect) => (effect.kind === 'stat' && effect.stat in weights ? total + Math.max(0, effect.value) * weights[effect.stat] : total),
    0,
  )
}
