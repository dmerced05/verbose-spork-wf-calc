// damaging Warframe abilities, max rank, every number and quote from the ability's own wiki page (Nov 2026). each one
// builds a timeline of hits (src/calc/abilityDamage.ts runs it against the target). raw damage = base x Ability Strength
// unless the page leaves Strength off a number (Soul Punch's soul projectile)
// scaling = the tooltip: how the ability grows, in the wiki's words
import type { AbilityContext, AbilityRun, DamageEvent } from '../calc/abilityDamage'

export interface AbilityParam {
  id: string
  label: string
  default: number
  min?: number
  max?: number
  step?: number
  options?: { value: number; label: string }[] // a dropdown instead of a number
  title?: string
}

export interface AbilityDamageDef {
  id: string
  warframe: string // base name (Banshee, not Banshee Prime)
  ability: string // the in-game ability (matches the frame's ability list)
  name: string // what the card says (Sound Quake (Gaseous Quake))
  augment?: string // needs this augment equipped
  summary: string
  scaling: string[]
  params?: AbilityParam[]
  build: (ctx: AbilityContext, p: Record<string, number>) => AbilityRun
}

const lerp = (low: number, high: number, fraction: number) => low + (high - low) * Math.min(1, Math.max(0, fraction))
// a damage tick every `every` seconds over `seconds`, starting at `start`
const ticks = (seconds: number, every: number, start = 0) => Array.from({ length: Math.max(0, Math.floor(seconds / every + 1e-9)) }, (_, i) => start + i * every)
const hit = (t: number, label: string, raw: number, types: Record<string, number>, extra: Partial<DamageEvent> = {}): DamageEvent => ({ t, label, raw, types, ...extra })

