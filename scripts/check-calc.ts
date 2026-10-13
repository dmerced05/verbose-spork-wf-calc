// checks the calc against worked examples from the wiki. run with: npm run check
import { calculate, type CalcInput } from '../src/calc/damage'
import { STATUS_TYPES } from '../src/calc/constants'
import { arcanes, mods, weapons } from '../src/data'
import { scaleArmor, scaleHealth } from '../src/calc/target'
import { estimateKill } from '../src/calc/kill'
import { resolveCoBehavior } from '../src/calc/conditionOverload'
import { getIncarnonTiers } from '../src/calc/incarnon'
import { INCARNON_FAMILIES } from '../src/data/incarnon'
import type { Attack, Debuffs, Mod, Weapon } from '../src/types'

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
expectClose('Exergis sustained = burst x uptime', exergisPlain.sustainedDps, exergisPlain.totalDps * exergisPlain.uptime)
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
