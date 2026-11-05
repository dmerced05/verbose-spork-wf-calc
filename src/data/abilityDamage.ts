// damaging Warframe abilities, max rank, every number and quote from the ability's own wiki page (Nov 2026). each one
// builds a timeline of hits (src/calc/abilityDamage.ts runs it against the target). raw damage = base x Ability Strength
// unless the page leaves Strength off a number (Soul Punch's soul projectile)
// scaling = the tooltip: how the ability grows, in the wiki's words
import type { AbilityContext, AbilityRun, DamageEvent, UwbTakes } from '../calc/abilityDamage'

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
  subsumed?: string // needs this ability subsumed onto the frame (Inaros with Jade Stars)
  summary: string
  scaling: string[]
  params?: AbilityParam[]
  build: (ctx: AbilityContext, p: Record<string, number>) => AbilityRun
}

// Elemental Sandstorm takes the melee weapon's damage types (physical ones included). common level cap melee setups
const MELEE_TYPE_SETS: string[][] = [
  ['impact', 'puncture', 'slash', 'viral', 'heat'],
  ['impact', 'puncture', 'slash', 'viral', 'corrosive'],
  ['viral', 'corrosive'],
  ['viral', 'heat'],
  ['corrosive', 'heat'],
  ['impact', 'puncture', 'slash', 'viral', 'corrosive', 'heat'],
]
const MELEE_TYPE_OPTIONS = MELEE_TYPE_SETS.map((set, value) => ({ value, label: set.join(' + ') }))
const lerp = (low: number, high: number, fraction: number) => low + (high - low) * Math.min(1, Math.max(0, fraction))
// a damage tick every `every` seconds over `seconds`, starting at `start`
const ticks = (seconds: number, every: number, start = 0) => Array.from({ length: Math.max(0, Math.floor(seconds / every + 1e-9)) }, (_, i) => start + i * every)
// Universal Weapon Bonuses each ability takes (wiki Universal_Weapon_Bonuses list and the ability's page)
const WEAPON_LIKE: UwbTakes = { base: true, elemental: true, multiplier: true, crit: true }
const NO_CRIT: UwbTakes = { base: true, elemental: true, multiplier: true } // Final Stand: "Neither the direct hit nor AoE damage can crit"
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
      { id: 'casts', label: 'Heat casts (1 s apart)', default: 5, min: 1, max: 15, title: 'Each Heat cast adds the Heat DoT already ticking, then Redline doubles it: the damage roughly doubles every cast' },
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
      return { events: ticks(p.passes, 1).map((t) => hit(t * 0.5, 'Reave pass', per, {}, { trueDamage: true, skipShields: false })), notes: pool ? [] : ['Pick an enemy and level in the Target panel: Reave is % of its health'] }
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
    build: (ctx) => ({
      events: [hit(0, 'Smite', 500 * ctx.strength, { radiation: 1 }, {
        percentCurrent: { fraction: Math.min(0.75, 0.35 * ctx.strength), of: 'healthAndShields' }, armorStripBefore: 1, procs: { radiation: 10 },
      })],
      notes: ctx.target.health ? [`${Math.round(Math.min(0.75, 0.35 * ctx.strength) * 100)}% of current health and shields (cap 75%)`] : ['Pick an enemy and level for the % of health part'],
    }),
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
      return { events: ticks(onTarget, 1).map((i) => hit(i * 0.1, 'Talon', 300 * ctx.strength, { slash: 1 }, { procs: { slash: 1 }, uwb: WEAPON_LIKE })), notes: [`${onTarget} talons on this target`] }
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
      'Fracturing Crush only strips survivors\' armor afterwards ("Armor reduction is affected by Ability Strength, fully removing armor at 134%"), Crush\'s own hit is unchanged',
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
    build: (ctx) => ({ events: [hit(0, 'Soul Punch', 500 * ctx.strength, { impact: 1 }, { uwb: NO_CRIT })] }),
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
          hit(i / 20, 'Javelin', 1500 * ctx.strength, { slash: 1 }, { procs: { slash: 0.5 }, uwb: NO_CRIT }),
          hit(i / 20, 'Javelin explosion', 1500 * ctx.strength, { blast: 1 }, { procs: { slash: 1 }, uwb: NO_CRIT }),
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
    build: (ctx) => ({ events: [hit(0, 'Javelin', 1000 * ctx.strength, { impact: 1 / 3, puncture: 1 / 3, slash: 1 / 3 }, { procs: { slash: 1 }, uwb: WEAPON_LIKE })] }),
  },
  {
    id: 'antimatter-drop', warframe: 'Nova', ability: 'Antimatter Drop', name: 'Antimatter Drop',
    summary: '200 + 8x the damage it absorbed as Blast, capped at 25,000 absorbed',
    scaling: [
      '"inflict 10 Blast damage on contact, then explodes to inflict 100 / 125 / 150 / 200 base damage plus 2x / 4x / 6x / 8x all absorbed damage as Blast damage with 100% status chance" (both Strength)',
      '"The orb cannot absorb more than 25,000 damage", only "5 times", and "Extra damage from Critical and Status Effects are not absorbed"',
      'Antimatter Absorb lets it "absorb incoming enemy gunfire" too: same cap, it just fills faster',
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
      'Stack cap: Abundant Mutation "Nidus gains an additional 300 max stacks of Mutation", and Parasitic Vitality\'s page says it "increases Mutation stacks up to 500", so 200 without it, 500 with it',
    ],
    params: [{ id: 'stacks', label: 'Mutation stacks', default: 200, min: 0, max: 500, title: '200 max, 500 with Abundant Mutation' }],
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
  // ---- augments that change the damage ----
  {
    id: 'hallowed-reckoning', warframe: 'Oberon', ability: 'Reckoning', name: 'Reckoning (Hallowed Reckoning)', augment: 'Hallowed Reckoning',
    summary: 'Reckoning, plus Radiation patches under each enemy: 300 per second + 50 per Radiation proc, a forced proc each tick',
    scaling: [
      'Reckoning: "7,500 Radiation damage, plus an additional 750 damage per Radiation Status Effect" after "reducing their Armor by 60%"',
      'Hallowed Reckoning: "The zones deal 300 Radiation damage per second, increased by 50 per radiation stack on the damaged enemy", "1 forced Radiation proc per hit", lasting 10 s (Ability Duration)',
      '"The zones deal a flat 50 extra damage per radiation stack, despite the UI showing it as 30 scaling with ability strength (bug)"',
    ],
    params: [
      { id: 'radiation', label: 'Radiation procs on the target', default: 10, min: 0, max: 10 },
      { id: 'zone', label: 'Seconds standing in the patch', default: 10, min: 0, max: 30 },
    ],
    build: (ctx, p) => {
      let stacks = Math.min(10, p.radiation + 1) // Reckoning's own proc
      const zone = ticks(Math.min(p.zone, 10 * ctx.duration), 1, 1).map((t) => {
        const event = hit(t, 'Hallowed patch', 300 * ctx.strength + 50 * stacks, { radiation: 1 }, { procs: { radiation: 1 } })
        stacks = Math.min(10, stacks + 1)
        return event
      })
      return { events: [hit(0, 'Reckoning', (7500 + 750 * p.radiation) * ctx.strength, { radiation: 1 }, { armorStripBefore: Math.min(1, 0.6 * ctx.strength), procs: { radiation: 1 } }), ...zone] }
    },
  },
  {
    id: 'cataclysmic-gate', warframe: 'Wisp', ability: 'Sol Gate', name: 'Sol Gate (Cataclysmic Gate)', augment: 'Cataclysmic Gate',
    summary: 'A 5,000 Heat explosion, then a sun portal dealing 500 Impact/Puncture/Slash every 0.5 s with forced Heat and Radiation',
    scaling: [
      '"explodes for 5000 radial Heat damage in a 10m, creating a spherical sun portal", "Sun portal inflicts 500 damage per half second, evenly split between Impact, Puncture, and Slash ... with guaranteed status effects of Heat and Radiation per tick"',
      'Portal lasts 10 s (Ability Duration), "Max 3 sun portals can be active". The up-to-1 s beam phase before it has no numbers on the wiki, left out',
      '"The Vitality and Shock Motes each grant a 25% total damage bonus to the sun portal damage" (not counted)',
    ],
    build: (ctx) => ({
      events: [
        hit(1, 'Explosion', 5000 * ctx.strength, { heat: 1 }),
        ...ticks(10 * ctx.duration, 0.5, 1).map((t) => hit(t, 'Sun portal', 500 * ctx.strength, { impact: 1 / 3, puncture: 1 / 3, slash: 1 / 3 }, { procs: { heat: 1, radiation: 1 } })),
      ],
    }),
  },
  {
    id: 'coil-recharge', warframe: 'Gyre', ability: 'Coil Horizon', name: 'Coil Horizon (Coil Recharge)', augment: 'Coil Recharge',
    summary: 'The sphere stays out 20 s discharging 500 Electricity every 4 s, then implodes',
    scaling: [
      'Coil Recharge: "500 Electricity Damage", "Has a duration of 20 seconds, after which it will detonate", "Discharges every 4 seconds"',
      '"Every 25 meters traveled, the sphere will discharge to an additional enemy and reduce the discharge timer by 0.5 seconds down to a minimum of 0.25 seconds", so a sphere you keep flinging hits faster than this stationary one',
      'Implosion: "500 / 750 / 1,000 / 1,250 Electricity damage with a guaranteed status effect"',
    ],
    params: [{ id: 'interval', label: 'Seconds between discharges', default: 4, min: 0.25, max: 4, step: 0.25, title: '4 s standing still, 0.5 s faster per 25 m traveled, 0.25 s at 225 m' }],
    build: (ctx, p) => ({
      events: [
        ...ticks(20 * ctx.duration, p.interval, p.interval).map((t) => hit(t, 'Discharge', 500 * ctx.strength, { electricity: 1 })),
        hit(20 * ctx.duration, 'Implosion', 1250 * ctx.strength, { electricity: 1 }, { procs: { electricity: 1 } }),
      ],
    }),
  },

  // ---- Sevagoth ----
  {
    id: 'sow', warframe: 'Sevagoth', ability: 'Sow', name: 'Sow',
    summary: '250 True damage per second for 10 s on every seeded enemy',
    scaling: [
      '"Seeded enemies decay toward death taking 100 / 150 / 200 / 250 True damage per second over 5 / 8 / 11 / 10 seconds" (Strength / Duration)',
      '"True damage ignores armor and shields, dealing damage directly to health", "DoT Has Damage Falloff starting from half range to a maximum of 25% at max range"',
      'The real damage is Reap on a Sown enemy, see Sow + Reap',
    ],
    build: (ctx) => ({ events: ticks(10 * ctx.duration, 1, 1).map((t) => hit(t, 'Sow decay', 250 * ctx.strength, {}, { trueDamage: true })) }),
  },
  {
    id: 'reap', warframe: 'Sevagoth', ability: 'Reap', name: 'Reap',
    summary: '250 Radiation and 50% Damage Vulnerability for 10 s from the Shadow\'s wail',
    scaling: [
      '"dealing 100 / 150 / 200 / 250 Radiation damage and inflicting 10% / 20% / 30% / 50% Damage Vulnerability debuff that lasts for 5 / 7 / 10 / 10 seconds" (Strength / Duration)',
      '"The damage vulnerability\'s duration and strength cannot be refreshed by extra Reap casts", "The damage and debuff only apply to each individual enemy once per instance of Reap"',
    ],
    build: (ctx) => ({ events: [hit(0.5, 'Reap wail', 250 * ctx.strength, { radiation: 1 }, { vulnerability: 0.5 * ctx.strength })], notes: [`${Math.round(50 * ctx.strength)}% Damage Vulnerability`] }),
  },
  {
    id: 'sow-reap', warframe: 'Sevagoth', ability: 'Sow', name: 'Sow + Reap (combo)',
    summary: 'Reap on a Sown enemy: 25% of its current health as True damage, boosted by Reap\'s own vulnerability, Viral and Roar. A % of HP nuke',
    scaling: [
      'Reap page: "Sow enemies hit by Reap will detonate ... 1) Enemies are dealt 25% of their current health as True damage. 2) Enemies are dealt Reap\'s 250 Radiation damage. 3) Reap\'s Damage Vulnerability is applied onto the enemies. 4) Enemies detonate and deal 25% of their current health ... to other enemies in a 4 meter radius as Blast damage"',
      '"neither the True nor Blast damage scale with Ability Strength, both can be boosted by damage amplification sources", and "can be combined with Reap\'s damage vulnerability and another damage multiplier (such as Viral statuses, Roar and/or Archon Shards\' ability damage bonus), to achieve a full 100% True damage drain"',
      '"since Reap\'s damage vulnerability is applied after the True damage, a second Reap cast is often needed", so it hits the same share of HP on any enemy: a Lancer and a Babau die the same way',
      'Sow\'s 250 True per second ticks underneath, also boosted by the vulnerability',
    ],
    params: [{ id: 'reaps', label: 'Reap casts (1 s apart)', default: 2, min: 1, max: 4 }],
    build: (ctx, p) => ({
      events: [
        ...ticks(10 * ctx.duration, 1, 1).map((t) => hit(t, 'Sow decay', 250 * ctx.strength, {}, { trueDamage: true })),
        ...ticks(p.reaps, 1).flatMap((n) => [
          hit(0.5 + n, `Reap ${n + 1}: 25% current health`, 0, {}, { trueDamage: true, percentCurrent: { fraction: 0.25, of: 'health' } }),
          hit(0.51 + n, `Reap ${n + 1}: wail`, 250 * ctx.strength, { radiation: 1 }, { vulnerability: 0.5 * ctx.strength }),
        ]),
      ],
      notes: [`Reap ${p.reaps > 1 ? '2+' : '1'} drains 25% x ${(1 + 0.5 * ctx.strength).toFixed(2)} (vulnerability)${ctx.roar ? ` x ${(1 + ctx.roar).toFixed(2)} (Roar)` : ''} of current health`],
    }),
  },

  // ---- Mirage ----
  {
    id: 'sleight-of-hand', warframe: 'Mirage', ability: 'Sleight of Hand', name: 'Sleight of Hand',
    summary: 'A jewel that explodes for 200 Blast in light',
    scaling: [
      '"if placed in light, the jewel explodes to deal 50 / 125 / 180 / 200 Blast damage", "Explosion damage diminishes with distance from the jewel and cannot proc Status Effects"',
    ],
    build: (ctx) => ({ events: [hit(0, 'Jewel', 200 * ctx.strength, { blast: 1 })] }),
  },
  {
    id: 'explosive-legerdemain', warframe: 'Mirage', ability: 'Sleight of Hand', name: 'Sleight of Hand (Explosive Legerdemain)', augment: 'Explosive Legerdemain',
    summary: 'Pickups become proximity mines: 1,000 Cold / Toxin / Electricity / Heat each with 100% status',
    scaling: [
      'Explosive Legerdemain: "Ammo and Orbs pickups are turned into proximity mines that deal 1000 Damage with a 100% Status Chance", "Converts Ammo Pickups, Affinity Orbs, Energy Orbs, and Health Orbs into proximity mines that deal Cold, Toxin, Electricity, and Heat damage respectively"',
      '"Damage is affected by Ability Strength, whereas status chance is not", "Explosion has 100% damage falloff over its radius" (counted at the center), 60 s fuse',
      'Hall of Mirrors repeats the cast, so stacking mines on one spot multiplies this. Archon set mods trigger off the four elements',
    ],
    params: [{ id: 'mines', label: 'Mines under the target', default: 4, min: 1, max: 40, title: 'Cycles Cold, Toxin, Electricity, Heat' }],
    build: (ctx, p) => ({
      events: ticks(p.mines, 1).map((n) => {
        const element = ['cold', 'toxin', 'electricity', 'heat'][n % 4]
        return hit(0.01 * n, `Mine (${element})`, 1000 * ctx.strength, { [element]: 1 }, { procs: { [element]: 1 } })
      }),
    }),
  },

  // ---- Sirius & Orion ----
  {
    id: 'jade-stars', warframe: 'Sirius & Orion', ability: 'Jade Stars', name: 'Jade Stars',
    summary: '7 Jade Light motes launched at whatever you hit: 500 Heat each in 4 m with 100% (Strength) status, one mote back every 0.2 s',
    scaling: [
      '"attack an enemy to launch a mote toward them, inflicting 350 / 400 / 450 / 500 Heat damage with 100% Status Chance in a 4 meter radius. Once launched, motes shuffle ... and replenish one every 0.2 seconds", for "20 / 25 / 30 / 35 seconds" (Ability Duration)',
      'Status chance is Strength ("Ability Strength 100% Status Chance"), so past 100% a mote can put on more than one Heat proc',
      'Universal Weapon Bonuses: "Not affected by base damage bonuses like Arcane Arachne and Vigorous Swap, or damage multipliers like Eclipse", "Are affected by certain elemental damage bonuses, such as Nourish and Valence Formation", "Base 0% critical chance can be increased by using flat bonuses, such as Arcane Avenger"',
      '"Abilities that rapidly deal damage ticks ... will cause a mote to launch every time it deals damage to a target", "Motes will not be launched by most status effect damage", "Motes will not be launched when an attack is fatal"',
      'Archon Vitality: "Status Effects from abilities that deal Heat Damage will be applied twice"',
    ],
    params: [
      { id: 'rate', label: 'Motes per second on the target', default: 5, min: 1, max: 5, step: 0.5, title: '5/s is the replenish limit (one every 0.2 s), plus the 7 stored ones at the start' },
      { id: 'vitality', label: 'Archon Vitality', default: 0, options: [{ value: 0, label: 'No' }, { value: 1, label: 'Yes (Heat procs twice)' }] },
    ],
    build: (ctx, p) => {
      const procs = Math.max(0, ctx.strength) * (p.vitality ? 2 : 1)
      const starts = ticks(7, 1).map((i) => 0.05 * i) // the 7 stored motes go out at once
      const later = ticks(10 - 0.35, 1 / p.rate, 0.35)
      return { events: [...starts, ...later].map((t) => hit(t, 'Mote', 500 * ctx.strength, { heat: 1 }, { procs: { heat: procs }, uwb: { elemental: true, crit: true } })) }
    },
  },

  // ---- Inaros ----
  {
    id: 'sandstorm', warframe: 'Inaros', ability: 'Sandstorm', name: 'Sandstorm',
    summary: 'Pulls enemies into the storm for 4 s: 125 Slash per second, as 25% every 0.25 s',
    scaling: [
      '"dealing 50 / 75 / 100 / 125 Slash damage with a ~15% status chance every 0.25 seconds for 4s" (Strength / Duration)',
      'Bugs: "The arsenal shows damage/second stats even though Sandstorm deals 25% of the listed damage every 0.25s"',
    ],
    params: [{ id: 'seconds', label: 'Seconds of storm (recasting)', default: 10, min: 1, max: 30 }],
    build: (ctx, p) => ({ events: ticks(p.seconds, 0.25).map((t) => hit(t, 'Storm tick', 0.25 * 125 * ctx.strength, { slash: 1 }, { procs: { slash: 0.15 } })) }),
  },
  {
    id: 'elemental-sandstorm', warframe: 'Inaros', ability: 'Sandstorm', name: 'Sandstorm (Elemental Sandstorm)', augment: 'Elemental Sandstorm',
    summary: 'Every storm tick forces 1 status proc per 100% (Strength) of a damage type from your melee weapon',
    scaling: [
      'Elemental Sandstorm: "causes Sandstorm to inflict Status procs based on equipped Damage Types on melee weapons currently wielded", "100%" status chance at max rank, "affected by Ability Strength"',
      '"Sandstorm will pick one of the damage types and inflict 1 status proc of the chosen type for every 100% Status Chance", "Can only choose and proc 1 damage type on hit ... Eventually procs of all types will be inflicted with enough triggers" (spread evenly here)',
      '"The augment does not work on any enemy which can\'t be lifted by Sandstorm"',
      'Sandstorm: "deals 25% of the listed damage every 0.25s"',
    ],
    params: [
      { id: 'seconds', label: 'Seconds of storm (recasting)', default: 10, min: 1, max: 30 },
      { id: 'types', label: 'Melee damage types', default: 1, options: MELEE_TYPE_OPTIONS },
    ],
    build: (ctx, p) => {
      const types = MELEE_TYPE_SETS[p.types]
      const procsEach = ctx.strength / types.length // 1 proc per 100% chance, one type a tick, evenly over time
      return {
        events: ticks(p.seconds, 0.25).map((t) => hit(t, 'Storm tick', 0.25 * 125 * ctx.strength, { slash: 1 }, { procs: Object.fromEntries(types.map((type) => [type, procsEach])) })),
        notes: [`${ctx.strength.toFixed(2)} procs a tick, spread over ${types.join(' / ')}`],
      }
    },
  },
  {
    id: 'sandstorm-jade-stars', warframe: 'Inaros', ability: 'Sandstorm', name: 'Elemental Sandstorm + Jade Stars', augment: 'Elemental Sandstorm', subsumed: 'Jade Stars',
    summary: 'Each storm tick launches a Jade Stars mote (500 Heat, Strength x 100% Heat status) while Elemental Sandstorm stacks your melee\'s status: a status/armor-strip engine for level cap',
    scaling: [
      'Jade Stars: "Abilities that rapidly deal damage ticks, like Xaku\'s Grasp of Lohk, will cause a mote to launch every time it deals damage to a target", "replenish one every 0.2 seconds" (so 4 storm ticks a second all launch)',
      'Elemental Sandstorm: "1 status proc of the chosen type for every 100% Status Chance" per tick, from the melee weapon\'s damage types',
      'At level cap the damage numbers are small, what carries is the target state: 10 Viral (x4.25 health damage), 10 Corrosive and Heat\'s armor strip for everything else on the squad. The Data Analysis notes show it',
      'Motes take elemental Universal Weapon Bonuses (Valence Formation Heat x3 including its DoT, Nourish) and flat crit (Arcane Avenger), not Arachne or Eclipse',
      'Archon Vitality on Inaros doubles the motes\' Heat procs ("Status Effects from abilities that deal Heat Damage will be applied twice")',
    ],
    params: [
      { id: 'seconds', label: 'Seconds of storm (recasting)', default: 10, min: 1, max: 30 },
      { id: 'types', label: 'Melee damage types', default: 1, options: MELEE_TYPE_OPTIONS },
      { id: 'vitality', label: 'Archon Vitality', default: 1, options: [{ value: 1, label: 'Yes (Heat procs twice)' }, { value: 0, label: 'No' }] },
    ],
    build: (ctx, p) => {
      const types = MELEE_TYPE_SETS[p.types]
      const procsEach = ctx.strength / types.length
      const heatProcs = ctx.strength * (p.vitality ? 2 : 1)
      const storm = ticks(p.seconds, 0.25).flatMap((t) => [
        hit(t, 'Storm tick', 0.25 * 125 * ctx.strength, { slash: 1 }, { procs: Object.fromEntries(types.map((type) => [type, procsEach])) }),
        hit(t + 0.05, 'Jade Stars mote', 500 * ctx.strength, { heat: 1 }, { procs: { heat: heatProcs }, uwb: { elemental: true, crit: true } }),
      ])
      return { events: storm, notes: [`${ctx.strength.toFixed(2)} melee-type procs + ${heatProcs.toFixed(2)} Heat procs per 0.25 s tick`] }
    },
  },

  // ---- Uriel ----
  {
    id: 'brimstone', warframe: 'Uriel', ability: 'Brimstone', name: 'Brimstone',
    summary: 'Up to 4 overlapping fields, 750 Heat every 0.25 s each, ramping +100% per field every 0.5 s up to 10x',
    scaling: [
      '"Brimstone initially inflicts 600 / 650 / 700 / 750 Heat damage with 100% Status Chance once every 0.25 seconds; every 0.5 seconds, the field\'s damage increases by 100% for each active field, up to a 10x damage multiplier cap"',
      '"Each of Uriel\'s active demons will also cast their own field with identical stats and behavior to Uriel\'s, resulting in up to 4 overlapping fields", lasting 7 / 8 / 9 / 10 s (Ability Duration)',
      'Needs a full Demons\' Fury gauge to cast',
    ],
    params: [{ id: 'fields', label: 'Fields on the target (Uriel + demons)', default: 4, min: 1, max: 4 }],
    build: (ctx, p) => ({
      events: ticks(p.fields, 1).flatMap((field) => ticks(10 * ctx.duration, 0.25).map((t) =>
        hit(t, `Field ${field + 1}`, 750 * ctx.strength * Math.min(10, 1 + p.fields * Math.floor(t / 0.5)), { heat: 1 }, { procs: { heat: 1 } }))),
    }),
  },
  {
    id: 'demonium', warframe: 'Uriel', ability: 'Demonium', name: 'Demonium',
    summary: 'One soul per demon, each exploding for 250 Heat and leaving 50% Damage Vulnerability until death',
    scaling: [
      '"exploding on contact with each enemy ... dealing 100 / 150 / 200 / 250 Heat damage and applying 35% / 40% / 45% / 50% Damage Vulnerability to all enemies hit by the explosion, lasting indefinitely until death" (both Strength)',
      '"hurling 1 soul per demon", "Each soul can directly hit up to 5 targets"',
      'The vulnerability shows up in every other ability card only if you put it in the Debuffs panel; here it boosts the souls after the first',
    ],
    params: [{ id: 'demons', label: 'Living demons', default: 3, min: 1, max: 3 }],
    build: (ctx, p) => ({
      events: ticks(p.demons, 1).map((i) => hit(0.5 + 0.1 * i, 'Soul explosion', 250 * ctx.strength, { heat: 1 }, { vulnerability: 0.5 * ctx.strength })),
      notes: [`${Math.round(50 * ctx.strength)}% Damage Vulnerability after the first soul`],
    }),
  },
  {
    id: 'infernalis', warframe: 'Uriel', ability: 'Infernalis', name: 'Infernalis',
    summary: '1,500 Heat on cast, then a 250 Heat per second aura with 100% status for 35 s',
    scaling: [
      '"inflicting 1,500 Heat damage on cast and then 100 / 150 / 200 / 250 Heat damage with 100% Status Chance per second to enemies within 1.25 / 1.5 / 1.75 / 2 meters" for "20 / 25 / 30 / 35 seconds" (Ability Duration)',
    ],
    params: [{ id: 'contact', label: 'Seconds the target is in the aura', default: 10, min: 0, max: 60 }],
    build: (ctx, p) => ({
      events: [
        hit(0, 'Ignition', 1500 * ctx.strength, { heat: 1 }),
        ...ticks(Math.min(p.contact, 35 * ctx.duration), 1, 1).map((t) => hit(t, 'Aura', 250 * ctx.strength, { heat: 1 }, { procs: { heat: 1 } })),
      ],
    }),
  },
  {
    id: 'infernum', warframe: 'Uriel', ability: 'Infernalis', name: 'Infernalis (Infernum)', augment: 'Infernum',
    summary: 'Flying shoots 4 homing fireballs a second (12 after a Demonium rune), each 1,500 Heat + 1,500 Heat AoE with a forced Heat proc',
    scaling: [
      'Infernum: "While flying with Infernalis, Uriel releases 4 fireballs per second which home onto targets ... Fireballs deal 1500 Heat direct hit damage, plus an additional 1500 Heat AoE damage in a 5 meter radius with a forced Heat proc" (Strength)',
      '"Picking up a rune from Demonium will increase Uriel\'s output to 12 fireballs per second for 5 seconds" (Ability Duration)',
      '"Fireballs have 0% critical chance", Universal Weapon Bonuses apply (not counted). The AoE has "100% damage falloff", counted at full here (a direct hit lands at the center)',
    ],
    params: [
      { id: 'flight', label: 'Seconds flying', default: 10, min: 1, max: 35 },
      { id: 'rune', label: 'Demonium rune picked up', default: 1, options: [{ value: 1, label: 'Yes (12/s at the start)' }, { value: 0, label: 'No' }] },
    ],
    build: (ctx, p) => {
      const boosted = p.rune ? Math.min(p.flight, 5 * ctx.duration) : 0
      const times = [...ticks(boosted, 1 / 12), ...ticks(p.flight - boosted, 1 / 4, boosted)]
      return {
        events: [
          hit(0, 'Ignition', 1500 * ctx.strength, { heat: 1 }),
          ...times.flatMap((t) => [hit(t, 'Fireball', 1500 * ctx.strength, { heat: 1 }, { uwb: WEAPON_LIKE }), hit(t, 'Fireball AoE', 1500 * ctx.strength, { heat: 1 }, { procs: { heat: 1 }, uwb: WEAPON_LIKE })]),
        ],
        notes: [`${times.length} fireballs`],
      }
    },
  },

  // ---- Jade ----
  {
    id: 'lights-judgment', warframe: 'Jade', ability: "Light's Judgment", name: "Light's Judgment",
    summary: 'Wells burning 500 Heat every 0.5 s for 10 s, up to 5 wells, enemies take +50% damage (Judgment)',
    scaling: [
      '"The well burns enemies in direct Line of Sight for 200 / 300 / 400 / 500 Heat damage per half second", lasting "4 / 6 / 8 / 10 seconds" (Ability Duration)',
      '"A maximum of 5 wells can be created", "Enemies in the radius of multiple wells will receive damage from every well"',
      'Jade\'s Judgment page: "Light\'s Judgment\'s inherent 50% damage vulnerability", counted here on the target from the first tick on',
    ],
    params: [{ id: 'wells', label: 'Wells on the target', default: 1, min: 1, max: 5 }],
    build: (ctx, p) => ({
      events: ticks(p.wells, 1).flatMap((well) => ticks(10 * ctx.duration, 0.5).map((t) => hit(t, `Well ${well + 1}`, 500 * ctx.strength, { heat: 1 }, { vulnerability: 0.5 }))),
    }),
  },
  {
    id: 'jades-judgment', warframe: 'Jade', ability: "Light's Judgment", name: "Light's Judgment (Jade's Judgment)", augment: "Jade's Judgment",
    summary: 'Wells, plus Jade Light beams: 100 Heat that doubles every hit, a Heat proc each tick',
    scaling: [
      '"Every half second tick of damage from each Light\'s Judgment Well has a 5% chance to spawn a Jade Light beam, which lasts for 3 seconds" (chance: Strength, length: Ability Duration), "A maximum of 8 beams"',
      '"The beam deals 100 Heat damage every half second", "Damage is not affected by Ability Strength", "Base damage is effectively 150 due to Light\'s Judgment\'s inherent 50% damage vulnerability"',
      '"Total beam damage doubles after every hit", "Every tick of damage has a 100% heat status chance ... The damage of each new heat proc scales with the beam\'s current damage"',
      '"An extra 16.67% duration is needed for each additional tick", and "100% ability duration will give ... 6" ticks, 101% gives 7 (the first tick is instant)',
    ],
    params: [
      { id: 'wells', label: 'Wells on the target', default: 1, min: 1, max: 5 },
      { id: 'beams', label: 'Jade Light beams on the target', default: 1, min: 0, max: 8, title: 'Random: each well tick has 5% x Strength to spawn one' },
    ],
    build: (ctx, p) => {
      const wellTicks = ticks(10 * ctx.duration, 0.5)
      const wells = ticks(p.wells, 1).flatMap((well) => wellTicks.map((t) => hit(t, `Well ${well + 1}`, 500 * ctx.strength, { heat: 1 }, { vulnerability: 0.5 })))
      const beamTicks = Math.floor(6 * ctx.duration - 1e-9) + 1
      const beams = ticks(p.beams, 1).flatMap((beam) => ticks(beamTicks, 1).map((k) =>
        hit(0.5 + 0.5 * k + 0.01 * beam, `Jade Light ${beam + 1}`, 100 * 2 ** k, { heat: 1 }, { procs: { heat: 1 } })))
      const chance = Math.min(1, 0.05 * ctx.strength)
      return {
        events: [...wells, ...beams],
        notes: [`${beamTicks} beam ticks, last one ${Math.round(100 * 2 ** (beamTicks - 1)).toLocaleString()} before the 50%`, `${Math.round(chance * 100)}% beam chance per well tick, ~${(chance * wellTicks.length * p.wells).toFixed(1)} beams per cast`],
      }
    },
  },
  {
    id: 'ophanim-eyes', warframe: 'Jade', ability: 'Ophanim Eyes', name: 'Ophanim Eyes',
    summary: '50 Heat every 0.5 s for 30 s while stripping 10% armor and shields a second, Heat proc once they\'re gone',
    scaling: [
      '"Gazing upon enemies inflicts 20 / 30 / 40 / 50 Heat damage every 0.5 seconds ... and permanently lose 4% / 6% / 8% / 10% of their Armor and Shields per second. Once defenses have been removed, the enemy receives a Heat Status Effect", for "15 / 20 / 25 / 30 seconds" (Ability Duration)',
      '"Ophanim Eyes hits every 0.5 seconds, with the slow and defense strip applying for half of their value every hit"',
    ],
    build: (ctx) => {
      let left = 1
      let heatDone = false
      return {
        events: ticks(30 * ctx.duration, 0.5).map((t) => {
          const next = Math.max(0, left - 0.05 * ctx.strength)
          const strip = left > 0 ? 1 - next / left : 0
          left = next
          const procs = left === 0 && !heatDone ? { heat: 1 } : undefined
          if (procs) heatDone = true
          return hit(t, 'Gaze', 50 * ctx.strength, { heat: 1 }, { armorStripBefore: strip, procs })
        }),
      }
    },
  },
]

export const abilityDamageFor = (warframe: string, ability: string) => ABILITY_DAMAGE.filter((def) => def.warframe === warframe && def.ability.toLowerCase() === ability.toLowerCase())
export const defaultParams = (def: AbilityDamageDef) => Object.fromEntries((def.params ?? []).map((param) => [param.id, param.default]))