export const ABILITY_DAMAGE: AbilityDamageDef[] = [
  {
    id: 'sound-quake', warframe: 'Banshee', ability: 'Sound Quake', name: 'Sound Quake',
    summary: '200 Blast per second in a zone for 25 s, 1-5 Blast procs per hit by distance',
    scaling: [
      '"Enemies within the zone take 125 / 150 / 175 / 200 Blast damage per second ... proccing 1 - 5 Blast statuses per hit (scaling with distance to the epicenter)"',
      'Strength: damage. Duration: how long the zone lasts (10 / 15 / 20 / 25 s). Range: zone size, and the 5-proc ring is "roughly the first 20% of the ability\'s max range"',
      '"Sound Quake\'s damage per second cannot be increased by Sonar"',
    ],
    params: [{ id: 'procs', label: 'Blast procs per hit', default: 5, min: 1, max: 5, title: '5 within ~20% of the range from the center, down to 1 at the edge' }],
    build: (ctx, p) => ({
      events: ticks(25 * ctx.duration, 1).map((t) => hit(t, 'Quake pulse', 200 * ctx.strength, { blast: 1 }, { procs: { blast: p.procs } })),
    }),
  },
  {
    id: 'gaseous-quake', warframe: 'Banshee', ability: 'Sound Quake', name: 'Sound Quake (Gaseous Quake)', augment: 'Gaseous Quake',
    summary: 'Channeled: Gas damage that multiplies x2.75 every second, capped at 24,736x after 10 s',
    scaling: [
      '"Current damage per second is multiplied by 2.75x for each second the ability is channeled. This multiplier stacks multiplicatively with itself each second, up to a cap of 24,736x after 10 seconds of channeling"',
      '"Enemies within the zone initially take 125 / 150 / 175 / 200 Gas damage per second, suffering Stagger and 1 - 5 Gas procs per hit"',
      '"The zone remains for 6.25 seconds after Banshee stops channeling ... Maintains the final damage multiplier" (Ability Duration)',
      'Energy: 100 to cast, then 16/s that "is multiplied by 1.2x for each second", about 614 total to reach the cap. Gas procs past 10 replace the oldest',
    ],
    params: [
      { id: 'channel', label: 'Seconds channeled', default: 10, min: 1, max: 20 },
      { id: 'procs', label: 'Gas procs per hit', default: 5, min: 1, max: 5 },
    ],
    build: (ctx, p) => {
      const multiplier = (second: number) => 2.75 ** Math.min(second, 10)
      const channel = ticks(p.channel, 1).map((t) => hit(t, 'Channeled pulse', 200 * ctx.strength * multiplier(t), { gas: 1 }, { procs: { gas: p.procs } }))
      const linger = ticks(6.25 * ctx.duration, 1, p.channel).map((t) => hit(t, 'Lingering zone', 200 * ctx.strength * multiplier(p.channel), { gas: 1 }, { procs: { gas: p.procs } }))
      return { events: [...channel, ...linger], notes: [`x${Math.round(multiplier(p.channel)).toLocaleString()} after ${p.channel} s of channeling`] }
    },
  },
  {
    id: 'thermal-sunder', warframe: 'Gauss', ability: 'Thermal Sunder', name: 'Thermal Sunder',
    summary: 'Cold or Heat burst scaled by battery. Heat recasts add the current Heat DoT, Redline doubles Heat, cold after heat makes Blast',
    scaling: [
      '"Enemies caught in the area creation receive 75 - 375 / 100 - 500 / 125 - 625 / 150 - 750 Cold damage based on battery" (Heat: 300 - 1500)',
      'Heat: "When cast on enemies already affected by Heat proc, Thermal Sunder deals its normal damage plus the damage per second of the current Heat proc ... allowing repeated casts to exponentially scale the damage"',
      'Redline above 80% battery: "Heat mode\'s damage is doubled. This doubling is applied after the bonus damage from active heat procs"',
      'Combine: "Blast damage is given by: Heat Proc Damage x Remaining Proc Duration + Damage of Canceling Cast", and with Redline "permanently strips their Armor ... from 0% armor reduction at 80% battery to 100% armor reduction at 100% battery"',
      'Subsumed: "equivalent to 50% of Gauss\'s battery: 225 / 300 / 375 / 450 Cold damage and 450 / 600 / 750 / 900 Heat damage", Heat scaling "capped to 10x of the ability\'s damage"',
      'Status duration 4 - 8 s by battery (Ability Duration). The lingering area DPS shrinks with the area and isn\'t on the wiki, so it\'s left out',
    ],
    params: [
      { id: 'mode', label: 'Cast', default: 1, options: [{ value: 0, label: 'Cold' }, { value: 1, label: 'Heat (recasts stack)' }, { value: 2, label: 'Heat, then Cold (Blast combine)' }] },
      { id: 'battery', label: 'Battery %', default: 100, min: 0, max: 100, step: 5 },
      { id: 'redline', label: 'Redline active', default: 1, options: [{ value: 1, label: 'Yes' }, { value: 0, label: 'No' }] },
      { id: 'casts', label: 'Heat casts (1 s apart)', default: 3, min: 1, max: 10 },
    ],
    build: (ctx, p) => {
      const battery = p.battery / 100
      const subsumed = ctx.subsumed
      const coldBase = subsumed ? 450 : lerp(150, 750, battery)
      const heatBase = subsumed ? 900 : lerp(300, 1500, battery)
      const redline = !subsumed && p.redline === 1 && battery > 0.8
      const statusSeconds = (subsumed ? 6 : lerp(4, 8, battery)) * ctx.duration
      const events: DamageEvent[] = []
      if (p.mode === 0) {
        events.push(hit(0, 'Cold cast', coldBase * ctx.strength, { cold: 1 }, { procs: { cold: redline ? 10 : 1 }, procSeconds: statusSeconds }))
        return { events }
      }
      // Heat: each cast adds the Heat DoT/s already on the target, then Redline doubles it. Heat procs refresh each other, so
      // every earlier cast's proc is still ticking at 50% of its hit per second
      const casts = p.mode === 2 ? 1 : p.casts
      let heatDps = 0
      let lastHeat = 0
      for (let n = 0; n < casts; n++) {
        const base = heatBase * ctx.strength
        const bonus = subsumed ? Math.min(heatDps, 10 * base) : heatDps
        const raw = (base + bonus) * (redline ? 2 : 1)
        events.push(hit(n, `Heat cast ${n + 1}`, raw, { heat: 1 }, { procs: { heat: 1 }, procSeconds: statusSeconds }))
        heatDps += 0.5 * raw
        lastHeat = raw
      }
      if (p.mode === 2) {
        // cold 1 s later: Heat proc DoT/s x what's left of it + the cold cast, as Blast
        const remaining = Math.max(0, statusSeconds - 1)
        const cold = coldBase * ctx.strength
        events.push(hit(1, 'Blast combine (cold cast)', 0.5 * lastHeat * remaining + cold, { blast: 1 }, {
          procs: { blast: 1, cold: 1 }, clearProcs: ['heat'], procSeconds: statusSeconds,
          armorStripBefore: redline ? lerp(0, 1, (battery - 0.8) / 0.2) : 0,
        }))
      }
      return { events, notes: redline ? ['Redline above 80% battery: Heat doubled'] : [] }
    },
  },
  {
    id: 'miasma', warframe: 'Saryn', ability: 'Miasma', name: 'Miasma',
    summary: '150 Viral per second for 6 s, guaranteed Viral on cast, 4x on Spore-infected enemies',
    scaling: [
      '"dealing 110 / 125 / 135 / 150 Viral damage per second, with 100% Viral status chance on cast", for "6 seconds" (Ability Duration)',
      'Spores: "4.0x (Spores damage multiplier)", the tip says "follow up with Miasma to deal quadruple damage"',
      'The cast\'s own Viral proc doubles every tick after it (Viral on health)',
    ],
    params: [{ id: 'spored', label: 'Target has Spores', default: 1, options: [{ value: 1, label: 'Yes (4x)' }, { value: 0, label: 'No' }] }],
    build: (ctx, p) => ({
      events: ticks(6 * ctx.duration, 1).map((t) => hit(t, 'Miasma tick', 150 * ctx.strength * (p.spored ? 4 : 1), { viral: 1 }, t === 0 ? { procs: { viral: 1 } } : {})),
    }),
  },
  {
    id: 'spores', warframe: 'Saryn', ability: 'Spores', name: 'Spores',
    summary: 'Corrosive damage per spore per second that grows with time and infected enemies, capped at 100,000',
    scaling: [
      '"damage per second starts at 6 / 8 / 8 / 10 Corrosive damage; for every second Spores remain active, damage per second increases by 1 / 1.25 / 1.5 / 2 Corrosive damage per infected enemy, up to a damage growth cap of 7 infected enemies"',
      '"Current damage per second is hard-capped at 100,000 damage"',
      '"Each individual spore inflicts Corrosive damage per second with a 50% Corrosive Status Chance" (Strength scales the chance), "tripled on an enemy carrying three spores"',
      'Decay: with no infected enemies left it drops 20% then 10% (Ability Duration) every half second',
    ],
    params: [
      { id: 'seconds', label: 'Seconds since outbreak', default: 30, min: 0, max: 600 },
      { id: 'enemies', label: 'Infected enemies (growth, max 7)', default: 7, min: 1, max: 7 },
      { id: 'spores', label: 'Spores on the target', default: 3, min: 1, max: 12 },
    ],
    build: (ctx, p) => {
      const perSpore = (t: number) => Math.min(100_000, (10 + 2 * (p.seconds + t) * Math.min(7, p.enemies)) * ctx.strength)
      const chance = Math.min(1, 0.5 * ctx.strength)
      return {
        events: ticks(10, 1).map((t) => hit(t, 'Spore ticks', p.spores * perSpore(t), { corrosive: 1 }, { procs: { corrosive: p.spores * chance } })),
        notes: [`${Math.round(perSpore(0)).toLocaleString()} per spore per second at the start of the window`],
      }
    },
  },
  {
    id: 'reave', warframe: 'Revenant', ability: 'Reave', name: 'Reave',
    summary: 'Drains 8% of max health and shields per pass',
    scaling: [
      '"Enemies passing through the energy current are drained 2% / 4% / 6% / 8% of their maximum Shields and Health" (Ability Strength)',
      '"Hitpoints from enemies can be drained and restored to Revenant multiple times, if enemies pass through the same instance of Reave"',
      'A drain of max HP, so I don\'t put armor or damage type on it. Uses the target\'s max health/shields from the Target panel',
    ],
    params: [{ id: 'passes', label: 'Passes through the target', default: 1, min: 1, max: 10 }],
    build: (ctx, p) => {
      const pool = ctx.target.health + ctx.target.shield
      const per = Math.min(1, 0.08 * ctx.strength) * pool
      return { events: ticks(p.passes, 1).map((t) => hit(t * 0.5, 'Reave pass', per, {}, { trueDamage: true })), notes: pool ? [] : ['Pick an enemy and level in the Target panel: Reave is % of its health'] }
    },
  },
  {
    id: 'smite', warframe: 'Oberon', ability: 'Smite', name: 'Smite',
    summary: 'Strips all armor, then 35% of current health/shields + 500 Radiation, 10 Radiation procs',
    scaling: [
      '"removing 100% of the target\'s Overguard and Armor, inflicting 20% / 25% / 30% / 35% of their current Health, Shields, and 150 / 200 / 300 / 500 as Radiation damage, while also applying 10 Radiation status effects"',
      '"Percentage damage on main target is capped at 75%, achievable with 215% Ability Strength"',
      'Nearby enemies take "10% of the main target\'s current health, shields and 150 / 200 / 300 / 500" (capped 30%), not counted here',
    ],
    params: [{ id: 'healthPct', label: 'Target health left %', default: 100, min: 1, max: 100 }],
    build: (ctx, p) => {
      const current = (ctx.target.health + ctx.target.shield) * p.healthPct / 100
      return {
        events: [hit(0, 'Smite', Math.min(0.75, 0.35 * ctx.strength) * current + 500 * ctx.strength, { radiation: 1 }, { armorStripBefore: 1, procs: { radiation: 10 } })],
        notes: current ? [] : ['Pick an enemy and level in the Target panel for the % of health part'],
      }
    },
  },
  {
    id: 'reckoning', warframe: 'Oberon', ability: 'Reckoning', name: 'Reckoning',
    summary: '7,500 Radiation + 750 per Radiation proc on the target, after a 60% armor strip',
    scaling: [
      '"permanently reducing their Armor by 10% / 20% / 30% / 60% before dealing 6000 / 6500 / 7000 / 7,500 Radiation damage, plus an additional 450 / 550 / 650 / 750 damage per Radiation Status Effect"',
      '"Enemy armor is fully removed at 167% Ability Strength"',
      'Smite first: its 10 Radiation procs make Reckoning 7,500 + 10 x 750',
    ],
    params: [{ id: 'radiation', label: 'Radiation procs on the target', default: 10, min: 0, max: 10 }],
    build: (ctx, p) => ({
      events: [hit(0, 'Reckoning', (7500 + 750 * p.radiation) * ctx.strength, { radiation: 1 }, { armorStripBefore: Math.min(1, 0.6 * ctx.strength), procs: { radiation: 1 } })],
    }),
  },
  {
    id: 'seeking-talons', warframe: 'Garuda', ability: 'Seeking Talons', name: 'Seeking Talons',
    summary: '12 + 1 per target talons, 300 Slash each with a Slash proc, split between targets',
    scaling: [
      '"Enemies pierced by Garuda\'s talons will receive 150 / 200 / 250 / 300 Slash damage"',
      '"Talons have 0% critical chance, 1.0x critical multiplier, and 100% status chance" and "can benefit from Universal Weapon Bonuses such as Arcane Arachne and Nourish" (not counted)',
      '"casting Seeking Talons against a single enemy will create 12 + 1 = 13 talons, which will all damage that target"',
    ],
    params: [{ id: 'enemies', label: 'Enemies targeted', default: 1, min: 1, max: 20 }],
    build: (ctx, p) => {
      const onTarget = Math.ceil((12 + p.enemies) / p.enemies)
      return { events: ticks(onTarget, 1).map((i) => hit(i * 0.1, 'Talon', 300 * ctx.strength, { slash: 1 }, { procs: { slash: 1 } })), notes: [`${onTarget} talons on this target`] }
    },
  },
  {
    id: 'discharge', warframe: 'Volt', ability: 'Discharge', name: 'Discharge',
    summary: 'Stunned enemies arc 600 Electricity every 0.5 s for 6 s, a lone target zaps itself after 4.5 s',
    scaling: [
      '"emit arcs of electricity, shocking hostiles who come within 8 meters to inflict 250 / 375 / 500 / 600 Electricity damage every 0.5 seconds" for the stun, 3 / 4 / 5 / 6 s (Ability Duration)',
      '"Affected targets that are not in range of other hostiles will begin to damage themselves after the first 4.5 seconds"',
      '"the Discharge damage, electric arc damage, and stun duration remain at 100%, linearly decreasing until all reach 50% of their respective values at the maximum range"',
      'Volt\'s passive only shortens the 4.5 s delay; not counted',
    ],
    params: [
      { id: 'company', label: 'Other shocked enemies nearby', default: 1, options: [{ value: 1, label: 'Yes (arcs from the start)' }, { value: 0, label: 'No (self-damage after 4.5 s)' }] },
      { id: 'distance', label: 'Distance from cast, % of range', default: 0, min: 0, max: 100, step: 10 },
    ],
    build: (ctx, p) => {
      const falloff = 1 - 0.5 * p.distance / 100
      const stun = 6 * ctx.duration * falloff
      const start = p.company ? 0 : 4.5
      return { events: ticks(stun - start, 0.5, start).map((t) => hit(t, 'Arc', 600 * ctx.strength * falloff, { electricity: 1 })), notes: stun <= start ? ['Stun ends before the 4.5 s self-damage starts: no damage'] : [] }
    },
  },
  {
    id: 'avalanche', warframe: 'Frost', ability: 'Avalanche', name: 'Avalanche',
    summary: 'Strips 60% armor, freezes with 16 Cold procs, then 1,500 Cold',
    scaling: [
      '"applying 10 Cold Status Effects to freeze enemies in place ... permanently reducing their total armor by 60%, then inflicts 800 / 1000 / 1200 / 1500 Cold damage"',
      '"Armor is fully removed at 167% Ability Strength"',
      '"If an enemy dies while frozen, they violently shatter upon death, dealing 100 / 200 / 300 / 400 Cold damage to enemies in a 3 / 3.5 / 4 / 4.5 meter radius" (not counted, it\'s on other enemies)',
    ],
    build: (ctx) => ({
      events: [hit(1, 'Avalanche', 1500 * ctx.strength, { cold: 1 }, { armorStripBefore: Math.min(1, 0.6 * ctx.strength), procs: { cold: 16 } })],
    }),
  },
  {
    id: 'inferno', warframe: 'Ember', ability: 'Inferno', name: 'Inferno',
    summary: '2,500 Impact/Heat meteor, then a fire ring of 350-700 Heat per second for 15 s',
    scaling: [
      '"enemies receive 1000 / 1500 / 2000 / 2500 damage distributed evenly between Impact and Heat, with a 100% Heat status chance"',
      '"surrounded by a ring of fire for 7 / 10 / 12 / 15 seconds ... dealing 200 - 400 / 350 - 500 / 300 - 600 / 350 - 700 Heat damage per second (based on Immolation heat level) with 10% Heat status chance per second"',
      '"the ring damage will not stack from multiple casts"',
    ],
    params: [{ id: 'heat', label: 'Immolation heat %', default: 100, min: 0, max: 100, step: 10 }],
    build: (ctx, p) => ({
      events: [
        hit(0, 'Meteor', 2500 * ctx.strength, { impact: 0.5, heat: 0.5 }, { procs: { heat: 1 } }),
        ...ticks(15 * ctx.duration, 1, 1).map((t) => hit(t, 'Fire ring', lerp(350, 700, p.heat / 100) * ctx.strength, { heat: 1 }, { procs: { heat: 0.1 } })),
      ],
    }),
  },
  {
    id: 'fire-blast', warframe: 'Ember', ability: 'Fire Blast', name: 'Fire Blast',
    summary: '200 Heat with a guaranteed proc, strips 50-100% armor',
    scaling: [
      '"dealt 66 / 100 / 141 / 200 Heat damage with a 100% status chance, have their Armor permanently reduced by 50% - 100%"',
      '"Armor reduction per cast is capped at 50% - 100%, achievable with 100% Ability Strength"',
      'Armor strip goes on after the hit here, so it helps everything that comes next',
    ],
    build: (ctx) => ({ events: [hit(0, 'Fire Blast', 200 * ctx.strength, { heat: 1 }, { procs: { heat: 1 } })] }),
  },
  {
    id: 'crush', warframe: 'Mag', ability: 'Crush', name: 'Crush',
    summary: '1,500 Magnetic over three ticks, x2 more and +1,500 base inside Magnetize',
    scaling: [
      '"inflicting 800 / 1000 / 1250 / 1500 Magnetic damage over three segments"',
      'Magnetize: "((Base Damage + Extra Damage) / 3) x (1 + Strength Mods) x Magnetize bonus damage x (1 + Strength Mods)", the wiki example is (1500 + 1500) / 3 x 1.3 x 2 x 1.3 a tick',
    ],
    params: [{ id: 'magnetize', label: 'Target in Magnetize', default: 0, options: [{ value: 0, label: 'No' }, { value: 1, label: 'Yes' }] }],
    build: (ctx, p) => {
      const total = p.magnetize ? 3000 * ctx.strength * 2 * ctx.strength : 1500 * ctx.strength
      return { events: [0, 0.5, 1].map((t, i) => hit(t, `Crush tick ${i + 1}`, total / 3, { magnetic: 1 })) }
    },
  },
  {
    id: 'soul-punch', warframe: 'Nekros', ability: 'Soul Punch', name: 'Soul Punch',
    summary: '500 Impact, kills outright at 25% health or less',
    scaling: [
      '"dealing 100 / 200 / 350 / 500 Impact damage and Knockback. If the target is at or below 25% health, it is instantly killed"',
      'The soul projectile (50 Impact, 200 on landing, "doubled for each enemy directly hit") isn\'t Strength-scaled on the wiki and hits other enemies, so it\'s left out',
      '"affected by Universal Weapon Bonuses such as Arcane Arachne and Nourish" (not counted)',
    ],
    build: (ctx) => ({ events: [hit(0, 'Soul Punch', 500 * ctx.strength, { impact: 1 })] }),
  },
  {
    id: 'final-stand', warframe: 'Styanax', ability: 'Final Stand', name: 'Final Stand',
    summary: '30 javelins at 20 a second, each 1,500 Slash + 1,500 Blast with a forced Slash proc',
    scaling: [
      '"hurl a volley of 30 Axios Javelins, thrown at a fire rate of 20 javelins per second" (count is Ability Duration)',
      '"Each javelin deals 1,000 / 1,100 / 1,300 / 1,500 Slash damage with 50% status chance ... then explodes on impact with a surface for 1,000 / 1,100 / 1,300 / 1,500 Blast damage with a forced Slash Status Effect"',
      '"Neither the direct hit nor AoE damage can crit"; Universal Weapon Bonuses apply (not counted)',
    ],
    build: (ctx) => {
      const count = Math.floor(30 * ctx.duration)
      return {
        events: ticks(count, 1).flatMap((i) => [
          hit(i / 20, 'Javelin', 1500 * ctx.strength, { slash: 1 }, { procs: { slash: 0.5 } }),
          hit(i / 20, 'Javelin explosion', 1500 * ctx.strength, { blast: 1 }, { procs: { slash: 1 } }),
        ]),
        notes: [`${count} javelins`],
      }
    },
  },
  {
    id: 'vial-rush', warframe: 'Lavos', ability: 'Vial Rush', name: 'Vial Rush',
    summary: 'Frozen pools of 250 Cold + 250 imbued element per second for 8 s, and an end explosion',
    scaling: [
      '"inflicts 100 / 150 / 200 / 250 Cold and 100 / 150 / 200 / 250 Imbued Elemental damage and status effects per second, to all enemies standing within the pools", each lasting "4 / 6 / 7 / 8 seconds"',
      '"Lavos emits an icy explosion ... that inflicts a single instance of the Cold and Imbued Elemental damage and status effects" ("100% damage falloff over its radius")',
    ],
    params: [
      { id: 'element', label: 'Imbued element', default: 2, options: [{ value: 0, label: 'None' }, { value: 1, label: 'Heat' }, { value: 2, label: 'Toxin' }, { value: 3, label: 'Electricity' }] },
      { id: 'pools', label: 'Pools under the target', default: 1, min: 1, max: 6 },
    ],
    build: (ctx, p) => {
      const element = ['', 'heat', 'toxin', 'electricity'][p.element]
      const tick = (t: number, label: string, count: number) => {
        const cold = hit(t, label, 250 * ctx.strength * count, { cold: 1 }, { procs: { cold: count } })
        return element ? [cold, hit(t, `${label} (${element})`, 250 * ctx.strength * count, { [element]: 1 }, { procs: { [element]: count } })] : [cold]
      }
      return { events: [...tick(1, 'End explosion', 1), ...ticks(8 * ctx.duration, 1).flatMap((t) => tick(t, 'Pool', p.pools))] }
    },
  },
  {
    id: 'radial-javelin', warframe: 'Excalibur', ability: 'Radial Javelin', name: 'Radial Javelin',
    summary: '1,000 Impact/Puncture/Slash per javelin with a forced Slash proc',
    scaling: [
      '"Each javelin inflicts 500 / 650 / 800 / 1000 damage evenly distributed between Impact, Puncture, and Slash, with 10% status chance, a forced Slash Status Effect"',
      '"benefit from Universal Weapon Bonuses such as Arcane Arachne" and can crit from "universal critical bonuses like Arcane Avenger" (not counted). Furious Javelin is a weapon buff, see the Warframe abilities above',
    ],
    build: (ctx) => ({ events: [hit(0, 'Javelin', 1000 * ctx.strength, { impact: 1 / 3, puncture: 1 / 3, slash: 1 / 3 }, { procs: { slash: 1 } })] }),
  },
  {
    id: 'antimatter-drop', warframe: 'Nova', ability: 'Antimatter Drop', name: 'Antimatter Drop',
    summary: '200 + 8x the damage it absorbed as Blast, capped at 25,000 absorbed',
    scaling: [
      '"inflict 10 Blast damage on contact, then explodes to inflict 100 / 125 / 150 / 200 base damage plus 2x / 4x / 6x / 8x all absorbed damage as Blast damage with 100% status chance" (both Strength)',
      '"The orb cannot absorb more than 25,000 damage", only "5 times", and "Extra damage from Critical and Status Effects are not absorbed"',
    ],
    params: [{ id: 'absorbed', label: 'Damage absorbed', default: 25000, min: 0, max: 25000, step: 1000 }],
    build: (ctx, p) => ({
      events: [hit(0, 'Contact', 10 * ctx.strength, { blast: 1 }), hit(0, 'Explosion', (200 + 8 * Math.min(25000, p.absorbed)) * ctx.strength, { blast: 1 }, { procs: { blast: 1 } })],
    }),
  },
  {
    id: 'sol-gate', warframe: 'Wisp', ability: 'Sol Gate', name: 'Sol Gate',
    summary: 'Beam alternating Heat and Radiation every 0.5 s, +100% per hit of each element up to +1000%',
    scaling: [
      '"inflicts 500 / 550 / 625 / 750 damage alternating between Heat and Radiation every half second with a 100% status chance"',
      '"beam damage increasing by 100% per hit of an element up to a maximum of 1000%, meaning it takes up to 10 seconds of sustained damage to each enemy to maximize"',
      '"Holding the fire button doubles the beam\'s base damage to 1,000 / 1,100 / 1,250 / 1,500 per hit"; drains 12 energy/s (24 boosted)',
    ],
    params: [{ id: 'boost', label: 'Holding fire (boosted)', default: 1, options: [{ value: 1, label: 'Yes' }, { value: 0, label: 'No' }] }],
    build: (ctx, p) => {
      const base = (p.boost ? 1500 : 750) * ctx.strength
      return {
        // 10 s of beam: long enough for both elements to hit their +1000% cap
        events: ticks(10.5, 0.5).map((t, i) => {
          const element = i % 2 === 0 ? 'heat' : 'radiation'
          const nth = Math.floor(i / 2) // earlier hits of this element on this enemy
          return hit(t, `Beam (${element})`, base * (1 + Math.min(nth, 10)), { [element]: 1 }, { procs: { [element]: 1 } })
        }),
      }
    },
  },
  {
    id: 'blaze-artillery', warframe: 'Protea', ability: 'Blaze Artillery', name: 'Blaze Artillery',
    summary: 'Turrets firing 500 Heat 3 times a second for 3 s, +100% per enemy hit so far',
    scaling: [
      '"inflict 100 / 150 / 200 / 500 Heat damage with a 100% status chance", "a fire rate of 3 shots per second", hovering "3 seconds" (Ability Duration), "up to 3 plasma turrets at once"',
      '"Blaze Artillery\'s overall damage increases by 100% for each successful hit against all enemies caught in a plasma stream, stacking for subsequent attacks"',
    ],
    params: [
      { id: 'turrets', label: 'Turrets on the target', default: 3, min: 1, max: 3 },
      { id: 'enemies', label: 'Enemies hit per shot', default: 1, min: 1, max: 20 },
    ],
    build: (ctx, p) => ({
      events: ticks(p.turrets, 1).flatMap((turret) => ticks(3 * ctx.duration, 1 / 3).map((t, shot) =>
        hit(t, `Turret ${turret + 1}`, 500 * ctx.strength * (1 + shot * p.enemies), { heat: 1 }, { procs: { heat: 1 } }))),
    }),
  },
  {
    id: 'virulence', warframe: 'Nidus', ability: 'Virulence', name: 'Virulence',
    summary: '200 Puncture plus 100 Viral per second for 5 s, both x(1 + Mutation stacks)',
    scaling: [
      '"dealt 150 / 160 / 175 / 200 Puncture damage, amplified by the number of Mutation stacks", then "75 / 80 / 87.5 / 100 Viral Damage per second" for "5 seconds" (Ability Duration)',
      '"Amplified Damage = Base Damage x (1 + Ability Strength rank bonus + Ability Strength) x (1 + Number of Stacks)", snapshot at cast',
    ],
    params: [{ id: 'stacks', label: 'Mutation stacks', default: 100, min: 0, max: 100 }],
    build: (ctx, p) => {
      const amp = ctx.strength * (1 + p.stacks)
      return { events: [hit(0, 'Fungal growth', 200 * amp, { puncture: 1 }), ...ticks(5 * ctx.duration, 1, 1).map((t) => hit(t, 'Lingering growth', 100 * amp, { viral: 1 }))] }
    },
  },
  {
    id: 'coil-horizon', warframe: 'Gyre', ability: 'Coil Horizon', name: 'Coil Horizon',
    summary: 'Sphere touching for 1,500 Electricity per second, then a 1,250 Electricity implosion',
    scaling: [
      '"Direct contact inflicts Knockdown and 1,000 / 1,150 / 1,300 / 1,500 Electricity damage per second with 100% Status Chance" over its "2 second lifetime"',
      '"Enemies in sight detection range are dealt 500 / 750 / 1,000 / 1,250 Electricity damage with a guaranteed status effect", "diminishes with distance from the center"',
    ],
    params: [{ id: 'contact', label: 'Seconds in contact', default: 1, min: 0, max: 2 }],
    build: (ctx, p) => ({
      events: [
        ...ticks(p.contact, 1).map((t) => hit(t, 'Sphere contact', 1500 * ctx.strength, { electricity: 1 }, { procs: { electricity: 1 } })),
        hit(2, 'Implosion', 1250 * ctx.strength, { electricity: 1 }, { procs: { electricity: 1 } }),
      ],
    }),
  },
]

export const abilityDamageFor = (warframe: string, ability: string) => ABILITY_DAMAGE.filter((def) => def.warframe === warframe && def.ability === ability)
export const defaultParams = (def: AbilityDamageDef) => Object.fromEntries((def.params ?? []).map((param) => [param.id, param.default]))
