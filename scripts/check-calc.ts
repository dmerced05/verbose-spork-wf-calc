// checks the calc against worked examples from the wiki. run with: npm run check
import { calculate, type CalcInput } from '../src/calc/damage'
import { STATUS_TYPES } from '../src/calc/constants'
import { arcanes, getCompatibleMods, mods, warframes, weapons } from '../src/data'
import { warframeTotals } from '../src/calc/warframeStats'
import { scaleArmor, scaleHealth } from '../src/calc/target'
import { estimateKill } from '../src/calc/kill'
import { resolveCoBehavior } from '../src/calc/conditionOverload'
import { getIncarnonTiers } from '../src/calc/incarnon'
import { INCARNON_FAMILIES } from '../src/data/incarnon'
import { passivesFor } from '../src/data/passives'
import { modsConflict } from '../src/calc/modConflicts'
import { defaultConditionalStacks, parseUpgrade } from '../src/calc/parseMod'
import { optimizeAttack } from '../src/optimizer/optimize'
import { objectiveById } from '../src/optimizer/objectives'
import type { Attack, Debuffs, EquippedMod, Mod, Weapon } from '../src/types'
import { canSubsumeInto, type WarframeState } from '../src/data/warframeAbilities'
type EquippedModList = EquippedMod[]

let failures = 0
const expectClose = (label: string, actual: number, expected: number) => {
  const ok = Math.abs(actual - expected) < 1e-6 * Math.max(1, Math.abs(expected))
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${actual}, expected ${expected}`)
}

const noDebuffs = (): Debuffs => ({
  stacks: Object.fromEntries(STATUS_TYPES.map((statusType) => [statusType, 0])),
  heatArmorStrip: 0, corrosiveProjections: 0, otherArmorReduction: 0, damageVulnerability: 0, liftedOrKnockedDown: false, statusTypeSource: 'debuffs',
})
const testAttack = (damage: Record<string, number>, extra: Partial<Attack> = {}): Attack => ({
  name: 'Test', isAoE: false, fireRate: 1, critChance: 0, critMultiplier: 2, statusChance: 0, damage, ...extra,
})
const testWeapon = (attack: Attack): Weapon => ({
  uniqueName: 'test', name: 'Test Rifle', type: 'Rifle', category: 'Primary', disposition: 1, multishot: 1, imageName: null, polarities: [], isBow: false, attacks: [attack],
})
const findMod = (name: string): Mod => mods.find((mod) => mod.name === name && mod.type === 'Primary Mod')!
const maxed = (name: string) => ({ mod: findMod(name), rank: findMod(name).fusionLimit, conditionalStacks: 0 })
const run = (attack: Attack, overrides: Partial<CalcInput> = {}) =>
  calculate({
    weapon: testWeapon(attack), attack, mods: [], armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 },
    target: { faction: 'None', layer: 'health', enemyId: null, baseLevel: 1, level: 1, steelPath: false, manualArmor: 0, headshot: false, headshotMultiplier: 3, headcrit: false },
    ...overrides,
  })
const typeValue = (result: ReturnType<typeof run>, damageType: string) =>
  result.damageTypes.find((row) => row.damageType === damageType)?.modded ?? 0

// Damage/Calculation: 30/30/40 quantizes to 31.25/31.25/40.625
const quantized = run(testAttack({ impact: 30, puncture: 30, slash: 40 }))
expectClose('quantize impact', typeValue(quantized, 'impact'), 31.25)
expectClose('quantize slash', typeValue(quantized, 'slash'), 40.625)

// Faction_Damage_Bonus: 100 x (1 + 1.65) x (1 + 0.5 + 0.3) = 477 (Serration, Roar, Bane of Grineer)
const slashAttack = testAttack({ slash: 100 })
const grineerTarget = { faction: 'Grineer', layer: 'health' as const, enemyId: null, baseLevel: 1, level: 1, steelPath: false, manualArmor: 0, headshot: false, headshotMultiplier: 3, headcrit: false }
const roarBane = run(slashAttack, { mods: [maxed('Serration'), maxed('Bane Of Grineer')], buffs: { roar: 0.5 }, target: grineerTarget })
expectClose('Serration + Roar + Bane', roarBane.hit.average, 477)

// Faction_Damage_Bonus: Slash tick with Roar = 0.35 x 100 x 1.5 x 1.5 = 78.75 (faction applies twice)
const roarTick = run(testAttack({ slash: 100 }, { statusChance: 1 }), { buffs: { roar: 0.5 } })
expectClose('Roar slash tick', roarTick.dots.find((dot) => dot.damageType === 'slash')!.tick.average, 78.75)

// Viral: 10 stacks = x4.25 to health
const viral = run(slashAttack, { debuffs: { ...noDebuffs(), stacks: { ...noDebuffs().stacks, viral: 10 } } })
expectClose('Viral x10', viral.hit.average, 425)

// Heat: (1 - 50%) x (1 - 80% corrosive) x (1 - 18% x 4 CP) on 1000 armor = 28
const stripped = run(slashAttack, {
  armor: 1000,
  debuffs: { ...noDebuffs(), stacks: { ...noDebuffs().stacks, corrosive: 10, heat: 1 }, heatArmorStrip: 0.5, corrosiveProjections: 4 },
})
expectClose('armor strip', stripped.armor.after, 28)
expectClose('armor DM at 28', stripped.armor.damageMultiplier, 1 - 0.9 * Math.sqrt(28 / 2700))

// Cold: 1.6x base with +110% crit damage and 9 stacks = 1.6 x 2.1 + 0.5 = 3.86 (Kunai example)
const cold = run(testAttack({ slash: 100 }, { critMultiplier: 1.6 }), {
  mods: [{ mod: mods.find((mod) => mod.name === 'Primed Target Cracker')!, rank: 10, conditionalStacks: 0 }],
  debuffs: { ...noDebuffs(), stacks: { ...noDebuffs().stacks, cold: 9 } },
})
expectClose('Cold crit multiplier', cold.critMultiplier, 3.86)

// fake mods so the wiki examples use exactly their numbers
const fakeMod = (name: string, lines: string[]): Mod => ({
  uniqueName: `fake/${name}`, name, type: 'Primary Mod', compatName: 'Rifle', polarity: null, rarity: null,
  baseDrain: 0, fusionLimit: 0, imageName: null, isExilus: false, levelStats: [lines],
})
const equipFake = (name: string, lines: string[]) => ({ mod: fakeMod(name, lines), rank: 0, conditionalStacks: 0 })
const dotOf = (result: ReturnType<typeof run>, damageType: string) => result.dots.find((dot) => dot.damageType === damageType)!

// Damage_over_Time: Bleed = 100 x 2.65 x 0.35 x 1.3^2 x 1.9 = 297.8202
const bleed = run(testAttack({ slash: 100 }, { statusChance: 1 }), {
  mods: [equipFake('Serration', ['+165% Damage']), equipFake('Elementalist', ['+90% Status Damage'])],
  buffs: { roar: 0.3 },
})
expectClose('Bleed tick (wiki)', dotOf(bleed, 'slash').tick.average, 297.8202)
expectClose('Bleed per proc = 6 ticks', dotOf(bleed, 'slash').perProc.average, 297.8202 * 6)

// Gas: 180 base, +220% dmg, +30% faction, +300% gas, +90% status dmg -> 0.5 x 748.8 x 4 x 1.3 x 1.9 = 3699.072
const gas = run(testAttack({ impact: 180 }, { statusChance: 1 }), {
  mods: [equipFake('Hornet Strike', ['+220% Damage']), equipFake('Leaded Gas', ['+300% Gas']), equipFake('Elementalist', ['+90% Status Damage'])],
  buffs: { roar: 0.3 },
})
expectClose('Gas tick (wiki)', dotOf(gas, 'gas').tick.average, 3699.072)

// Blast: 100 base, +60% heat +60% cold +90% elec, x1.55 faction -> 0.3 x 100 x 1.55^2 = 72.075 (element mods don't count)
const blast = run(testAttack({ impact: 100 }, { statusChance: 1 }), {
  mods: [equipFake('Thermite', ['+60% Heat']), equipFake('Rime', ['+60% Cold']), equipFake('Stormbringer', ['+90% Electricity'])],
  buffs: { roar: 0.55 },
})
expectClose('Blast proc (wiki)', dotOf(blast, 'blast').perProc.average, 72.075)
expectClose('Blast 10-stack AoE = 300%', dotOf(blast, 'blast').aoe!.damage.average, 3 * 100 * 1.55 ** 2)
// the wiki's 480.5 for this hit skips quantization. quantized: blast 1.2 -> 38/32, elec 0.9 -> 29/32
expectClose('Initial hit, quantized', blast.hit.average, 100 * (1 + 38 / 32 + 29 / 32) * 1.55)

// crit split: 50% crit, 2x -> non-crit tick, crit tick doubles, average 1.5x
const critDot = run(testAttack({ slash: 100 }, { statusChance: 1, critChance: 0.5, critMultiplier: 2 }))
expectClose('Bleed crit tick = 2x non-crit', dotOf(critDot, 'slash').tick.crit, 2 * dotOf(critDot, 'slash').tick.normal)
expectClose('Bleed avg tick', dotOf(critDot, 'slash').tick.average, 35 * 1.5)

// arcanes: Merciless at 12 stacks adds 360% to the damage mods, additive with Serration -> 100 x (1 + 1.65 + 3.6)
const merciless = arcanes.find((arcane) => arcane.name === 'Primary Merciless')!
const withMerciless = run(testAttack({ slash: 100 }), {
  mods: [equipFake('Serration', ['+165% Damage'])],
  arcane: { arcane: merciless, rank: 5, conditionalStacks: 12 },
})
expectClose('Merciless 12 stacks + Serration', withMerciless.hit.average, 100 * (1 + 1.65 + 3.6))

// Deadhead: +30% headshot multiplier passive, x3 headshot -> 3 x 1.3 = 3.9x, plus 3 stacks of +120% damage
const deadhead = arcanes.find((arcane) => arcane.name === 'Primary Deadhead')!
const withDeadhead = run(testAttack({ slash: 100 }), {
  arcane: { arcane: deadhead, rank: 5, conditionalStacks: 3 },
  target: { faction: 'None', layer: 'health', enemyId: null, baseLevel: 1, level: 1, steelPath: false, manualArmor: 0, headshot: true, headshotMultiplier: 3, headcrit: false },
})
expectClose('Deadhead headshot', withDeadhead.hit.average, 100 * (1 + 3.6) * 3 * 1.3)

// Secondary Shiver: +45% damage per Cold stack, additive with damage mods -> 10 stacks = +450%
const shiver = arcanes.find((arcane) => arcane.name === 'Secondary Shiver')!
const withShiver = run(testAttack({ slash: 100 }), {
  arcane: { arcane: shiver, rank: 5, conditionalStacks: 0 },
  debuffs: { ...noDebuffs(), stacks: { ...noDebuffs().stacks, cold: 10 } },
})
expectClose('Shiver x10 cold', withShiver.hit.average, 100 * (1 + 4.5))

// Primary Blight at 40 stacks: +144% crit damage, +72% multishot
const blight = arcanes.find((arcane) => arcane.name === 'Primary Blight')!
const withBlight = run(testAttack({ slash: 100 }, { critMultiplier: 2 }), { arcane: { arcane: blight, rank: 5, conditionalStacks: 40 } })
expectClose('Blight crit multiplier', withBlight.critMultiplier, 2 * (1 + 1.44))
expectClose('Blight multishot', withBlight.multishot, 1.72)

// level scaling + Steel Path, checked against the wiki curves by hand:
// Grineer health at 50 levels over base: 1 + 0.015 x 50^2.12 (below 70, no blend)
expectClose('Grineer health scaling', scaleHealth(300, 50, 'Grineer', false), 300 * (1 + 0.015 * 50 ** 2.12))
expectClose('Steel Path x2.5 health', scaleHealth(300, 50, 'Grineer', true), 2.5 * 300 * (1 + 0.015 * 50 ** 2.12))
// past 80 levels it's fully on the high curve: 1 + 10.7332 x q^0.72
expectClose('Grineer health high curve', scaleHealth(300, 200, 'Grineer', false), 300 * (1 + 10.7332 * 200 ** 0.72))
expectClose('armor cap', scaleArmor(500, 1000), 2700)

// kill estimate: 1000 shields, 1000 health, 100 non-toxin per shot -> 10 to strip + 10 more
const plain = run(testAttack({ slash: 100 }))
const plainShield = run(testAttack({ slash: 100 }), { target: { ...grineerTarget, faction: 'None', layer: 'shield' } })
expectClose('shots to kill', estimateKill(1000, 1000, plain, plainShield).shotsToKill, 20)

// Condition Overload (Mechanic): base 100, Serration +165%, Galvanized Aptitude 2 stacks (+40% x 1 status type x 2)
// additive: 100 x (2.65 + 0.8) = 345, multiplicative: 100 x 2.65 x 1.8 = 477
const galvanized = equipFake('Galvanized Aptitude', ['On Kill:\\n+40% Direct Damage per Status Type affecting the target for 20s. Stacks up to 2x.'])
galvanized.conditionalStacks = 2
const oneStatus = { ...noDebuffs(), stacks: { ...noDebuffs().stacks, slash: 1 } }
const coInput = { mods: [equipFake('Serration', ['+165% Damage']), galvanized], debuffs: oneStatus }
expectClose('CO additive', run(slashAttack, { ...coInput, coBehavior: { mode: 'add', scale: 1, source: 'override' } }).hit.average, 345)
expectClose('CO multiplicative', run(slashAttack, { ...coInput, coBehavior: { mode: 'multiply', scale: 1, source: 'override' } }).hit.average, 477)
expectClose('CO none', run(slashAttack, { ...coInput, coBehavior: { mode: 'none', scale: 1, source: 'override' } }).hit.average, 265)
expectClose('CO scaled 25% (Ballistica)', run(slashAttack, { ...coInput, coBehavior: { mode: 'add', scale: 0.25, source: 'override' } }).hit.average, 100 * (2.65 + 0.2))
// lifted counts as another status type -> 2 types x 0.4 x 2 stacks = +160%
expectClose('CO lifted counts', run(slashAttack, { ...coInput, debuffs: { ...oneStatus, liftedOrKnockedDown: true } }).hit.average, 100 * (2.65 + 1.6))
// the table: Torid grenade multiplies, Braton Prime normal attack adds, Akarius Prime detonation gets none
const coFor = (weaponName: string, attackName: string) => {
  const weapon = weapons.find((option) => option.name === weaponName)!
  return resolveCoBehavior(weapon, weapon.attacks.find((option) => option.name === attackName)!).mode
}
expectClose('Torid grenade multiplies', coFor('Torid', 'Grenade Impact') === 'multiply' ? 1 : 0, 1)
expectClose('Braton Prime adds', coFor('Braton Prime', 'Normal Attack') === 'add' ? 1 : 0, 1)
expectClose('Akarius detonation none', coFor('Akarius Prime', 'Rocket Detonation') === 'none' ? 1 : 0, 1)

// Weak_Point: Primary Acuity (+350% weak point damage) on a 3x head = 3 + 1.5 x 3.5 = 8.25x, x1.3 with Deadhead
const headTarget = { ...grineerTarget, faction: 'None', headshot: true }
const acuity = run(testAttack({ slash: 100 }), {
  mods: [equipFake('Primary Acuity', ['+350% Weak Point Damage'])],
  arcane: { arcane: deadhead, rank: 5, conditionalStacks: 0 },
  target: headTarget,
})
expectClose('Acuity + Deadhead headshot factor', acuity.headshot.factor, 8.25 * 1.3)
expectClose('Acuity + Deadhead hit', acuity.hit.average, 100 * 8.25 * 1.3)

// headcrit: 100% crit, 2x base -> 4x crit multiplier on a headcrit head, x3 head -> 100 x 4 x 3
const headcritHit = run(testAttack({ slash: 100 }, { critChance: 1, critMultiplier: 2 }), { target: { ...headTarget, headcrit: true } })
expectClose('headcrit crit mult', headcritHit.critMultiplier, 4)
expectClose('headcrit hit', headcritHit.hit.average, 1200)
// no headcrit (Corpus heads): plain 2x crit, x3 head
const noHeadcrit = run(testAttack({ slash: 100 }, { critChance: 1, critMultiplier: 2 }), { target: headTarget })
expectClose('no headcrit hit', noHeadcrit.hit.average, 600)
// headcrit doubles base, Cold's flat bonus stays flat: 2 x 2 x (1 + 1.2 Vital Sense) + 0.5 (9 cold)
const headcritCold = run(testAttack({ slash: 100 }, { critChance: 1, critMultiplier: 2 }), {
  mods: [equipFake('Vital Sense', ['+120% Critical Damage'])],
  debuffs: { ...noDebuffs(), stacks: { ...noDebuffs().stacks, cold: 9 } },
  target: { ...headTarget, headcrit: true },
})
expectClose('headcrit + cold', headcritCold.critMultiplier, 2 * 2 * 2.2 + 0.5)

// in-game check (Steel Path Corrupted Heavy Gunner, base level 8, level 185, Dex Sybaris + Serration):
// the game showed 22 body, 67 head, 45 crit body, 268 crit head
const sybaris = weapons.find((weapon) => weapon.name === 'Dex Sybaris')!
const sybarisHit = (headshot: boolean) =>
  calculate({
    weapon: sybaris, attack: sybaris.attacks[0], mods: [maxed('Serration')], armor: scaleArmor(500, 185 + 100 - 8),
    debuffs: noDebuffs(), buffs: { roar: 0 },
    // headshot multiplier/headcrit left unset on purpose, they should come from the faction
    target: { faction: 'Orokin', layer: 'health', enemyId: null, baseLevel: 8, level: 185, steelPath: true, manualArmor: 0, headshot },
  }).hit
expectClose('in-game body 22', Math.round(sybarisHit(false).normal), 22)
expectClose('in-game crit body 45', Math.round(sybarisHit(false).crit), 45)
expectClose('in-game head 67', Math.round(sybarisHit(true).normal), 67)
expectClose('in-game crit head 268', Math.round(sybarisHit(true).crit), 268)

// ---- Incarnon perks ----
const perkFor = (weaponName: string, tier: string, perkName: string) =>
  getIncarnonTiers(weaponName)!.find((candidate) => candidate.tier === tier)!.perks.find((perk) => perk.name === perkName)!
const bratonPrime = weapons.find((weapon) => weapon.name === 'Braton Prime')!
const bratonCalc = (incarnonPerks: { perk: ReturnType<typeof perkFor>; stacks: number }[]) =>
  calculate({ weapon: bratonPrime, attack: bratonPrime.attacks[0], mods: [], incarnonPerks, armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 },
    target: { ...grineerTarget, faction: 'None' } })
// Critical Parallel (Braton Prime): +18% base crit, +0.2 base crit mult -> 12% + 18% = 30%, 2.0 + 0.2 = 2.2
const parallel = bratonCalc([{ perk: perkFor('Braton Prime', 'IV', 'Critical Parallel'), stacks: 0 }])
expectClose('Critical Parallel crit chance', parallel.critChance, 0.3)
expectClose('Critical Parallel crit mult', parallel.critMultiplier, 2.2)
// Daring Reverie (Braton Prime): +4 base damage -> modded base 35 -> 39, +38 more while channeling -> 77
expectClose('Daring Reverie base', bratonCalc([{ perk: perkFor('Braton Prime', 'II', 'Daring Reverie'), stacks: 0 }]).moddedBaseDamage, 39)
expectClose('Daring Reverie channeled', bratonCalc([{ perk: perkFor('Braton Prime', 'II', 'Daring Reverie'), stacks: 1 }]).moddedBaseDamage, 77)
// mode tags: Strun's Elemental Balance is +11% base status on normal fire, +132% on the Incarnon form
const strun = weapons.find((weapon) => weapon.name === 'Strun')!
const strunStatus = (attackName: string) => {
  const strunAttack = strun.attacks.find((option) => option.name === attackName)!
  return calculate({ weapon: strun, attack: strunAttack, mods: [], incarnonPerks: [{ perk: perkFor('Strun', 'IV', 'Elemental Balance'), stacks: 0 }],
    armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 }, target: { ...grineerTarget, faction: 'None' } }).statusChance - strunAttack.statusChance
}
expectClose('Strun normal +11%', strunStatus(strun.attacks[0].name), 0.11)
expectClose('Strun Incarnon +132%', strunStatus(strun.attacks.find((option) => /Incarnon/.test(option.name))!.name), 1.32)
// native Incarnon flat bonuses: Laetum Elemental Excess +20% status / -10% crit after mods
const laetum = weapons.find((weapon) => weapon.name === 'Laetum')!
const laetumExcess = calculate({ weapon: laetum, attack: laetum.attacks[0], mods: [maxed('Point Strike')],
  incarnonPerks: [{ perk: perkFor('Laetum', 'IV', 'Elemental Excess'), stacks: 0 }],
  armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 }, target: { ...grineerTarget, faction: 'None' } })
expectClose('Laetum flat crit after mods', laetumExcess.critChance, laetum.attacks[0].critChance * 2.5 - 0.1)
// Devouring Attrition: at 0% crit, average hit = 1 + 0.5 x 20 = 11x
const attrition = run(testAttack({ slash: 100 }), {})
const attritionHit = calculate({ weapon: testWeapon(testAttack({ slash: 100 })), attack: testAttack({ slash: 100 }), mods: [],
  incarnonPerks: [{ perk: perkFor('Laetum', 'V', 'Devouring Attrition'), stacks: 0 }], armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 },
  target: { ...grineerTarget, faction: 'None' } })
expectClose('Devouring Attrition average', attritionHit.hit.average, attrition.hit.average * 11)
// Latron Flensing Spikes: 5 puncture stacks x 20% = all armor gone
const latron = weapons.find((weapon) => weapon.name === 'Latron')!
const flensing = calculate({ weapon: latron, attack: latron.attacks[0], mods: [], incarnonPerks: [{ perk: perkFor('Latron', 'IV', 'Flensing Spikes'), stacks: 0 }],
  armor: 1000, debuffs: { ...noDebuffs(), stacks: { ...noDebuffs().stacks, puncture: 3 } }, buffs: { roar: 0 }, target: { ...grineerTarget, faction: 'None' } })
expectClose('Flensing Spikes 3 stacks', flensing.armor.after, 400)
// every perk line in the data parses into at least a statement, and every family's variants exist in the weapon data
const familyProblems = INCARNON_FAMILIES.flatMap((family) => family.variants.filter((variant) => !weapons.some((weapon) => weapon.name === variant)))
expectClose(`incarnon variants missing from weapon data: ${familyProblems.join(', ') || 'none'}`, familyProblems.length, 0)

// Acuity: +90% multishot from Split Chamber is ignored, weak point bonuses only on headshots
const acuityMod = mods.find((mod) => mod.name === 'Primary Acuity')!
const acuityBuild = { mods: [{ mod: acuityMod, rank: acuityMod.fusionLimit, conditionalStacks: 0 }, maxed('Split Chamber')] }
const acuityBody = run(testAttack({ slash: 100 }, { critChance: 0.2, critMultiplier: 2 }), acuityBuild)
const acuityHead = run(testAttack({ slash: 100 }, { critChance: 0.2, critMultiplier: 2 }), { ...acuityBuild, target: headTarget })
expectClose('Acuity locks multishot', acuityBody.multishot, 1)
expectClose('Acuity body crit unchanged', acuityBody.critChance, 0.2)
expectClose('Acuity head crit 20% x 4.5', acuityHead.critChance, 0.2 * 4.5)
expectClose('Acuity head factor 3 + 1.5 x 3.5', acuityHead.headshot.factor, 8.25)
const noAcuity = run(testAttack({ slash: 100 }), { mods: [maxed('Split Chamber')] })
expectClose('Split Chamber alone still works', noAcuity.multishot, 1.9)

// charged shots: Cernos Prime charged (0.5s charge, 1 fire rate) -> 1 / (0.5 + 1) = 0.667 shots/s
const cernos = weapons.find((weapon) => weapon.name === 'Cernos Prime')!
const cernosCharged = cernos.attacks.find((attack) => attack.chargeTime)!
const cernosRate = calculate({ weapon: cernos, attack: cernosCharged, mods: [], armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 }, target: { ...grineerTarget, faction: 'None' } }).fireRate
expectClose('charged fire rate', cernosRate, 1 / (cernosCharged.chargeTime! + 1 / cernosCharged.fireRate))
// Incarnon forms fire one projectile: Strun Prime's 12 pellets don't carry over
const strunPrime = weapons.find((weapon) => weapon.name === 'Strun Prime')!
const strunIncarnon = strunPrime.attacks.find((attack) => attack.name === 'Incarnon Form')!
expectClose('Strun Incarnon multishot 1', calculate({ weapon: strunPrime, attack: strunIncarnon, mods: [], armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 }, target: { ...grineerTarget, faction: 'None' } }).multishot, 1)

// ---- magazine / reload / status types / Cannonade ----
// Exergis: 1-round magazine, 1.6s reload, 3.33 fire rate -> uptime 1 / (3.33 x 1.6 + 1)
const exergis = weapons.find((weapon) => weapon.name === 'Exergis')!
const exergisRun = (extraMods: ReturnType<typeof maxed>[] = []) => calculate({ weapon: exergis, attack: exergis.attacks[0], mods: extraMods, armor: 0,
  debuffs: { ...noDebuffs(), statusTypeSource: 'build' }, buffs: { roar: 0 }, target: { ...grineerTarget, faction: 'None' } })
const exergisPlain = exergisRun()
expectClose('Exergis magazine 1', exergisPlain.magazineSize ?? 0, 1)
expectClose('Exergis uptime', exergisPlain.uptime, 1 / (exergis.attacks[0].fireRate * exergis.reloadTime! + 1))
expectClose('Exergis steady state = burst x uptime', exergisPlain.steadyStateDps, exergisPlain.totalDps * exergisPlain.uptime)
// 10s window with a 1-round mag: shots at 0, then every (1/fr + reload)
const exergisShots = Math.ceil(10 / (1 / exergis.attacks[0].fireRate + exergis.reloadTime!))
expectClose('Exergis 10s direct part', exergisRun().damageInWindow(10) >= exergisShots * exergisPlain.averageShot ? 1 : 0, 1)
// status types from the build: Exergis base impact/slash/puncture/radiation = 4 types
expectClose('Exergis own status types', exergisPlain.activeStatusTypes, 4)
// Semi-Rifle Cannonade locks fire rate: Speed Trigger does nothing with it equipped
const cannonade = mods.find((mod) => mod.name === 'Semi-Rifle Cannonade')!
const torid = weapons.find((weapon) => weapon.name === 'Torid')!
const toridRate = (withCannonade: boolean) => calculate({ weapon: torid, attack: torid.attacks[0],
  mods: [maxed('Speed Trigger'), ...(withCannonade ? [{ mod: cannonade, rank: cannonade.fusionLimit, conditionalStacks: 0 }] : [])],
  armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 }, target: { ...grineerTarget, faction: 'None' } }).fireRate
expectClose('Cannonade locks fire rate', toridRate(true), torid.attacks[0].fireRate)
expectClose('Speed Trigger alone works', toridRate(false) > torid.attacks[0].fireRate ? 1 : 0, 1)
expectClose('Cannonade semi-only flag', cannonade.semiOnly && cannonade.locksFireRate ? 1 : 0, 1)
expectClose('Sirocco removed (Drifter amp)', weapons.some((weapon) => weapon.name === 'Sirocco') ? 1 : 0, 0)

// ---- melee combo / Blood Rush / Weeping Wounds / heavy attacks ----
const meleeMod = (name: string) => {
  const mod = mods.find((candidate) => candidate.name === name && candidate.type === 'Melee Mod')!
  return { mod, rank: mod.fusionLimit, conditionalStacks: 0 }
}
const meleeWeapon = (attack: Attack): Weapon => ({ ...testWeapon(attack), name: 'Test Sword', type: 'Melee', category: 'Melee' })
const runMelee = (attack: Attack, overrides: Partial<CalcInput> = {}) => run(attack, { weapon: meleeWeapon(attack), ...overrides })
const swing = testAttack({ slash: 100 }, { critChance: 0.2, statusChance: 0.2 })
// Blood_Rush: 20% x (1 + 1.2 True Steel + 0.4 x (4 - 1)) = 68%
expectClose('Blood Rush wiki example (4x combo)', runMelee(swing, { mods: [meleeMod('True Steel'), meleeMod('Blood Rush')], buffs: { roar: 0, combo: 4 } }).critChance, 0.68)
// Weeping_Wounds: 20% x (1 + 0.6 Voltaic Strike + 0.4 x (4 - 1)) = 56%
expectClose('Weeping Wounds wiki example (4x combo)', runMelee(swing, { mods: [meleeMod('Voltaic Strike'), meleeMod('Weeping Wounds')], buffs: { roar: 0, combo: 4 } }).statusChance, 0.56)
expectClose('Blood Rush does nothing at 1x', runMelee(swing, { mods: [meleeMod('Blood Rush')], buffs: { roar: 0, combo: 1 } }).critChance, 0.2)
// Gladiator set: Might on the weapon + 2 on the Warframe = 3 pieces = +30% per combo step, 20% x (1 + 0.3 x 11)
expectClose('Gladiator set at 12x', runMelee(swing, { mods: [meleeMod('Gladiator Might')], buffs: { roar: 0, combo: 12, gladiatorWarframePieces: 2 } }).critChance, 0.2 * (1 + 0.3 * 11))
expectClose('combo cap 12x', runMelee(swing, { buffs: { roar: 0, combo: 20 } }).melee!.combo, 12)
// normal swings don't get the combo damage multiplier
expectClose('normal swing ignores combo', runMelee(swing, { buffs: { roar: 0, combo: 12 } }).hit.normal, runMelee(swing).hit.normal)
// Heavy_Attack: Paracesis 222 base, +120% damage, +90% elemental, 6x heavy, 7x combo = ~38,974 (the wiki skips quantization)
const paracesis = weapons.find((weapon) => weapon.name === 'Paracesis')!
const paracesisHeavy = paracesis.attacks.find((attack) => attack.name === 'Heavy Attack')!
expectClose('Paracesis heavy base = 6x', Object.values(paracesisHeavy.damage).reduce((a, b) => a + b, 0), 1332)
const paracesisHit = calculate({ weapon: paracesis, attack: paracesisHeavy, mods: [meleeMod('Pressure Point'), meleeMod('Molten Impact')],
  armor: 0, debuffs: noDebuffs(), buffs: { roar: 0, combo: 7 }, target: { ...grineerTarget, faction: 'None', headshot: false } }).hit.normal
expectClose('Paracesis heavy wiki example (within quantization)', Math.abs(paracesisHit / 38974 - 1) < 0.005 ? 1 : 0, 1)
// True Steel: heavies get 2x the crit bonus *instead of* the normal one (Galvanized Steel hotfix)
const heavySwing = testAttack({ slash: 500 }, { critChance: 0.2, heavy: true, windUp: 0.5 })
expectClose('True Steel x2 on heavies', runMelee(heavySwing, { mods: [meleeMod('True Steel')] }).critChance, 0.2 * (1 + 2.4))
expectClose('True Steel x1 on swings', runMelee(swing, { mods: [meleeMod('True Steel')] }).critChance, 0.2 * (1 + 1.2))
// Killing Blow: +120% damage only on heavies, wind-up 0.5 / 1.6
const killingBlowHeavy = runMelee(heavySwing, { mods: [meleeMod('Killing Blow')] })
expectClose('Killing Blow heavy damage', killingBlowHeavy.hit.normal, 500 * 2.2)
expectClose('Killing Blow skips swings', runMelee(swing, { mods: [meleeMod('Killing Blow')] }).hit.normal, 100)
expectClose('heavy wind-up speed', killingBlowHeavy.melee!.windUp!, 0.5 / 1.6)
expectClose('heavy rate = wind-up + one swing', killingBlowHeavy.fireRate, 1 / (0.5 / 1.6 + 1))
// Melee_Combo: 40% efficiency at 9x (160 hits) keeps 64 hits = 4x
expectClose('Heavy Attack Efficiency 9x -> 4x', runMelee(heavySwing, { mods: [meleeMod('Focus Energy')], buffs: { roar: 0, combo: 9 } }).melee!.comboAfterHeavy!, 4)
// heavy slash procs scale with the combo too (bleed is 35% of the initial blow)
const heavyBleed = (combo: number) => runMelee({ ...heavySwing, statusChance: 1 }, { buffs: { roar: 0, combo } }).dots.find((dot) => dot.damageType === 'slash')!.tick.normal
expectClose('heavy bleed x combo', heavyBleed(6) / heavyBleed(1), 6)
const animosity = arcanes.find((arcane) => arcane.name === 'Melee Animosity')!
expectClose('Melee Animosity at 420% on heavies', runMelee(heavySwing, { arcane: { arcane: animosity, rank: animosity.levelStats.length - 1, conditionalStacks: 10 } }).critChance, 0.2 * (1 + 4.2))

// ---- weapon passives (src/data/passives.ts) ----
const named = (name: string) => weapons.find((weapon) => weapon.name === name)!
const passivesOn = (weaponName: string, stacks = 1) => passivesFor(weaponName).map((passive) => ({ passive, stacks }))
const neutral = { ...grineerTarget, faction: 'None' }
const runWeapon = (name: string, overrides: Partial<CalcInput> = {}, attackIndex = 0) => {
  const weapon = named(name)
  return calculate({ weapon, attack: weapon.attacks[attackIndex], mods: [], armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 }, target: neutral, ...overrides })
}
// Buzlok: "Point Strike with the buff active gives 107.5%" (23% x 2.5 + 50%)
expectClose('Buzlok wiki example', runWeapon('Buzlok', { mods: [maxed('Point Strike')], passives: passivesOn('Buzlok') }).critChance, 1.075)
expectClose('Buzlok without the mark', runWeapon('Buzlok', { mods: [maxed('Point Strike')], passives: passivesOn('Buzlok', 0) }).critChance, 0.575)
// Galariak Prime: +10% flat per status type, its own impact/slash/puncture = 3 types
expectClose('Galariak Prime crit per status type',
  runWeapon('Galariak Prime', { passives: passivesOn('Galariak Prime'), debuffs: { ...noDebuffs(), statusTypeSource: 'build' } }).critChance, 0.19 + 0.3)
// Cedo: +60% per status type, added in with damage mods. 3 types on the target -> x2.8
const cedoStacks = { ...noDebuffs(), stacks: { ...noDebuffs().stacks, heat: 1, cold: 1, toxin: 1 } }
expectClose('Cedo +60% per status type',
  runWeapon('Cedo', { passives: passivesOn('Cedo'), debuffs: cedoStacks }).moddedBaseDamage / runWeapon('Cedo', { debuffs: cedoStacks }).moddedBaseDamage, 2.8)
expectClose('Cedo skips the glaive explosion', runWeapon('Cedo', { passives: passivesOn('Cedo'), debuffs: cedoStacks }, 2).passives.length, 0)
// Gotva Prime: 15% of hits after a proc roll at 300% crit. at 100%+ status every hit procs
const gotva = runWeapon('Gotva Prime', { mods: [{ mod: findMod('Rifle Aptitude'), rank: findMod('Rifle Aptitude').fusionLimit, conditionalStacks: 0 }, maxed('Hammer Shot')], passives: passivesOn('Gotva Prime') })
const gotvaPlain = runWeapon('Gotva Prime', { mods: [{ mod: findMod('Rifle Aptitude'), rank: findMod('Rifle Aptitude').fusionLimit, conditionalStacks: 0 }, maxed('Hammer Shot')] })
const gotvaShare = Math.min(1, gotvaPlain.statusChance) * 0.15
expectClose('Gotva Prime super crit expected value', gotva.hit.average / gotvaPlain.hit.normal,
  (1 - gotvaShare) * (1 + gotvaPlain.critChance * (gotvaPlain.critMultiplier - 1)) + gotvaShare * (1 + 3 * (gotvaPlain.critMultiplier - 1)))
// Sagek Prime: 6% of shots after a crit get 500% status
const sagek = runWeapon('Sagek Prime', { passives: passivesOn('Sagek Prime') })
expectClose('Sagek Prime status expected value', sagek.statusChance, (1 - 0.3 * 0.06) * 0.01 + 0.3 * 0.06 * 5)
// Slaytra: +100% Slash duration = 12 Bleed ticks
const slaytra = runWeapon('Slaytra', { passives: passivesOn('Slaytra') }).dots.find((dot) => dot.damageType === 'slash')!
expectClose('Slaytra 12 bleed ticks', slaytra.ticks, 12)
expectClose('Slaytra per proc = 12 ticks', slaytra.perProc.average, slaytra.tick.average * 12)
// status duration mods: +90% -> floor(6 x 1.9) = 11 ticks
const torment = mods.find((mod) => mod.name === 'Lingering Torment')!
const strunForDuration = named('Strun')
expectClose('+90% status duration = 11 ticks', calculate({ weapon: strunForDuration, attack: testAttack({ slash: 100 }, { statusChance: 1 }), mods: [{ mod: torment, rank: torment.fusionLimit, conditionalStacks: 0 }],
  armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 }, target: neutral }).dots.find((dot) => dot.damageType === 'slash')!.ticks, 11)
// Harmony: stacks already on the target detonate at Normal Attack strength (heavy procs / 6x heavy multiplier at 1x combo)
const harmony = named('Harmony')
const harmonyStacks = { ...noDebuffs(), stacks: { ...noDebuffs().stacks, slash: 2 } }
const harmonyHeavy = calculate({ weapon: harmony, attack: harmony.attacks.find((attack) => attack.name === 'Heavy Attack')!, mods: [], passives: passivesOn('Harmony', 0),
  armor: 0, debuffs: harmonyStacks, buffs: { roar: 0, combo: 1 }, target: neutral })
const harmonySwingBleed = calculate({ weapon: harmony, attack: harmony.attacks[0], mods: [], armor: 0, debuffs: harmonyStacks, buffs: { roar: 0 }, target: neutral })
  .dots.find((dot) => dot.damageType === 'slash')!.perProc.average
expectClose('Harmony detonates 2 bleed stacks', harmonyHeavy.detonation!.existingStacks, 2 * harmonySwingBleed)
expectClose('Harmony detonation only on heavies', runWeapon('Harmony', { passives: passivesOn('Harmony') }).detonation === null ? 1 : 0, 1)
// Lesion: +15% attack speed multiplies with Fury
const fury = meleeMod('Fury')
expectClose('Lesion Frenzy multiplies attack speed', runWeapon('Lesion', { mods: [fury], passives: passivesOn('Lesion') }).fireRate, named('Lesion').attacks[0].fireRate * 1.3 * 1.15)
// Kuva/Tenet/Coda bonus element: 60% Toxin on Kuva Hek = 0.6 x base damage of Toxin
const kuvaHekBase = Object.values(named('Kuva Hek').attacks[0].damage).reduce((a, b) => a + b, 0)
expectClose('Kuva bonus element', runWeapon('Kuva Hek', { bonusElement: { damageType: 'toxin', value: 0.6 } }).damageTypes.find((row) => row.damageType === 'toxin')!.modded,
  (Math.floor((0.6 / 1.6) * 32 + 0.5) / 32) * kuvaHekBase * 1.6)
expectClose('bonus element ignored on non-Kuva', runWeapon('Braton Prime', { bonusElement: { damageType: 'toxin', value: 0.6 } }).damageTypes.some((row) => row.damageType === 'toxin') ? 1 : 0, 0)
// Tonkkatt: heat that doesn't combine. with a Cold mod there should still be Heat (and Cold), no Blast
const tonkkatt = runWeapon('Tonkkatt', { mods: [meleeMod('North Wind')], passives: passivesOn('Tonkkatt', 30) })
expectClose('Tonkkatt heat stays heat', tonkkatt.damageTypes.some((row) => row.damageType === 'heat') && !tonkkatt.damageTypes.some((row) => row.damageType === 'blast') ? 1 : 0, 1)
expectClose('Tekko +6% base status with Atlas', runWeapon('Tekko', { passives: passivesOn('Tekko') }).statusChance, named('Tekko').attacks[0].statusChance + 0.06)
expectClose('Tekko without Atlas', runWeapon('Tekko', { passives: passivesOn('Tekko', 0) }).statusChance, named('Tekko').attacks[0].statusChance)
expectClose('Pyrana Prime x2 magazine', runWeapon('Pyrana Prime', { passives: passivesOn('Pyrana Prime') }).magazineSize!, named('Pyrana Prime').magazineSize! * 2)
// ---- mod restrictions (wiki "Incompatible Mods" infoboxes + the export's mod paths) ----
const anyMod = (name: string) => mods.find((mod) => mod.name === name)!
const expectConflict = (a: string, b: string, expected: boolean) =>
  expectClose(`${a} + ${b} ${expected ? 'blocked' : 'allowed'}`, modsConflict(anyMod(a), anyMod(b)) ? 1 : 0, expected ? 1 : 0)
expectConflict("Hell's Chamber", 'Galvanized Hell', true)
expectConflict('Galvanized Shot', 'Sure Shot', true)
expectConflict('Spectral Serration', 'Serration', true)
expectConflict('Amalgam Serration', 'Spectral Serration', true)
expectConflict('Split Chamber', 'Galvanized Chamber', true)
expectConflict('Galvanized Steel', 'Sacrificial Steel', true)
expectConflict('Critical Delay', 'Point Strike', true)
expectConflict('Primed Cryo Rounds', 'Cryo Rounds', true)
expectConflict('Primed Bane Of Grineer', 'Bane Of Grineer', true)
expectConflict('Berserker Fury', 'Fury', true)
expectConflict('Primed Chamber', 'Charged Chamber', false) // wiki Mod page: these two do stack
expectConflict('Galvanized Chamber', 'Vigilante Armaments', false)
expectConflict('Point Strike', 'Vital Sense', false)
expectConflict('Heavy Caliber', 'Serration', false)
expectConflict('Blood Rush', 'Sacrificial Steel', false)
// ---- reloads + status over time ----
// shell by shell: Strun Prime 0.6s + 0.4s per shell. +30% magazine (13 shells) -> 5.8s instead of 4.6s
expectClose('Strun Prime base reload', runWeapon('Strun Prime').reloadTime!, 4.6)
const magazineMod = mods.find((mod) => mod.name === 'Ammo Stock')!
const strunMag = runWeapon('Strun Prime', { mods: [{ mod: magazineMod, rank: magazineMod.fusionLimit, conditionalStacks: 0 }] })
expectClose('Strun Prime reload grows with magazine', strunMag.reloadTime!, 0.6 + 0.4 * strunMag.magazineSize!)
expectClose('Felarx reload = 1.3 + 0.4 x 6', runWeapon('Felarx').reloadTime!, 3.7)
// one shot (1-round mag, long reload) with a guaranteed Slash proc: in a 3s window only ticks at 1s and 2s count,
// so +90% status duration adds nothing there
const oneShotAttack = testAttack({ slash: 100 }, { statusChance: 1 })
const oneShotWeapon = { ...testWeapon(oneShotAttack), magazineSize: 1, reloadTime: 100 }
const oneShot = (extraMods: EquippedModList) => calculate({ weapon: oneShotWeapon, attack: oneShotAttack, mods: extraMods, armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 }, target: neutral })

const plainShot = oneShot([])
expectClose('3s window: 2 bleed ticks', plainShot.damageInWindow(3) - plainShot.averageShot, 2 * plainShot.dots[0].tick.average)
const tormentShot = calculate({ weapon: { ...oneShotWeapon, type: 'Shotgun' }, attack: oneShotAttack, mods: [{ mod: torment, rank: torment.fusionLimit, conditionalStacks: 0 }],
  armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 }, target: neutral })
expectClose('status duration tail cut by the window', tormentShot.damageInWindow(3), plainShot.damageInWindow(3))
expectClose('status duration still counts in a long window', tormentShot.damageInWindow(30) - tormentShot.averageShot, 11 * plainShot.dots[0].tick.average)
// Heat refresh: a proc every second, window 10s -> stack i ticks from i+1 until the window ends = 9 + 8 + ... + 0 = 45 ticks
const heatAttack = testAttack({ heat: 100 }, { statusChance: 1, fireRate: 1 })
const heatRun = run(heatAttack)
expectClose('Heat stacks refresh (45 ticks in 10s)', heatRun.damageInWindow(10) - 10 * heatRun.averageShot, 45 * heatRun.dots[0].tick.average)
// Monte Carlo agrees with the expected value (no Heat), and the range brackets it
const bratonStatus = calculate({ weapon: named('Braton Prime'), attack: named('Braton Prime').attacks[0], mods: ['Serration', 'Rifle Aptitude', 'Hellfire', 'Infected Clip'].map(maxed),
  armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 }, target: neutral })
const [bratonRange] = bratonStatus.simulateWindows([10], 2000)
const bratonExpected = bratonStatus.damageInWindow(10)
console.log('Braton 10s expected', bratonExpected.toFixed(0), 'MC', bratonRange)
expectClose('MC mean within 3% of expected', Math.abs(bratonRange.expected / bratonExpected - 1) < 0.03 ? 1 : 0, 1)
expectClose('MC range brackets the mean', bratonRange.low <= bratonRange.expected && bratonRange.expected <= bratonRange.high ? 1 : 0, 1)
// ---- arcane activation (src/calc/parseMod.ts triggerUptime) ----
const arcaneNamed = (name: string) => arcanes.find((arcane) => arcane.name === name)!
const bulwark = arcaneNamed('Primary Bulwark')
const bulwarkParsed = parseUpgrade(bulwark.levelStats, bulwark.levelStats.length - 1).conditionals[0]
expectClose('Primary Bulwark parsed as armor stacks', bulwarkParsed.maxStacks * (bulwarkParsed.effect as { value: number }).value, 5)
const gunContext = { isMelee: false, bodyShots: true }
const stacksOf = (name: string) => defaultConditionalStacks(arcaneNamed(name).levelStats, arcaneNamed(name).levelStats.length - 1, gunContext)
expectClose('Dexterity on a gun: half stacks', stacksOf('Primary Dexterity'), 3)
expectClose('Merciless: full stacks', stacksOf('Primary Merciless'), 12)
expectClose('Deadhead (headshot kill) stays on', stacksOf('Primary Deadhead'), 3)
expectClose('Crux (headshot hit) off on body shots', stacksOf('Primary Crux'), 0)
expectClose('Bulwark: half (+250%)', stacksOf('Primary Bulwark'), 250)
// the optimizer shouldn't pick Dexterity over Merciless / Deadhead any more
const bratonSingle = optimizeAttack(named('Braton Prime'), named('Braton Prime').attacks[0], objectiveById('single'))
const bratonSustained = optimizeAttack(named('Braton Prime'), named('Braton Prime').attacks[0], objectiveById('sustained'))
console.log('Braton arcanes: single', bratonSingle.arcane?.arcane.name, '/ sustained', bratonSustained.arcane?.arcane.name)
expectClose('single hit picks Deadhead', bratonSingle.arcane?.arcane.name === 'Primary Deadhead' ? 1 : 0, 1)
expectClose('sustained skips Dexterity', bratonSustained.arcane?.arcane.name !== 'Primary Dexterity' ? 1 : 0, 1)
// Melee Exposure: +240% Corrosive damage that takes no share of the procs (and doesn't combine)
const exposure = arcanes.find((arcane) => arcane.name === 'Melee Exposure')!
const exposureSwing = testAttack({ slash: 80, impact: 20 }, { statusChance: 0.5 })
const withExposure = runMelee(exposureSwing, { mods: [meleeMod('Fever Strike')], arcane: { arcane: exposure, rank: exposure.levelStats.length - 1, conditionalStacks: 4 } })
const withoutExposure = runMelee(exposureSwing, { mods: [meleeMod('Fever Strike')] })
const rowOf = (result: typeof withExposure, damageType: string) => result.damageTypes.find((row) => row.damageType === damageType)
expectClose('Melee Exposure adds Corrosive damage', (rowOf(withExposure, 'corrosive')?.modded ?? 0) > 0 ? 1 : 0, 1)
expectClose('Melee Exposure Corrosive gets no procs', rowOf(withExposure, 'corrosive')!.procShare, 0)
expectClose('Melee Exposure leaves Toxin uncombined', rowOf(withExposure, 'toxin')?.modded ?? 0, rowOf(withoutExposure, 'toxin')!.modded)
expectClose('Melee Exposure keeps the slash proc share', rowOf(withExposure, 'slash')!.procShare, rowOf(withoutExposure, 'slash')!.procShare)
// Reconifex perfect reload: a guaranteed Heat proc on every hit
const reconifex = runWeapon('Reconifex', { passives: passivesOn('Reconifex') })
expectClose('Reconifex guaranteed Heat proc', reconifex.dots.find((dot) => dot.damageType === 'heat')!.procsPerSecond >= reconifex.fireRate * reconifex.multishot - 1e-9 ? 1 : 0, 1)
// multi-hit heavies (src/data/heavyAttacks.ts): Heavy Scythe = 3 x 200% + 2 x 600% (the export's 18x is every hit added up)
const heavyOf = (name: string) => named(name).attacks.find((attack) => attack.name === 'Heavy Attack')!
const heavyBase = (name: string, heavyMode: 'biggestHit' | 'fullCombo', combo = 1) =>
  runWeapon(name, { attack: heavyOf(name), heavyMode, buffs: { roar: 0, combo } }).moddedBaseDamage
expectClose('Thalys biggest heavy hit = 600%', heavyBase('Thalys', 'biggestHit'), 300 * 6)
expectClose('Thalys full heavy = 1800%', heavyBase('Thalys', 'fullCombo'), 300 * 18)
// Coda Hirudo, in-game arsenal: 500% + 5 x 300%, first hit 1,375 = 5x of 274.9 (175 + 57.1% Heat)
expectClose('Coda Hirudo biggest hit = 500%', heavyBase('Coda Hirudo', 'biggestHit'), 175 * 5)
expectClose('Coda Hirudo arsenal first hit', runWeapon('Coda Hirudo', { attack: heavyOf('Coda Hirudo'), bonusElement: { damageType: 'heat', value: 0.571 } }).moddedBaseDamage, 274.925 * 5)
expectClose('Coda Hirudo full heavy = 2000%', heavyBase('Coda Hirudo', 'fullCombo'), 175 * 20)
// single-hit classes keep the export's number
expectClose('Galatine Prime heavy unchanged', heavyBase('Galatine Prime', 'fullCombo'), Object.values(heavyOf('Galatine Prime').damage).reduce((a, b) => a + b, 0))
expectClose('Thalys has Incarnon evolutions', getIncarnonTiers('Thalys')?.length ?? 0, 4)
// ---- Warframe abilities (src/data/warframeAbilities.ts) ----
const withAbilities = (ids: string[], abilityStrength = 1, armor = 0) =>
  ({ roar: 0, warframe: { frameName: 'None', abilityStrength, teammateStrength: abilityStrength, armor, casts: ids.map((id) => ({ id, by: 'self' as const })) } })
const plainShotAttack = testAttack({ impact: 100 })
const plainHit = run(plainShotAttack).hit.average
// Roar at 175% strength: +87.5% faction damage (a neutral target has no faction, so check it against Grineer)
expectClose('Roar x strength (faction)', run(plainShotAttack, { buffs: withAbilities(['roar'], 1.75), target: grineerTarget }).factionMultiplier, 1.875)
expectClose('Eclipse x3 damage', run(plainShotAttack, { buffs: withAbilities(['eclipse']) }).hit.average, plainHit * 3)
expectClose('Vex Armor +275% like Serration', run(plainShotAttack, { buffs: withAbilities(['vexArmor']) }).hit.average, plainHit * 3.75)
expectClose("Xata's Whisper: +26% as a separate hit", run(plainShotAttack, { buffs: withAbilities(['xatasWhisper']) }).hit.average, plainHit * 1.26)
const freezeForce = run(testAttack({ impact: 50, heat: 50 }), { buffs: withAbilities(['freezeForce']) })
expectClose('Freeze Force cold stays uncombined', freezeForce.damageTypes.some((row) => row.damageType === 'blast') ? 0 : (freezeForce.damageTypes.find((row) => row.damageType === 'cold')?.procShare ?? 0) > 0 ? 1 : 0, 1)
expectClose('Electric Shield doubles crit damage', run(testAttack({ impact: 100 }, { critMultiplier: 2 }), { buffs: withAbilities(['electricShield']) }).critMultiplier, 4)
expectClose('Wrathful Advance +200% flat crit on melee', runMelee(swing, { buffs: withAbilities(['wrathfulAdvance']) }).critChance, 0.2 + 2)
expectClose('Wrathful Advance skips guns', run(testAttack({ impact: 100 }, { critChance: 0.2 }), { buffs: withAbilities(['wrathfulAdvance']) }).critChance, 0.2)
const bulwarkArcane = arcanes.find((arcane) => arcane.name === 'Primary Bulwark')!
expectClose('Primary Bulwark from Warframe armor (1,300 armor = +300%)',
  run(plainShotAttack, { arcane: { arcane: bulwarkArcane, rank: bulwarkArcane.levelStats.length - 1, conditionalStacks: 0 }, buffs: withAbilities([], 1, 1300) }).hit.average, plainHit * 4)
// Warframe panel: strength/armor/auras from the equipped Warframe mods (src/calc/warframeStats.ts)
const frameNamed = (name: string) => warframes.find((frame) => frame.name === name)!
const wfMod = (name: string) => { const mod = mods.find((candidate) => candidate.name === name && candidate.type === 'Warframe Mod')!; return { mod, rank: mod.fusionLimit } }
const wfBuild = (frameName: string, modNames: string[]) => warframeTotals({ frame: frameNamed(frameName), mods: modNames.map(wfMod), extraStrength: 0, extraArmor: 0, teammateStrength: 1, casts: [], arcanes: [] })
expectClose('Intensify + Blind Rage = 229% strength', wfBuild('Rhino', ['Intensify', 'Blind Rage']).abilityStrength, 1 + 0.3 + 0.99)
expectClose('Steel Fiber doubles armor', wfBuild('Rhino', ['Steel Fiber']).armor, frameNamed('Rhino').armor * 2)
expectClose('Steel Charge +60% melee', wfBuild('Jade', ['Steel Charge', 'Rifle Amp']).auraDamage.melee, 0.6)
expectClose('Jade has two aura slots', frameNamed('Jade').auraPolarities.length, 2)
expectClose('Corrosive Projection counted', wfBuild('Jade', ['Corrosive Projection']).corrosiveProjections, 1)
// own frame's abilities use your strength, others the teammate's
const rhinoState: WarframeState = { frameName: 'Rhino', abilityStrength: 2, teammateStrength: 1, armor: 0, casts: [{ id: 'roar', by: 'self' }] }
expectClose('Roar at your 200% strength', run(plainShotAttack, { buffs: { roar: 0, warframe: rhinoState }, target: grineerTarget }).factionMultiplier, 2)
expectClose('ally Eclipse at teammate 100% strength', run(plainShotAttack, { buffs: { roar: 0, warframe: { ...rhinoState, casts: [{ id: 'eclipse', by: 'ally' }] } } }).hit.average, plainHit * 3)
// subsumed: your strength, Helminth numbers (Roar 30%, Nourish 45%)
expectClose('subsumed Roar 30% x your 200% strength', run(plainShotAttack, { buffs: { roar: 0, warframe: { ...rhinoState, frameName: 'Chroma', casts: [{ id: 'roar', by: 'helminth' }] } }, target: grineerTarget }).factionMultiplier, 1.6)
const nourishSubsumed = run(testAttack({ impact: 100 }), { buffs: { roar: 0, warframe: { ...rhinoState, casts: [{ id: 'nourish', by: 'helminth' }] } } })
expectClose('subsumed Nourish 45% viral x 200%', typeValue(nourishSubsumed, 'viral'), Math.floor(0.9 * 32 + 0.5) / 32 * 100)
expectClose('Excalibur passive needs you on Excalibur', runMelee(swing, { buffs: { roar: 0, warframe: { ...rhinoState, casts: [{ id: 'excaliburPassive', by: 'ally' }] } } }).hit.normal, 100)
expectClose('Roar can only replace damage buffs', canSubsumeInto('Chroma', 'Vex Armor', 'Roar') && !canSubsumeInto('Chroma', 'Effigy', 'Roar') && !canSubsumeInto('Saryn', 'Molt', 'Roar') && canSubsumeInto('Saryn', 'Molt', 'Nourish') ? 1 : 0, 1)
expectClose('Steel Charge on melee via aura damage', runMelee(swing, { buffs: { roar: 0, warframe: { ...rhinoState, casts: [], auraDamage: { melee: 0.6, rifle: 0, sniper: 0, pistol: 0, shotgun: 0 } } } }).hit.normal, 160)

// ---- survivability (src/calc/warframeStats.ts) ----
const valkyr = frameNamed('Valkyr')
const defense = (frameName: string, modNames: string[], casts: { id: string; by: 'self' | 'helminth' | 'ally' }[], extra: Partial<Parameters<typeof warframeTotals>[0]> = {}) =>
  warframeTotals({ frame: frameNamed(frameName), mods: modNames.map(wfMod), extraStrength: 0, extraArmor: 0, teammateStrength: 1, casts, arcanes: [], ...extra })
// Warcry wiki: Base Armor x (1 + Armor Mods + Warcry x (1 + Strength Mods))
const warcryValkyr = defense('Valkyr', ['Steel Fiber', 'Intensify'], [{ id: 'warcry', by: 'self' }])
expectClose('Warcry armor: base x (1 + mods + 50% x strength)', warcryValkyr.armor, Math.round(valkyr.armor * (1 + 1 + 0.5 * 1.3)))
expectClose('armor DR = armor / (armor + 300)', warcryValkyr.healthDr, warcryValkyr.armor / (warcryValkyr.armor + 300))
// Null Star 12 x 5% = 60%, multiplies with armor DR (health) and the shields' innate 50% (shields)
const nova = defense('Nova', [], [{ id: 'nullStar', by: 'self' }])
const novaArmorDr = nova.armor / (nova.armor + 300)
expectClose('Null Star x armor on health', nova.healthDr, 1 - (1 - novaArmorDr) * 0.4)
expectClose('Null Star x innate 50% on shields', nova.shieldDr, 1 - 0.5 * 0.4)
expectClose('Null Star from an ally does nothing for you', defense('Rhino', [], [{ id: 'nullStar', by: 'ally' }]).drSources.length, 2)
expectClose('subsumed Null Star capped at 75%', defense('Rhino', ['Intensify', 'Transient Fortitude', 'Blind Rage'], [{ id: 'nullStar', by: 'helminth' }]).drSources.find((source) => source.label.startsWith('Null Star'))!.value, 0.75)
expectClose('Vitality +100% health', defense('Rhino', ['Vitality'], []).health, frameNamed('Rhino').health * 2)
const guardian = arcanes.find((arcane) => arcane.name === 'Arcane Guardian')!
expectClose('Arcane Guardian +900 flat armor', defense('Rhino', [], [], { arcanes: [{ arcane: guardian, rank: 5, conditionalStacks: 1 }] }).armor, frameNamed('Rhino').armor + 900)
const persistence = arcanes.find((arcane) => arcane.name === 'Arcane Persistence')!
const persistent = defense('Valkyr', ['Steel Fiber'], [], { arcanes: [{ arcane: persistence, rank: 5, conditionalStacks: 0 }] })
expectClose('Arcane Persistence sets shields to 0', persistent.shields, 0)
expectClose('Arcane Persistence cap on above 700 armor (500/s at max rank)', persistent.damageCap?.active && persistent.damageCap.perSecond === 500 ? 1 : 0, 1)
expectClose('no shields = effective health is just health', persistent.effectiveHealth, persistent.health / (1 - persistent.healthDr))
// Warframe arcanes on weapons: Arcane Avenger is flat crit after mods (wiki: 25% x (1 + 120%) + 60% + 45%), Arcane Fury melee only
const frameArcane = (name: string) => ({ arcaneId: arcanes.find((arcane) => arcane.name === name)!.uniqueName, rank: 5, conditionalStacks: 1 })
const withFrameArcane = (name: string): CalcInput['buffs'] => ({ roar: 0, warframe: { frameName: 'None', abilityStrength: 1, teammateStrength: 1, armor: 0, casts: [], arcanes: [frameArcane(name)] } })
expectClose('Arcane Avenger +45 points after mods', runMelee(swing, { mods: [meleeMod('True Steel')], buffs: withFrameArcane('Arcane Avenger') }).critChance, 0.2 * 2.2 + 0.45)
expectClose('Arcane Fury +180% on melee', runMelee(swing, { buffs: withFrameArcane('Arcane Fury') }).hit.normal, 280)
expectClose('Arcane Fury skips guns', run(testAttack({ impact: 100 }), { buffs: withFrameArcane('Arcane Fury') }).hit.normal, 100)

// ---- damage augments ----
const castState = (casts: WarframeState['casts'], frameName = 'None'): CalcInput['buffs'] => ({ roar: 0, warframe: { frameName, abilityStrength: 1, teammateStrength: 1, armor: 0, casts } })
expectClose('Biting Frost +200% crit chance like a mod (on Frost)', runMelee(swing, { buffs: castState([{ id: 'bitingFrost', by: 'self' }], 'Frost') }).critChance, 0.2 * 3)
expectClose('Biting Frost needs you on Frost', runMelee(swing, { buffs: castState([{ id: 'bitingFrost', by: 'ally' }]) }).critChance, 0.2)
const shockTrooper = run(testAttack({ impact: 50, heat: 50 }), { buffs: castState([{ id: 'shockTrooper', by: 'ally' }]) })
expectClose('Shock Trooper electricity stays uncombined (no radiation)', shockTrooper.damageTypes.some((row) => row.damageType === 'radiation') ? 0 : 1, 1)
const primaryShot = (extra: CalcInput['buffs']) => run(testAttack({ impact: 100 }, { critChance: 0.2 }), { weapon: { ...testWeapon(testAttack({ impact: 100 })), category: 'Primary' }, buffs: extra })
expectClose('Thrall Pact 4 thralls = +100% primary damage', primaryShot(castState([{ id: 'thrallPact', by: 'self', stacks: 4 }], 'Revenant')).hit.normal, 200)
expectClose('Teeming Virulence skips secondaries', run(testAttack({ impact: 100 }, { critChance: 0.2 }), { weapon: { ...testWeapon(testAttack({ impact: 100 })), category: 'Secondary' }, buffs: castState([{ id: 'teemingVirulence', by: 'self' }], 'Nidus') }).critChance, 0.2)
// Thermal Transfer: heat (hold) / cold (tap) / both = Blast "equaling the sum", x strength, doesn't combine
const strongCast = (id: string): CalcInput['buffs'] => ({ roar: 0, warframe: { frameName: 'None', abilityStrength: 1, teammateStrength: 2, armor: 0, casts: [{ id, by: 'ally' }] } })
const ttBlast = run(testAttack({ impact: 100 }), { buffs: strongCast('thermalTransferBlast') })
expectClose('Thermal Transfer both = 150% Blast x 200% strength', typeValue(ttBlast, 'blast'), 300)
const ttHeat = run(testAttack({ impact: 50, cold: 50 }, { statusChance: 1 }), { buffs: strongCast('thermalTransferHeat') })
expectClose('Thermal Transfer heat stays uncombined (no blast)', ttHeat.damageTypes.some((row) => row.damageType === 'blast') ? 0 : 1, 1)
const plainHeatTick = run(testAttack({ impact: 50, heat: 50 }, { statusChance: 1 })).dots.find((dot) => dot.damageType === 'heat')!.tick.normal
const ttHeatTick = run(testAttack({ impact: 50, heat: 50 }, { statusChance: 1 }), { buffs: strongCast('thermalTransferHeat') }).dots.find((dot) => dot.damageType === 'heat')!.tick.normal
expectClose('Thermal Transfer heat adds to heat DoTs like a mod (+150%)', ttHeatTick / plainHeatTick, 2.5)

// Smite Infusion wiki example: 100 Impact + Hellfire + Smite Infusion at 110% strength = 100 Impact, 90 Heat, 110 Radiation,
// procs 100/300 Impact, 90/300 Heat, 110/300 Radiation
const smiteBuffs: CalcInput['buffs'] = { roar: 0, warframe: { frameName: 'None', abilityStrength: 1, teammateStrength: 1.1, armor: 0, casts: [{ id: 'smiteInfusion', by: 'ally' }] } }
const smiteExample = run(testAttack({ impact: 100 }), { mods: [maxed('Hellfire')], buffs: smiteBuffs })
expectClose('Smite Infusion example: heat 90 (quantized)', typeValue(smiteExample, 'heat'), Math.floor(0.9 * 32 + 0.5) / 32 * 100)
expectClose('Smite Infusion example: radiation 110 (quantized)', typeValue(smiteExample, 'radiation'), Math.floor(1.1 * 32 + 0.5) / 32 * 100)
expectClose('Smite Infusion example: radiation proc share ~110/300', smiteExample.damageTypes.find((row) => row.damageType === 'radiation')!.procShare, typeValue(smiteExample, 'radiation') / (100 + typeValue(smiteExample, 'heat') + typeValue(smiteExample, 'radiation')))
// Shock Trooper: electricity takes no proc share, one guaranteed Electricity proc per hit instead
const shockBuffs: CalcInput['buffs'] = { roar: 0, warframe: { frameName: 'None', abilityStrength: 1, teammateStrength: 1, armor: 0, casts: [{ id: 'shockTrooper', by: 'ally' }] } }
const shockExample = run(testAttack({ impact: 100 }, { statusChance: 0 }), { buffs: shockBuffs })
expectClose('Shock Trooper adds 100% electricity', typeValue(shockExample, 'electricity'), 100)
expectClose('Shock Trooper electricity takes no proc share', shockExample.damageTypes.find((row) => row.damageType === 'electricity')!.procShare, 0)
expectClose('Shock Trooper forces 1 electricity proc per hit', shockExample.dots.find((dot) => dot.damageType === 'electricity')!.procsPerSecond, 1)
// two of the same buff: only the strongest
const twoRoars: CalcInput['buffs'] = { roar: 0, warframe: { frameName: 'Rhino', abilityStrength: 2, teammateStrength: 1, armor: 0, casts: [{ id: 'roar', by: 'self' }, { id: 'roar', by: 'ally' }] } }
expectClose('two Roars: only the strongest applies', run(plainShotAttack, { buffs: twoRoars, target: grineerTarget }).factionMultiplier, 2)

// ---- mod sets (src/calc/modSets.ts) ----
// Umbra: 3 pieces = Vitality/Fiber x1.8, Intensify x1.75 (Umbral Fiber wiki: +180% Armor with 3)
const umbra3 = defense('Rhino', ['Umbral Vitality', 'Umbral Fiber', 'Umbral Intensify'], [])
expectClose('Umbral 3/3: +180% health', umbra3.health, Math.round(frameNamed('Rhino').health * 2.8))
expectClose('Umbral 3/3: +180% armor', umbra3.armor, Math.round(frameNamed('Rhino').armor * 2.8))
expectClose('Umbral 3/3: Intensify +44% x1.75', umbra3.abilityStrength, 1 + 0.44 * 1.75)
expectClose('Umbral 2/3: Fiber x1.3', defense('Rhino', ['Umbral Vitality', 'Umbral Fiber'], []).armor, Math.round(frameNamed('Rhino').armor * 2.3))
// Sacrificial: both pieces x1.25 (+220% -> +275% crit chance)
expectClose('Sacrificial set: Steel +275% crit', runMelee(swing, { mods: [meleeMod('Sacrificial Steel'), meleeMod('Sacrificial Pressure')] }).critChance, 0.2 * (1 + 2.2 * 1.25))
expectClose('Sacrificial set: Pressure +137.5% damage', runMelee(testAttack({ slash: 100 }), { mods: [meleeMod('Sacrificial Steel'), meleeMod('Sacrificial Pressure')] }).hit.normal, 100 * (1 + 1.1 * 1.25))
// Gladiator pieces on the frame count with the weapon's
const frameSets = (setPieces: Record<string, number>): CalcInput['buffs'] => ({ roar: 0, combo: 12, warframe: { frameName: 'None', abilityStrength: 1, teammateStrength: 1, armor: 0, casts: [], setPieces } })
expectClose('Gladiator: 1 on weapon + 2 on frame', runMelee(swing, { mods: [meleeMod('Gladiator Might')], buffs: frameSets({ Gladiator: 2 }) }).critChance, 0.2 * (1 + 0.3 * 11))
// Vigilante: 5% per piece chance to bump a crit a tier, on primaries
const primaryWeapon = { ...testWeapon(testAttack({ impact: 100 })), category: 'Primary' }
const vigilanteCrit = run(testAttack({ impact: 100 }, { critChance: 0.5 }), { weapon: primaryWeapon, mods: [maxed('Vigilante Armaments')], buffs: frameSets({ Vigilante: 1 }) }).critChance
expectClose('Vigilante 2 pieces: +10% of crits enhanced', vigilanteCrit, 0.5 + 0.1 * 0.5)
// Nira's: +150% slam damage per piece, added with Seismic Wave
const slamAttack = testAttack({ impact: 100 }, { name: 'Slam Attack' })
expectClose("Nira's 2 pieces + Seismic Wave: x(1 + 2 + 3)", runMelee(slamAttack, { mods: [meleeMod('Seismic Wave')], buffs: frameSets({ Nira: 2 }) }).hit.normal, 100 * 6)
// ---- weapon augments (src/calc/specialLines.ts) ----
const latronGun = named('Latron')
const doubleTap = mods.find((mod) => mod.name === 'Double Tap')!
expectClose('Double Tap: 20 stacks of +20% next shot', calculate({ weapon: latronGun, attack: latronGun.attacks[0], mods: [{ mod: doubleTap, rank: doubleTap.fusionLimit, conditionalStacks: 20 }], armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 }, target: grineerTarget }).hit.normal /
  calculate({ weapon: latronGun, attack: latronGun.attacks[0], mods: [], armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 }, target: grineerTarget }).hit.normal, 5)
const basmu = named('Basmu')
const killshot = mods.find((mod) => mod.name === 'Dreadful Killshot')!
const basmuRun = (health: number) => calculate({ weapon: basmu, attack: basmu.attacks[0], mods: [{ mod: killshot, rank: killshot.fusionLimit, conditionalStacks: 18 }], armor: 0, debuffs: noDebuffs(),
  buffs: { roar: 0, warframe: { frameName: 'None', abilityStrength: 1, teammateStrength: 1, armor: 0, casts: [], health } }, target: grineerTarget })
expectClose('Dreadful Killshot: 600 health = 8 stacks = +160%', basmuRun(600).hit.normal / basmuRun(74).hit.normal, 2.6)
const napalm = mods.find((mod) => mod.name === 'Napalm Grenades')!
const penta = named('Penta')
expectClose('Napalm Grenades: +30 final status chance', calculate({ weapon: penta, attack: penta.attacks[0], mods: [{ mod: napalm, rank: napalm.fusionLimit, conditionalStacks: 0 }], armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 }, target: grineerTarget }).statusChance, penta.attacks[0].statusChance + 0.3)
expectClose('Range Advantage (filed as a Primary Mod) fits the Akjagara', getCompatibleMods(named('Akjagara')).some((mod) => mod.name === 'Range Advantage') ? 1 : 0, 1)
expectClose('Clip Delegation (Primary Mod) fits the Sobek shotgun', getCompatibleMods(named('Sobek')).some((mod) => mod.name === 'Clip Delegation') ? 1 : 0, 1)
expectClose("Nira's Contempt fits whips", getCompatibleMods(named('Lecta')).some((mod) => mod.name === "Nira's Contempt") ? 1 : 0, 1)

// requirement list
const deadheadArcane = arcanes.find((arcane) => arcane.name === 'Primary Deadhead')!
const needs = run(plainShotAttack, {
  mods: [{ ...maxed('Galvanized Chamber'), conditionalStacks: 5 }], arcane: { arcane: deadheadArcane, rank: deadheadArcane.levelStats.length - 1, conditionalStacks: 1 },
  buffs: castState([{ id: 'bitingFrost', by: 'self' }], 'Frost'),
}).requirements
console.log('requirements:', needs)
expectClose('requirements list kills, headshot kills and frozen targets',
  needs.some((line) => /Galvanized Chamber: on Kill/i.test(line)) && needs.some((line) => /Deadhead: on Weak Point Kill/i.test(line)) && needs.some((line) => /frozen/.test(line)) ? 1 : 0, 1)

// ---- glaives: the heavy detonation (Recall Explosion) ----
const glaivePrime = named('Glaive Prime')
const detonation = glaivePrime.attacks.find((attack) => attack.name === 'Charged Throw Recall Explosion')!
const runGlaive = (attack: Attack, overrides: Partial<CalcInput> = {}) => run(attack, { weapon: glaivePrime, ...overrides })
expectClose('glaive detonation is a heavy', detonation.heavy ? 1 : 0, 1)
// overframe heavy detonation guide: 1,184 x 3.85 (Primed Pressure Point + Killing Blow) x 2 combo = 9,116.8
expectClose('Glaive Prime detonation modded base (PPP + Killing Blow, 2x combo)',
  runGlaive(detonation, { mods: [meleeMod('Primed Pressure Point'), meleeMod('Killing Blow')], buffs: { roar: 0, combo: 2 } }).moddedBaseDamage, 1184 * 3.85 * 2)
// "Condition Overload does not affect the explosion"
expectClose('CO skips the detonation', resolveCoBehavior(glaivePrime, detonation).mode === 'none' ? 1 : 0, 1)
// "Explosion inflicts a guaranteed Impact and Slash proc": one of each per detonation even at 0% status
const forcedOnly = runGlaive({ ...detonation, statusChance: 0 })
expectClose('forced Slash proc per detonation', forcedOnly.dots.find((dot) => dot.damageType === 'slash')!.procsPerSecond / forcedOnly.fireRate, 1)
// Sacrificial Steel is x2 on the detonation
expectClose('Sacrificial Steel x2 on the detonation', runGlaive(detonation, { mods: [meleeMod('Sacrificial Steel')] }).critChance, 0.26 * (1 + 4.4))
expectClose('Glaive mods (Thrown Melee) fit glaives', getCompatibleMods(glaivePrime).some((mod) => mod.name === 'Power Throw') ? 1 : 0, 1)
expectClose('...and not swords', getCompatibleMods(named('Skana')).some((mod) => mod.name === 'Power Throw') ? 1 : 0, 0)
// Power Throw: 3 stacks of +100% throw damage, its own multiplier, only on the throw itself
const throwAttack = glaivePrime.attacks.find((attack) => attack.name === 'Charged Throw')!
const powerThrow = { ...meleeMod('Power Throw'), conditionalStacks: 3 }
expectClose('Power Throw x4 on the throw', runGlaive(throwAttack, { mods: [powerThrow] }).hit.normal / runGlaive(throwAttack).hit.normal, 4)
expectClose('Power Throw not on the explosion', runGlaive(detonation, { mods: [powerThrow] }).hit.normal / runGlaive(detonation).hit.normal, 1)
// Seismic Wave: +200% slam damage, multiplicative with Pressure Point
const slam = glaivePrime.attacks.find((attack) => attack.name === 'Slam Attack')!
expectClose('Seismic Wave x3 on slams, x Pressure Point',
  runGlaive(slam, { mods: [meleeMod('Seismic Wave'), meleeMod('Primed Pressure Point')] }).hit.normal / runGlaive(slam).hit.normal, 3 * 2.65)
// Melee Duplicate: crits strike a second time. at 100%+ crit every hit doubles, the single hit stays one instance
const duplicate = arcanes.find((arcane) => arcane.name === 'Melee Duplicate')!
const withDuplicate = runGlaive(detonation, {
  mods: [meleeMod('Sacrificial Steel'), meleeMod('Blood Rush')], buffs: { roar: 0, combo: 12 },
  arcane: { arcane: duplicate, rank: duplicate.levelStats.length - 1, conditionalStacks: 1 },
})
expectClose('Melee Duplicate doubles a 100%+ crit detonation', withDuplicate.averageShot / withDuplicate.hit.average, 2)
expectClose('whole attack = 2 strikes + their procs', withDuplicate.attackTotal > withDuplicate.averageShot ? 1 : 0, 1)

// sanity: standard Braton Prime build, element combining in slot order
const braton = weapons.find((weapon) => weapon.name === 'Braton Prime')!
const bratonBuild = ['Serration', 'Split Chamber', 'Point Strike', 'Vital Sense', 'Hellfire', 'Cryo Rounds', 'Stormbringer', 'Infected Clip'].map(maxed)
const bratonResult = calculate({
  weapon: braton, attack: braton.attacks[0], mods: bratonBuild, armor: 0, debuffs: noDebuffs(), buffs: { roar: 0 },
  target: { faction: 'None', layer: 'health', enemyId: null, baseLevel: 1, level: 1, steelPath: false, manualArmor: 0, headshot: false, headshotMultiplier: 3, headcrit: false },
})
console.log('Braton Prime types:', bratonResult.damageTypes.map((row) => `${row.damageType} ${row.modded}`).join(', '))
expectClose('Braton blast (90% heat + 90% cold, quantized)', typeValue(bratonResult, 'blast'), (Math.floor(1.8 * 32 + 0.5) / 32) * 35 * 2.65)

if (failures) throw new Error(`${failures} check(s) failed`)
console.log('\nall checks passed')
