// weapon augment lines too odd for the normal stat patterns, one rule each. values come from the line itself so lower
// ranks still scale. the trigger text ends up in the results' "This build assumes" list, so it says what has to happen.
// lines that don't change damage at all (ammo, accuracy, projectile speed...) are dropped instead of listed as "not modeled"
import type { ModEffect } from './parseMod'

export type SpecialLine = { ignore: true } | { trigger?: string; maxStacks?: number; effects: ModEffect[] }

const pct = (text: string) => Number(text.replace(/,/g, '')) / 100
const stat = (key: Extract<ModEffect, { kind: 'stat' }>['stat'], value: number): ModEffect => ({ kind: 'stat', stat: key, value })
const element = (name: string, value: number): ModEffect => ({ kind: 'damageType', damageType: name.toLowerCase() === 'electric' ? 'electricity' : name.toLowerCase(), value })

const RULES: [RegExp, (match: RegExpMatchArray) => SpecialLine][] = [
  // Secondary Enervate: "On Hit: Increase Critical Chance by 10%. Resets after 6 Big Critical Hit". the calc averages it
  // over a whole build-up-and-reset cycle (damage.ts enervateAverageCrit)
  [/^Increase Critical Chance by ([\d.]+)%\.? Resets after (\d+) Big Critical Hits?/i, (m) => ({
    trigger: 'On Hit (stacks until big crits reset it):', effects: [{ kind: 'critPerHit', value: pct(m[1]), resetsAfter: Number(m[2]) }],
  })],
  // Biotic Rounds: "+150% Viral and Magnetic Damage and Status Chance", Leaded Gas: "+300% Gas Damage and Status Chance"
  [/^\+?([\d.]+)% (\w+)(?: and (\w+))? Damage and Status Chance$/i, (m) => ({
    effects: [element(m[2], pct(m[1])), ...(m[3] ? [element(m[3], pct(m[1]))] : []), stat('statusChance', pct(m[1]))],
  })],
  // Burning Hate
  [/become vulnerable to ([\d.]+)% more Status Damage/i, (m) => ({ trigger: 'Target has a Heat status:', effects: [stat('statusDamage', pct(m[1]))] })],
  // Clip Delegation: "Next Magazine has Status Chance and Multishot increased by 15% per shot landed ... Max 15 stacks"
  [/Status Chance and Multishot increased by ([\d.]+)% per shot landed.*Max (\d+) stacks/i, (m) => ({
    trigger: 'Shots landed with the last magazine:', maxStacks: Number(m[2]), effects: [stat('statusChance', pct(m[1])), stat('multishot', pct(m[1]))],
  })],
  // Combat Reload
  [/^If (\d+) pellets are headshots, increase reload speed by \+?([\d.]+)%/i, (m) => ({ trigger: `${m[1]} pellets hit the head (headshots):`, effects: [stat('reloadSpeed', pct(m[2]))] })],
  // Critical Mutation: "Each kill increases Critical Chance and Critical Damage by 30% up to 300%"
  [/^Each kill increases Critical Chance and Critical Damage by ([\d.]+)% up to ([\d.]+)%/i, (m) => ({
    trigger: 'On Kill:', maxStacks: Math.round(Number(m[2]) / Number(m[1])), effects: [stat('critChance', pct(m[1])), stat('critDamage', pct(m[1]))],
  })],
  // Critical Precision: "Burst Fire Only: Headshots increase Critical Chance by 10% up to 500%"
  [/Headshots increase Critical Chance by ([\d.]+)% up to ([\d.]+)%/i, (m) => ({
    trigger: 'On Headshot (burst fire):', maxStacks: Math.round(Number(m[2]) / Number(m[1])), effects: [stat('critChance', pct(m[1]))],
  })],
  // Deadly Maneuvers
  [/^On Dodge, gain ([\d.]+)% Headshot Critical Chance for your next (\d+) shots/i, (m) => ({ trigger: `After a dodge (next ${m[2]} shots, headshots):`, effects: [stat('weakpointCritChance', pct(m[1]))] })],
  // Double Tap: "ON HIT: +20% Bonus Damage on next Shot"
  // Double Tap: "ON HIT: 20% Bonus Damage on next Shot for 2s. Stacks up to 20x outside of Conclave."
  [/^(?:ON HIT: )?\+?([\d.]+)% Bonus Damage on next Shot/i, (m) => ({ trigger: 'On Hit (consecutive hits, next shot):', maxStacks: 20, effects: [{ kind: 'damageMultiplier', value: pct(m[1]) }] })],
  [/^ON HIT:\s*$|^Stacks up to \d+x/i, () => ({ ignore: true })],
  // Dreadful Killshot: "+20% for every 75 Warframe Health. Capped at 360%" (stacks come from the Warframe panel's health)
  [/^Increased Damage and Status Chance by \+?([\d.]+)% for every ([\d,]+) Warframe Health\. Capped at ([\d.]+)%/i, (m) => ({
    trigger: `Warframe health per ${m[2]}:`, maxStacks: Math.round(Number(m[3]) / Number(m[1])), effects: [stat('damage', pct(m[1])), stat('statusChance', pct(m[1]))],
  })],
  // Entropy Burst / Napalm Grenades: "+20 Final Status Chance"
  [/^\+([\d.]+) Final Status Chance$/i, (m) => ({ effects: [{ kind: 'flatStat', stat: 'statusChance', value: pct(m[1]) }] })],
  // Exposing Harpoon
  [/^Pulling an enemy will give \+?([\d.]+)% Critical Chance/i, (m) => ({ trigger: 'After pulling an enemy:', effects: [stat('critChance', pct(m[1]))] })],
  // Eximus Advantage
  [/^Headshots on Eximus enemies increase Secondary Damage by \+?([\d.]+)%/i, (m) => ({ trigger: 'On Headshot on an Eximus:', effects: [stat('damage', pct(m[1]))] })],
  // Flux Overdrive: swings between the two, so the middle
  [/^Status Chance fluctuates between \+?([\d.]+)% and \+?([\d.]+)%/i, (m) => ({ effects: [stat('statusChance', (pct(m[1]) + pct(m[2])) / 2)] })],
  // Hata-Satya: grows each hit until the reload, half a 200-round Soma Prime magazine on average
  [/^Each hit increases Critical Chance by ([\d.]+)%\. Resets upon reloading/i, (m) => ({
    trigger: 'Hits since the last reload (100 = half a magazine):', maxStacks: 100, effects: [stat('critChance', pct(m[1]))],
  })],
  // Necrophagic Vigor: "+20% for every 20 Health drained. Capped at 360%"
  [/Critical Chance and Critical Damage by \+?([\d.]+)% for every ([\d,]+) Health drained\. Capped at ([\d.]+)%/i, (m) => ({
    trigger: `Health drained on reload (per ${m[2]}):`, maxStacks: Math.round(Number(m[3]) / Number(m[1])), effects: [stat('critChance', pct(m[1])), stat('critDamage', pct(m[1]))],
  })],
  // Range Advantage
  [/^\+?([\d.]+)% damage if no enemies are within (\d+)m/i, (m) => ({ trigger: `No enemies within ${m[2]}m:`, effects: [stat('damage', pct(m[1]))] })],
  // Sentient Surge (3 Tendrils assumed max)
  [/Status Chance and Critical Chance are increased by ([\d.]+)% for each Tendril active/i, (m) => ({
    trigger: 'Per active Tendril (3 max assumed):', maxStacks: 3, effects: [stat('statusChance', pct(m[1])), stat('critChance', pct(m[1]))],
  })],
  // Spring-Loaded Broadhead, split over two lines
  [/^Increase damage by \+?([\d.]+)%$/i, (m) => ({ trigger: 'Target over 15m away:', effects: [stat('damage', pct(m[1]))] })],
  [/^if the target is over \d+m away\.?$/i, () => ({ ignore: true })],
  // Unseen Dread
  [/Deal ([\d.]+)% more Critical Damage with \w+ while invisible/i, (m) => ({ trigger: 'While invisible:', effects: [stat('critDamage', pct(m[1]))] })],
  // Prototype Shock Coils: "+90% Electric damage, and shots have a 20% base chance to apply extra Electric status"
  [/^Adds \+?([\d.]+)% Electric damage, and shots have a ([\d.]+)% base chance to apply extra Electric status/i, (m) => ({
    effects: [element('electricity', pct(m[1])), { kind: 'forcedProcChance', damageType: 'electricity', value: pct(m[2]) }],
  })],
  // Lasting Purity
  [/^\+?([\d.]+)% Damage when Aiming$/i, (m) => ({ trigger: 'When Aiming:', effects: [stat('damage', pct(m[1]))] })],
  // Volatile Variant: "Barbs that strike enemies directly have +4m radius and +50% Status Chance"
  [/strike enemies directly have .*\+([\d.]+)% Status Chance/i, (m) => ({ effects: [stat('statusChance', pct(m[1]))] })],
  // Precision Strike
  [/^Hitting an enemy directly with the grenade increases Reload Speed by ([\d.]+)%/i, (m) => ({ trigger: 'After a direct grenade hit:', effects: [stat('reloadSpeed', pct(m[1]))] })],
  // no damage in these: ammo, aim, travel, utility
  [/Ammo Efficiency|Accuracy|Projectile Speed|Zoom|Punch Through|^\+1 '|Life Steal|Gore Chance|Combo Duration|Combo Count Chance|Ammo Maximum|Beam Range|Blast Radius|Falloff Distance|Shield Recharge|Universal Orb|Energy Orb|Health Orbs|Chance to Explode|bounce up to|chance to pickup|disarm|Nullifier|tether|stick to surfaces|open them to finishers|Hacking/i, () => ({ ignore: true })],
]

export function specialLine(text: string): SpecialLine | null {
  for (const [pattern, build] of RULES) {
    const match = text.match(pattern)
    if (match) return build(match)
  }
  return null
}
