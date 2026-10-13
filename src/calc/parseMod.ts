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

export type ModEffect =
  | { kind: 'stat'; stat: StatKey; value: number }
  | { kind: 'damageType'; damageType: string; value: number }
  | { kind: 'faction'; faction: string; value: number } // value is the bonus part, x1.3 -> 0.3
  | { kind: 'slashOnCrit'; value: number } // Hunter Munitions
  | { kind: 'slashOnImpact'; value: number } // Internal Bleeding
  | { kind: 'overguardMultiplier'; value: number } // Secondary Fortifier
  | { kind: 'damageMultiplier'; value: number } // separate multiplier, e.g. Longbow Sharpshot's next shot bonus

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
  [/^([+-][\d.]+)% Critical Chance(?: \(x[\d.]+ for Heavy Attacks\))?$/, 'critChance'],
  [/^([+-][\d.]+)% Critical Damage$/, 'critDamage'],
  [/^([+-][\d.]+)% Multishot$/, 'multishot'],
  [/^([+-][\d.]+)% (?:Fire Rate|Attack Speed)(?: \(x[\d.]+ for Bows\))?$/, 'fireRate'],
  [/^([+-][\d.]+)% Status Chance$/, 'statusChance'],
  [/^([+-][\d.]+)% Status Damage$/, 'statusDamage'],
  [/^([+-][\d.]+)% (?:to Headshot Multiplier|Headshot Damage)$/, 'headshotMultiplier'],
  [/^([+-][\d.]+)% Weak Point Damage$/, 'weakpointDamage'],
]

export function parseStatLine(line: string): ModEffect | null {
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

// works for mods and arcanes, both use the same levelStats text format
export function parseUpgrade(levelStats: string[][], rank: number): ParsedUpgrade {
  const parsed: ParsedUpgrade = { effects: [], conditionals: [], unparsed: [] }
  const lines = levelStats[Math.min(Math.max(rank, 0), levelStats.length - 1)] ?? []
  // arcanes repeat their passive lines: once inside the full description and once on their own.
  // the export uses a literal backslash-n between segments, not a real newline
  const splitSegments = (line: string) => line.split(/\\n|\n/).map((segment) => segment.trim()).filter(Boolean)
  const standaloneLines = new Set(lines.filter((line) => splitSegments(line).length === 1).map((line) => line.trim()))

  const addConditional = (trigger: string, body: string) => {
    const stackCount = body.match(/Stacks up to (\d+)x/)
    const stackPercentCap = body.match(/Stacks up to ([\d.]+)%/) // Cascadia Flare: "+12% ... Stacks up to 480%"
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
      const effect = parseStatLine(segment)
      if (effect) parsed.effects.push(effect)
      else parsed.unparsed.push(segment)
    }
  }
  return parsed
}

export const maxConditionalStacks = (levelStats: string[][], rank: number) =>
  Math.max(0, ...parseUpgrade(levelStats, rank).conditionals.map((conditional) => conditional.maxStacks))
