// Incarnon evolution perks (tiers II-V), collected by hand from each weapon's wiki page since
// warframe-items doesn't have them. one line per perk per variant: TIER | PERK | VARIANT | EFFECTS
// - VARIANT "ALL" = same numbers for every variant in the family
// - EFFECTS are "; " separated statements. "When ...:" / "On ...:" starts a condition that sticks for the
//   rest of the line, "Stacks up to Nx." sets its cap
// - "[Incarnon Form only]" / "[Normal only]" restricts a single statement, untagged = both modes
// - genesis weapons use "Base" stats (added to the weapon's base before mods). the native Incarnons
//   (Zariman/Sanctum/Hex weapons) add plain crit/status chance flat AFTER mods (Laetum's page says so)
// assumptions: Burston Prime uses Burston's numbers, Soma Prime uses Soma's (their tables didn't come through)

export interface IncarnonFamily {
  variants: string[]
  native?: boolean
  lines: string
}

export const INCARNON_FAMILIES: IncarnonFamily[] = [
  {
    variants: ['Braton', 'Mk1-Braton', 'Braton Vandal', 'Braton Prime'],
    lines: `
II | Daring Reverie | Braton | +24 Base Damage; +50% Ammo Efficiency; When Channeled Ability active: +30 Base Damage
II | Daring Reverie | Mk1-Braton | +28 Base Damage; +50% Ammo Efficiency; When Channeled Ability active: +22 Base Damage
II | Daring Reverie | Braton Vandal | +12 Base Damage; +50% Ammo Efficiency; When Channeled Ability active: +34 Base Damage
II | Daring Reverie | Braton Prime | +4 Base Damage; +50% Ammo Efficiency; When Channeled Ability active: +38 Base Damage
II | Munitions Grit | Braton | +14 Base Damage; +20% Multishot; Multishot projectiles deal +60% damage
II | Munitions Grit | Mk1-Braton | +20 Base Damage; +20% Multishot; Multishot projectiles deal +48% damage
II | Munitions Grit | Braton Vandal | +8 Base Damage; +20% Multishot; Multishot projectiles deal +58% damage
II | Munitions Grit | Braton Prime | +2 Base Damage; +20% Multishot; Multishot projectiles deal +54% damage
III | Mercenary Chamber | ALL | Base Ammo Capacity increased [Normal only]
III | Void's Guidance | ALL | +60% Accuracy; -60% Recoil
III | Gunsmoke Pick Up | ALL | On Punch Through hit: 20% chance to restore 10% ammo [Normal only]
IV | Critical Parallel | Braton | +16% Base Critical Chance; +0.4 Base Critical Multiplier
IV | Critical Parallel | Mk1-Braton | +18% Base Critical Chance; +0.5 Base Critical Multiplier
IV | Critical Parallel | Braton Vandal | +16% Base Critical Chance; +0.4 Base Critical Multiplier
IV | Critical Parallel | Braton Prime | +18% Base Critical Chance; +0.2 Base Critical Multiplier
IV | Prelude of Might | Braton | When Critical Chance below 50%: +3.4 Base Critical Multiplier
IV | Prelude of Might | Mk1-Braton | When Critical Chance below 50%: +3.3 Base Critical Multiplier
IV | Prelude of Might | Braton Vandal | When Critical Chance below 50%: +3 Base Critical Multiplier
IV | Prelude of Might | Braton Prime | When Critical Chance below 50%: +3 Base Critical Multiplier
IV | Survivor's Edge | Braton | +10% Base Critical Chance; +12% Base Status Chance
IV | Survivor's Edge | Mk1-Braton | +12% Base Critical Chance; +12% Base Status Chance
IV | Survivor's Edge | Braton Vandal | +10% Base Critical Chance; +12% Base Status Chance
IV | Survivor's Edge | Braton Prime | +10% Base Critical Chance; +14% Base Status Chance`,
  },
  {
    variants: ['Torid'],
    lines: `
II | Final Fusillade | ALL | +51 Base Damage; On last shot in magazine: +3 Base Multishot
II | Plentiful Mayhem | ALL | +31 Base Damage; Multishot consumes ammo from Capacity; +60% Damage
III | Swift Deliverance | ALL | +50% Projectile Speed
III | Renewed Horror | ALL | On Reload from Empty: damage field duration doubles on first shot
III | Extended Volley | ALL | +9 Base Magazine Capacity [Normal only]
IV | Commodore's Fortune | ALL | +20% Base Critical Chance
IV | Survivor's Edge | ALL | +15% Base Critical Chance; +15% Base Status Chance
IV | Elemental Balance | ALL | +34% Base Status Chance`,
  },
  {
    variants: ['Latron', 'Latron Wraith', 'Latron Prime'],
    lines: `
II | Riddled Target | Latron | +48 Base Damage; On Puncture Status Effect: +25% Multishot; Stacks up to 4x.
II | Riddled Target | Latron Wraith | +12 Base Damage; On Puncture Status Effect: +25% Multishot; Stacks up to 4x.
II | Riddled Target | Latron Prime | +6 Base Damage; On Puncture Status Effect: +25% Multishot; Stacks up to 4x.
II | Swift Punishment | Latron | +48 Base Damage; When Sprint Speed 1.1 or higher: +30% Direct Damage per Status Type affecting the target
II | Swift Punishment | Latron Wraith | +12 Base Damage; When Sprint Speed 1.1 or higher: +30% Direct Damage per Status Type affecting the target
II | Swift Punishment | Latron Prime | +6 Base Damage; When Sprint Speed 1.1 or higher: +30% Direct Damage per Status Type affecting the target
III | Marksman's Hand | ALL | -60% Weapon Recoil
III | Extended Volley | ALL | +15 Base Magazine Capacity
III | Marksman's Focus | ALL | -30% Zoom
IV | Flensing Spikes | ALL | Remove 20% Armor per Puncture stack
IV | Deadhead | ALL | +100% Headshot Damage
IV | Critical Parallel | Latron | +30% Base Critical Chance; +0.6 Base Critical Multiplier
IV | Critical Parallel | Latron Wraith | +24% Base Critical Chance; +0.2 Base Critical Multiplier
IV | Critical Parallel | Latron Prime | +24% Base Critical Chance; +0.2 Base Critical Multiplier`,
  },
  {
    variants: ['Sybaris', 'Dex Sybaris', 'Sybaris Prime'],
    lines: `
II | Well Rehearsed | Sybaris | +20 Base Damage; On Consecutive Weakpoint Hits: +5 Base Damage; Stacks up to 3x.
II | Well Rehearsed | Dex Sybaris | +15 Base Damage; On Consecutive Weakpoint Hits: +5 Base Damage; Stacks up to 3x.
II | Well Rehearsed | Sybaris Prime | +15 Base Damage; On Consecutive Weakpoint Hits: +5 Base Damage; Stacks up to 3x.
II | Blazing Barrel | Sybaris | +20 Base Damage; On Firing: +5% Multishot; Stacks up to 10x.
II | Blazing Barrel | Dex Sybaris | +15 Base Damage; On Firing: +5% Multishot; Stacks up to 10x.
II | Blazing Barrel | Sybaris Prime | +15 Base Damage; On Firing: +5% Multishot; Stacks up to 10x.
III | Extended Volley | ALL | +8-12 Base Magazine Capacity
III | Ready Retaliation | ALL | On Reload From Empty: +60% Reload Speed
III | Marksman's Hand | ALL | -60% Weapon Recoil
IV | Elemental Dominance | Sybaris | +15% Base Status Chance [Normal only]; +30% Base Status Chance [Incarnon Form only]
IV | Elemental Dominance | Dex Sybaris | +15% Base Status Chance [Normal only]; +30% Base Status Chance [Incarnon Form only]
IV | Elemental Dominance | Sybaris Prime | +8% Base Status Chance [Normal only]; +16% Base Status Chance [Incarnon Form only]
IV | Reaver's Rapture | ALL | On Full Burst Hit: +20% Damage; Stacks up to 4x.
IV | Survivor's Edge | ALL | +5% Base Critical Chance; +10% Base Status Chance`,
  },
  {
    variants: ['Soma', 'Soma Prime'],
    lines: `
II | Fortress Salvo | ALL | +12 Base Damage; When Armor over 450: +4 Punch Through
II | Fortifying Bloodshed | ALL | +10 Base Damage; On Slash Status Kill: +100 Overshield
III | Kinetic Battle | ALL | -50% Weapon Recoil
III | Practiced Grip | ALL | +50% Accuracy
III | Rapid Reinforcement | ALL | +50% Reload Speed
IV | Fresh Havoc | ALL | On Reload From Empty: +6 Base Damage; Stacks up to 2x.
IV | Fatal Affliction | ALL | +40% Direct Damage per Status Type affecting the target
IV | Zeroed In | ALL | +0.6 Base Critical Multiplier`,
  },
  {
    variants: ['Boar', 'Boar Prime'],
    lines: `
II | Reified Bane | ALL | +10 Base Damage; On Reload From Empty: +14 Base Damage
II | Fortress Salvo | ALL | +16 Base Damage; When Armor over 450: +4 Punch Through
III | Ready Retaliation | ALL | On Reload From Empty: +100% Reload Speed
III | Mercenary Chamber | ALL | Base Ammo Capacity set to 195
III | Practiced Grip | ALL | +50% Accuracy
IV | Elemental Balance | ALL | +12% Base Status Chance [Normal only]; +96% Base Status Chance [Incarnon Form only]
IV | Critical Parallel | ALL | +20% Base Critical Chance; +0.5 Base Critical Multiplier
IV | Survivor's Edge | ALL | +10% Base Critical Chance; +6% Base Status Chance [Normal only]; +48% Base Status Chance [Incarnon Form only]`,
  },
  {
    variants: ['Boltor', 'Telos Boltor', 'Boltor Prime'],
    lines: `
II | Hunter's Mantra | Boltor | +18 Base Damage; When Channeled Ability active: +4 Punch Through
II | Hunter's Mantra | Telos Boltor | +4 Base Damage; When Channeled Ability active: +4 Punch Through
II | Hunter's Mantra | Boltor Prime | +4 Base Damage; When Channeled Ability active: +4 Punch Through
II | Crimson Overture | Boltor | +12 Base Damage; On Kill: +2 Base Damage; Stacks up to 4x.
II | Crimson Overture | Telos Boltor | On Kill: +2 Base Damage; Stacks up to 3x.
II | Crimson Overture | Boltor Prime | On Kill: +2 Base Damage; Stacks up to 3x.
III | Swift Deliverance | ALL | +60% Projectile Speed [Incarnon Form only]
III | Extended Volley | ALL | +20 Base Magazine Capacity [Incarnon Form only]
III | Rapid Reinforcement | ALL | +60% Reload Speed [Incarnon Form only]
IV | Elemental Balance | Boltor | +20% Base Status Chance [Incarnon Form only]
IV | Elemental Balance | Telos Boltor | +20% Base Status Chance [Incarnon Form only]
IV | Elemental Balance | Boltor Prime | +18% Base Status Chance [Incarnon Form only]
IV | Survivor's Edge | Boltor | +8% Base Critical Chance [Incarnon Form only]; +8% Base Status Chance [Incarnon Form only]
IV | Survivor's Edge | Telos Boltor | +4% Base Critical Chance [Incarnon Form only]; +4% Base Status Chance [Incarnon Form only]
IV | Survivor's Edge | Boltor Prime | +10% Base Critical Chance [Incarnon Form only]; +10% Base Status Chance [Incarnon Form only]
IV | Commodore's Fortune | Boltor | +12% Base Critical Chance [Incarnon Form only]
IV | Commodore's Fortune | Telos Boltor | +6% Base Critical Chance [Incarnon Form only]
IV | Commodore's Fortune | Boltor Prime | +14% Base Critical Chance [Incarnon Form only]`,
  },
  {
    variants: ['Burston', 'Burston Prime'],
    lines: `
II | Forceful Finality | ALL | +42 Base Damage; On final magazine burst: +5 Base Multishot [Normal only]
II | Fortress Salvo | ALL | +42 Base Damage; When Armor over 450: +2 Punch Through
III | Extended Volley | ALL | +21 Base Magazine Capacity [Incarnon Form only]
III | Ready Retaliation | ALL | On Reload From Empty: +100% Reload Speed [Incarnon Form only]
III | Kinetic Battle | ALL | -50% Weapon Recoil
IV | Reaver's Rapture | ALL | On Full Burst Hit: +20% Damage [Normal only]; Stacks up to 5x.
IV | Absolute Valor | ALL | +22% Base Critical Chance
IV | Fatal Affliction | ALL | +40% Direct Damage per Status Type affecting the target`,
  },
  {
    variants: ['Dera', 'Dera Vandal'],
    lines: `
II | Crimson Overture | Dera | +8 Base Damage; On Kill: +20% Ammo Efficiency; Stacks up to 4x.
II | Crimson Overture | Dera Vandal | +6 Base Damage; On Kill: +20% Ammo Efficiency; Stacks up to 4x.
II | Paragon Essence | Dera | +6 Base Damage; On Status Effect: +5% Fire Rate; Stacks up to 6x.
II | Paragon Essence | Dera Vandal | +4 Base Damage; On Status Effect: +5% Fire Rate; Stacks up to 6x.
III | Swift Deliverance | ALL | +50% Projectile Speed
III | Extended Volley | ALL | +22-30 Base Magazine Capacity [Normal only]
III | Evolved Autoloader | ALL | When Holstered: +50% Magazine Reloaded per second
IV | Deathtrap Trigger | Dera | +14% Base Critical Chance; +0.6 Base Critical Multiplier
IV | Deathtrap Trigger | Dera Vandal | +14% Base Critical Chance; +0.4 Base Critical Multiplier
IV | High Ground | ALL | Converts 25% of current Status Chance to Base Critical Chance, max 35%
IV | Elemental Balance | Dera | +18% Base Status Chance
IV | Elemental Balance | Dera Vandal | +14% Base Status Chance`,
  },
  {
    variants: ['Dread'],
    lines: `
II | Hitman's Opportunity | ALL | +70 Base Damage; When target below half Health: +100% Damage
II | Stalker's Resentment | ALL | +50 Base Damage; When Hate and Despair equipped, on hit: +10 Base Damage and +10% Fire Rate; Stacks up to 5x.
III | Swift Deliverance | ALL | +30% Projectile Speed
III | Marksman's Focus | ALL | -30% Zoom
III | Hitman's Hoard | ALL | Base Ammo Capacity 144 [Normal only]
IV | Survivor's Edge | ALL | +10% Base Critical Chance; +10% Base Status Chance
IV | Elemental Balance | ALL | +24% Base Status Chance
IV | Zeroed In | ALL | +1 Base Critical Multiplier`,
  },
  {
    variants: ['Gorgon', 'Gorgon Wraith', 'Prisma Gorgon'],
    lines: `
II | Hunter's Mantra | Gorgon | +10 Base Damage; When Channeled Ability active: +3 Punch Through; +40% Accuracy
II | Hunter's Mantra | Gorgon Wraith | +5 Base Damage; When Channeled Ability active: +3 Punch Through; +40% Accuracy
II | Hunter's Mantra | Prisma Gorgon | +5 Base Damage; When Channeled Ability active: +3 Punch Through; +40% Accuracy
II | Hoplite Virtue | Gorgon | +10 Base Damage; On Shield Break: +13 Base Damage
II | Hoplite Virtue | Gorgon Wraith | +5 Base Damage; On Shield Break: +8 Base Damage
II | Hoplite Virtue | Prisma Gorgon | +5 Base Damage; On Shield Break: +8 Base Damage
III | Resonant Restore | ALL | On Reload From Empty: +15 Base Magazine Capacity; Stacks up to 3x.
III | Rapid Reinforcement | ALL | +50% Reload Speed
III | Void's Guidance | ALL | -50% Weapon Recoil
IV | Survivor's Edge | Gorgon | +8% Base Critical Chance; +9% Base Status Chance
IV | Survivor's Edge | Gorgon Wraith | +8% Base Critical Chance; +6% Base Status Chance
IV | Survivor's Edge | Prisma Gorgon | +2% Base Critical Chance; +6% Base Status Chance
IV | Elemental Balance | Gorgon | +16% Base Status Chance
IV | Elemental Balance | Gorgon Wraith | +14% Base Status Chance
IV | Elemental Balance | Prisma Gorgon | +12% Base Status Chance
IV | Absolute Valor | Gorgon | +14% Base Critical Chance
IV | Absolute Valor | Gorgon Wraith | +14% Base Critical Chance
IV | Absolute Valor | Prisma Gorgon | +6% Base Critical Chance`,
  },
  {
    variants: ['Miter'],
    lines: `
II | Swift Sawblades | ALL | +77 Base Damage; When Channeled Ability active: +70% Fire Rate
II | Plentiful Mayhem | ALL | +57 Base Damage; Multishot consumes ammo from Capacity
III | Swift Deliverance | ALL | +50% Projectile Speed
III | Ready Retaliation | ALL | On Reload From Empty: +100% Reload Speed
III | Mercenary Chamber | ALL | Base Ammo Capacity set to 160 [Normal only]
IV | Sawblade Storm | ALL | Charged bounces explode for 1400 Blast in 5m [Normal only]
IV | Commodore's Fortune | ALL | +22% Base Critical Chance
IV | Critical Parallel | ALL | +12% Base Critical Chance; +12% Base Status Chance`,
  },
  {
    variants: ['Paris', 'Mk1-Paris', 'Paris Prime'],
    lines: `
II | Deadly Pace | Paris | +40 Base Damage; When Sprint Speed 1.2 or higher: +80% Fire Rate
II | Deadly Pace | Mk1-Paris | +50 Base Damage; When Sprint Speed 1.2 or higher: +80% Fire Rate
II | Deadly Pace | Paris Prime | +20 Base Damage; When Sprint Speed 1.2 or higher: +80% Fire Rate
II | Guardian's Might | Paris | +40 Base Damage; When Overshields active: +52 Base Damage
II | Guardian's Might | Mk1-Paris | +50 Base Damage; When Overshields active: +40 Base Damage
II | Guardian's Might | Paris Prime | +20 Base Damage; When Overshields active: +74 Base Damage
III | Ardent Trigger | ALL | On Punch Through Hit: +40% Fire Rate
III | Marksman's Focus | ALL | -30% Zoom
III | Swift Deliverance | ALL | +60% Projectile Speed
IV | Vicious Promise | ALL | When Enemy Undamaged: +40% Base Critical Chance; +2 Base Critical Multiplier
IV | Elemental Balance | ALL | +60% Base Status Chance
IV | Striking Succession | ALL | On Hit: +15 Base Damage; Stacks up to 4x.`,
  },
  {
    variants: ['Strun', 'Mk1-Strun', 'Strun Wraith', 'Strun Prime'],
    lines: `
II | Tenno Targeting | Strun | +54 Base Damage; When Channeled Ability active: +4 Punch Through
II | Tenno Targeting | Mk1-Strun | +68 Base Damage; When Channeled Ability active: +4 Punch Through
II | Tenno Targeting | Strun Wraith | +24 Base Damage; When Channeled Ability active: +4 Punch Through
II | Tenno Targeting | Strun Prime | +2 Base Damage; When Channeled Ability active: +4 Punch Through
II | Blazing Barrel | Strun | +54 Base Damage; On Firing: +0.05 Base Multishot; Stacks up to 5x.
II | Blazing Barrel | Mk1-Strun | +68 Base Damage; On Firing: +0.05 Base Multishot; Stacks up to 5x.
II | Blazing Barrel | Strun Wraith | +24 Base Damage; On Firing: +0.05 Base Multishot; Stacks up to 5x.
II | Blazing Barrel | Strun Prime | +2 Base Damage; On Firing: +0.05 Base Multishot; Stacks up to 5x.
III | Rapid Reinforcement | ALL | +60% Reload Speed
III | Galvanic Reload | ALL | On hitting Electricity target: 40% chance to restore 1 round [Normal only]
III | Swift Deliverance | ALL | +30% Projectile Speed
IV | Elemental Balance | Strun | +11% Base Status Chance [Normal only]; +132% Base Status Chance [Incarnon Form only]
IV | Elemental Balance | Mk1-Strun | +11% Base Status Chance [Normal only]; +110% Base Status Chance [Incarnon Form only]
IV | Elemental Balance | Strun Wraith | +10% Base Status Chance [Normal only]; +100% Base Status Chance [Incarnon Form only]
IV | Elemental Balance | Strun Prime | +11.3% Base Status Chance [Normal only]; +136% Base Status Chance [Incarnon Form only]
IV | Commodore's Fortune | Strun | +16% Base Critical Chance
IV | Commodore's Fortune | Mk1-Strun | +10% Base Critical Chance
IV | Commodore's Fortune | Strun Wraith | +12% Base Critical Chance
IV | Commodore's Fortune | Strun Prime | +12% Base Critical Chance
IV | Brutal Edge | Strun | +4% Base Critical Chance; +4% Base Status Chance [Normal only]; +48% Base Status Chance [Incarnon Form only]
IV | Brutal Edge | Mk1-Strun | +2% Base Critical Chance; +2% Base Status Chance [Normal only]; +20% Base Status Chance [Incarnon Form only]
IV | Brutal Edge | Strun Wraith | +4% Base Critical Chance; +4.8% Base Status Chance [Normal only]; +48% Base Status Chance [Incarnon Form only]
IV | Brutal Edge | Strun Prime | +4% Base Critical Chance; +4% Base Status Chance [Normal only]; +48% Base Status Chance [Incarnon Form only]`,
  },
  {
    variants: ['Felarx'],
    native: true,
    lines: `
II | Attuned Accuracy | ALL | When Aiming: +40% Accuracy
II | Kinetic Baffle | ALL | When Aiming: -50% Recoil
II | Frictionless Flight | ALL | When Aiming: +50% Projectile Speed
III | Dual-Mode Chamber | ALL | On Reload: toggles +100% Projectile Speed / +4 Punch Through
III | Evolved Autoloader | ALL | When Holstered: +50% Magazine Reloaded per second
III | Mounting Momentum | ALL | On Shell Reload: +10% Fire Rate; Stacks up to 99x.
IV | Brutal Edge | ALL | +10% Critical Chance; +10% Status Chance
IV | Incarnon Catalyst | ALL | On Weakpoint Hit: +50% Incarnon charge [Normal only]
IV | Racking Wrath | ALL | +20% Status Chance; -10% Critical Chance
V | Devastating Attrition | ALL | On Non-Critical Hit: 50% chance for +2000% Damage
V | Ruptured Plentitude | ALL | On Punch Through 3 enemies: +70% Ammo Efficiency
V | Agile Executor | ALL | When Aim Gliding or Sliding: +50% Ammo Efficiency`,
  },
  {
    variants: ['Laetum'],
    native: true,
    lines: `
II | Marksman's Hand | ALL | -40% Recoil
II | Rapid Wrath | ALL | +20% Fire Rate
II | Raptor's Chase | ALL | +50% Movement Speed while Aiming
III | Lethal Rearmament | ALL | On Headshot: +30% Reload Speed; Stacks up to 3x.
III | Awakened Readiness | ALL | 30% magazine reloaded per second while holstered [Normal only]
III | Feather of Justice | ALL | When Aim Gliding or Sliding: +60% Ammo Efficiency [Normal only]
IV | Caput Mortuum | ALL | On Headshot: +50% Damage
IV | Incarnon Efficiency | ALL | On Headshot: +50% Incarnon charge
IV | Elemental Excess | ALL | +20% Status Chance; -10% Critical Chance
V | Devouring Attrition | ALL | On Non-Critical Hit: 50% chance for +2000% Damage
V | Reaper's Plenty | ALL | On Headshot: +40% Ammo Efficiency [Normal only]
V | Overwhelming Attrition | ALL | On Hit that is neither Critical nor applies a Status Effect: +400% Damage; Stacks up to 3x.`,
  },
  {
    variants: ['Phenmor'],
    native: true,
    lines: `
II | Void's Guidance | ALL | When Aiming: +50% Accuracy; -50% Recoil
II | Rapid Wrath | ALL | +20% Fire Rate
II | Swift Deliverance | ALL | +80% Projectile Speed
III | Retribution's Vessel | ALL | +50% Magazine Capacity [Normal only]
III | Ready Retaliation | ALL | On Reload From Empty: +100% Reload Speed [Normal only]
III | Executioner's Fortune | ALL | On Headshot Kill: 20% chance to instantly Reload [Normal only]
IV | Survivor's Edge | ALL | +10% Critical Chance; +10% Status Chance
IV | Incarnon Efficiency | ALL | On Weakpoint Hit: +50% Incarnon charge
IV | Elemental Excess | ALL | +20% Status Chance; -10% Critical Chance
V | Devouring Attrition | ALL | On Non-Critical Hit: 50% chance for +2000% Damage
V | Spiteful Defilement | ALL | When target has fewer than 3 Status Effects: +100% Critical Damage
V | Lingering Judgement | ALL | On 2 Headshots within 2 seconds: +50% Headshot Damage`,
  },
  {
    variants: ['Onos'],
    native: true,
    lines: `
II | Marksman's Hand | ALL | -30% Recoil
II | Rapid Wrath | ALL | +25% Fire Rate
II | Swift Deliverance | ALL | +50% Projectile Speed
III | Extended Volley | ALL | +10 Base Magazine Capacity [Normal only]
III | Rapid Reinforcement | ALL | +30% Reload Speed
III | Hunter's Rearmament | ALL | On Kill: 10% chance to replenish 10 Ammo [Normal only]
IV | Lethal Lance | ALL | On Kill: +2.5 Punch Through
IV | Incarnon Efficiency | ALL | On Weakpoint Hit: +50% Incarnon charge
IV | Elemental Excess | ALL | +20% Status Chance; -10% Critical Chance
V | Sequential Skullbuster | ALL | On Consecutive Weakpoint Hits: +30% Headshot Damage; Stacks up to 4x.
V | Impaler's Ferocity | ALL | On Punch Through Hit: +200% Damage
V | Devastation Cascade | ALL | On Enemy Hit: +5% Critical Chance and +5% Critical Damage [Incarnon Form only]; Stacks up to 50x.`,
  },
  {
    variants: ['Ruvox'],
    native: true,
    lines: `
II | Orokin Reach | ALL | +1 Range
II | Lethal Impetus | ALL | On Kill: +15% Attack Speed; Stacks up to 3x.
II | Gathering Momentum | ALL | +5% Movement Speed per Combo Multiplier
III | Shockwave Synergy | ALL | Slam hits: +4 Combo Count per enemy
III | Seismic Slam | ALL | +60% Slam Radius
III | Adept Reflexes | ALL | +20 Initial Combo
IV | Swift Transmute | ALL | Incarnon Form activates at 3x Combo with Heavy Attack
IV | Ternary Vault | ALL | +1 Mid-air Jump
IV | Inspiring Execution | ALL | On Finisher: +30% Combo Count Chance
V | Brutal Efficiency | ALL | When impaling 5 or more enemies: +40% Heavy Attack Efficiency
V | Vulnerability Serum | ALL | Impaled enemies: +35% Status Chance vulnerability
V | Permanent Perforation | ALL | While enemy impaled: 5 Puncture Status`,
  },
  {
    variants: ['Praedos'],
    native: true,
    lines: `
II | Seismic Slam | ALL | +50% Slam Radius
II | Whirling Flurry | ALL | +20% Attack Speed
II | Drifting Grace | ALL | +20% Sprint Speed; +20% Slide
III | Shockwave Synergy | ALL | Slam hits: +4 Combo Count per enemy
III | Reaching Lunge | ALL | +1.5m Slide Attack Range
III | Adept Reflexes | ALL | +20 Initial Combo
IV | Swift Transmute | ALL | Incarnon Form activates at 3x Combo with Heavy Attack
IV | Evolved Ascension | ALL | +30% Parkour Velocity
IV | Vaulting Leap | ALL | +100% Double Jump strength
V | Transfigured Momentum | ALL | On Slide Kill: +50% Heavy Attack Efficiency
V | Kinetic Harmony | ALL | +100% Heavy Attack Wind Up Speed
V | Universal Readiness | ALL | On collecting ammo: +5 Combo Count`,
  },
  {
    // wiki Thalys: Incarnon Heavy Scythe, form at 6x combo + Heavy Attack. shard damage isn't modeled
    variants: ['Thalys'],
    native: true,
    lines: `
II | Dreadful Reach | ALL | On Weapon Status Effect: +0.1 Range for 8s; Stacks up to 20x.
II | Whirling Flurry | ALL | +20% Attack Speed
II | Raging Drift | ALL | While sliding: +80% Attack Speed; +20% Slide
III | Nimble Scythe | ALL | Each enemy hit by a Slide Attack grants +5 Combo Count
III | Echoes of Rage | ALL | +1 Combo Count on Shard Damage
III | Adept Reflexes | ALL | +20 Initial Combo
IV | Swift Transmute | ALL | Incarnon Form activates at 3x Combo with Heavy Attack
IV | Vaulting Leap | ALL | +100% Jump and Double Jump Height
IV | Devastating Mercy | ALL | Ground Finishers knock enemies down in a 6m radius
V | Explosive Growth | ALL | Shards grow up to 3 times when a new shard is created, fully grown shards erupt for x2 damage
V | Chain Shatter | ALL | Heavy attacks detonate shards for 200% of base damage, chaining to shards within 5m
V | Void Splinters | ALL | Shard duration 30s; shards become weak spots with +100% Critical Chance; shard damage -50%`,
  },
  {
    variants: ['Innodem'],
    native: true,
    lines: `
II | Orokin Reach | ALL | +0.5 Range
II | Bladed Harmony | ALL | +20% Attack Speed
II | Striking Swiftness | ALL | +30% Sprint Speed
III | Hawk Momentum | ALL | Sliding: +5 Combo per 10m
III | Skyborne Hunter | ALL | +0.5m Aerial Melee Range
III | Blade Twister | ALL | +60% Finisher Damage
IV | Incarnon Imago | ALL | Incarnon Form activates at 3x Combo with Heavy Attack
IV | Swooping Lunge | ALL | On Airborne Melee Kill: +50% Melee Damage; Stacks up to 3x.
IV | Protracted Execution | ALL | On Finisher: +20 Combo
V | Blood Anointed | ALL | On Finisher: +40% Heavy Attack Efficiency
V | Stunning Brutality | ALL | On Finisher: stun enemies within 10m
V | Armed Inspiration | ALL | On Ammo Collection: +5 Combo`,
  },
  {
    variants: ['Angstrum', 'Prisma Angstrum'],
    lines: `
II | Haven Foray | ALL | +50 Base Damage; When Overshields active: +50 Base Damage
II | Paladin Virtue | ALL | +75 Base Damage; When Energy Max over 700: +0.5 Base Critical Multiplier
III | Swift Deliverance | ALL | +30% Projectile Speed
III | Rapid Reinforcement | ALL | +50% Reload Speed
III | Hitman's Hoard | ALL | +9 Base Ammo Capacity [Normal only]
IV | Critical Parallel | Angstrum | +14% Base Critical Chance; +0.2 Base Critical Multiplier
IV | Critical Parallel | Prisma Angstrum | +10% Base Critical Chance; +0.2 Base Critical Multiplier
IV | Survivor's Edge | Angstrum | +9% Base Critical Chance; +9% Base Status Chance
IV | Survivor's Edge | Prisma Angstrum | +6% Base Critical Chance; +6% Base Status Chance
IV | Fatal Affliction | ALL | +40% Direct Damage per Status Type affecting the target`,
  },
  {
    variants: ['Atomos'],
    lines: `
II | Paladin Virtue | ALL | +24 Base Damage; When Energy Max over 700: +1 Base Critical Multiplier
II | Hoplite Virtue | ALL | +24 Base Damage; On Shield Break: +30 Base Damage
III | Moonrise Velocity | ALL | +7 Range [Normal only]
III | Mercenary Chamber | ALL | Base Ammo Capacity set to 560 [Normal only]
III | Resonant Restore | ALL | On Reload From Empty: +5 Base Magazine Capacity; Stacks up to 7x.
IV | Elemental Balance | ALL | +20% Base Status Chance
IV | Commodore's Fortune | ALL | +19% Base Critical Chance
IV | Survivor's Edge | ALL | +10% Base Critical Chance; +10% Base Status Chance`,
  },
  {
    variants: ['Bronco', 'Bronco Prime'],
    lines: `
II | Speeding Bullet | Bronco | +36 Base Damage; When Sprint Speed 1.2 or higher: +60% Projectile Speed
II | Speeding Bullet | Bronco Prime | +30 Base Damage; When Sprint Speed 1.2 or higher: +60% Projectile Speed
II | Infused Shots | Bronco | +20 Base Damage; On 50 Energy Spent: +10 Base Damage; Stacks up to 4x.
II | Infused Shots | Bronco Prime | +16 Base Damage; On 50 Energy Spent: +9 Base Damage; Stacks up to 4x.
III | Kinetic Battle | ALL | -50% Weapon Recoil
III | Practised Grip | ALL | +30% Accuracy
III | Extended Volley | ALL | +2 Base Magazine Capacity
IV | Enough for Everyone | ALL | When 6 enemies within 6m: +80% Ammo Efficiency
IV | Commodore's Fortune | ALL | +20% Base Critical Chance
IV | Rain of Lead | ALL | +2 Base Multishot`,
  },
  {
    variants: ['Cestra'],
    lines: `
II | Steadfast Grit | ALL | +10 Base Damage; On personal Shield or Overguard break: x3 Critical Damage
II | Fortress Salvo | ALL | +10 Base Damage; When Armor over 450: +80% Multishot
III | Rapid Reinforcement | ALL | +50% Reload Speed
III | Slayer's Nerve | ALL | On Hit: +6% Accuracy; Stacks up to 10x.
III | Swift Deliverance | ALL | +50% Projectile Speed
IV | Survivor's Edge | ALL | +18% Base Critical Chance
IV | Deathtrap Trigger | ALL | +2 Base Critical Multiplier
IV | Wiseman's Regard | ALL | Converts 30% of current Critical Chance to Base Status Chance, max 40%`,
  },
  {
    variants: ['Despair'],
    lines: `
II | Fatal Affliction | ALL | +50 Base Damage [Incarnon Form only]; +40% Direct Damage per Status Type affecting the target [Incarnon Form only]
II | Stalker's Vendetta | ALL | +60 Base Damage [Incarnon Form only]; When Dread and Hate equipped: +100% Damage [Incarnon Form only]; +30% Multishot [Incarnon Form only]
III | Marksman's Focus | ALL | -30% Zoom [Incarnon Form only]
III | Swift Deliverance | ALL | +50% Projectile Speed [Incarnon Form only]
III | Rapid Reinforcement | ALL | +100% Reload Speed [Incarnon Form only]
IV | Elemental Balance | ALL | +24% Base Status Chance [Incarnon Form only]
IV | Survivor's Edge | ALL | +12% Base Critical Chance [Incarnon Form only]; +12% Base Status Chance [Incarnon Form only]
IV | Critical Parallel | ALL | +18% Base Critical Chance [Incarnon Form only]; +0.4 Base Critical Multiplier [Incarnon Form only]`,
  },
  {
    variants: ['Dual Toxocyst'],
    lines: `
II | Carnage Reign | ALL | +60 Base Damage; When Energy Max 200 or higher: +33% Direct Damage per Status Type affecting the target
II | Fevered Frenzy | ALL | +50 Base Damage; On Ability Cast: +5% Multishot; Stacks up to 20x.
III | Ready Retaliation | ALL | On Reload From Empty: +100% Reload Speed
III | Evolved Autoloader | ALL | When Holstered: +50% Magazine Reloaded per second
III | Marksman's Hand | ALL | -50% Recoil
IV | Commodore's Fortune | ALL | +20% Base Critical Chance
IV | Neurotoxin | ALL | On Headshot: +70% Toxin
IV | Ripper Rounds | ALL | On Kill: +3 Punch Through`,
  },
  {
    variants: ['Furis', 'Mk1-Furis'],
    lines: `
II | Haven Foray | Furis | +28 Base Damage; When Overshields active: +30 Base Damage
II | Haven Foray | Mk1-Furis | +34 Base Damage; When Overshields active: +30 Base Damage
II | Stormburst | Furis | +28 Base Damage; On hitting Electricity-affected enemies: +0.4 Base Multishot; Stacks up to 3x.
II | Stormburst | Mk1-Furis | +34 Base Damage; On hitting Electricity-affected enemies: +0.4 Base Multishot; Stacks up to 3x.
III | Practiced Grip | ALL | +50% Accuracy
III | Extended Volley | ALL | +25 Base Magazine Capacity [Normal only]
III | Executioner's Fortune | ALL | On Headshot: 10% chance for Instant Reload
IV | Headcracker | ALL | On Headshot (50% chance): +5% Fire Rate; Stacks up to 10x.
IV | Prelude of Might | ALL | When Critical Chance below 40%: +3 Base Critical Multiplier
IV | Elemental Balance | Furis | +28% Base Status Chance
IV | Elemental Balance | Mk1-Furis | +39% Base Status Chance`,
  },
  {
    variants: ['Gammacor', 'Synoid Gammacor'],
    lines: `
II | Sage's Resolve | ALL | +10 Base Damage; When Channeled Ability active: +25% Multishot
II | Infused Shots | ALL | +6 Base Damage; On 50 Energy Spent: +5 Base Damage; Stacks up to 4x.
III | Evolved Autoloader | ALL | When Holstered: +50% Magazine Reloaded per second
III | Moonrise Velocity | ALL | +8 Range
III | Extended Volley | ALL | +40 Base Magazine Capacity
IV | Critical Parallel | Gammacor | +20% Base Critical Chance; +0.2 Base Critical Multiplier
IV | Critical Parallel | Synoid Gammacor | +10% Base Critical Chance; +0.2 Base Critical Multiplier
IV | Survivor's Edge | Gammacor | +12% Base Critical Chance; +10% Base Status Chance
IV | Survivor's Edge | Synoid Gammacor | +6% Base Critical Chance; +6% Base Status Chance
IV | Elemental Balance | Gammacor | +20% Base Status Chance
IV | Elemental Balance | Synoid Gammacor | +10% Base Status Chance`,
  },
  {
    variants: ['Kunai', 'Mk1-Kunai'],
    lines: `
II | Swift Conclusion | Kunai | +70 Base Damage; When enemy below half Health: +200% Damage
II | Swift Conclusion | Mk1-Kunai | +80 Base Damage; When enemy below half Health: +200% Damage
II | Sage's Resolve | Kunai | +80 Base Damage; When Channeled Ability active: +100% Multishot
II | Sage's Resolve | Mk1-Kunai | +70 Base Damage; When Channeled Ability active: +100% Multishot
III | Swift Deliverance | ALL | +60% Projectile Speed
III | Extended Volley | ALL | +10 Base Magazine Capacity
III | Rapid Reinforcement | ALL | +50% Reload Speed
IV | Deathtrap Trigger | Kunai | On equip from Primary: +40% Base Critical Chance; +1.4 Base Critical Multiplier
IV | Deathtrap Trigger | Mk1-Kunai | On equip from Primary: +42% Base Critical Chance; +1 Base Critical Multiplier
IV | Accelerating Volley | ALL | On Fire: +20% Fire Rate; Stacks up to 5x.
IV | Survivor's Edge | ALL | +12% Base Critical Chance; +12% Base Status Chance`,
  },
  {
    variants: ['Lato', 'Lato Vandal', 'Lato Prime'],
    lines: `
II | Haven Foray | Lato | +40 Base Damage; When Overshields active: +40 Base Damage
II | Haven Foray | Lato Vandal | +22 Base Damage; When Overshields active: +40 Base Damage
II | Haven Foray | Lato Prime | +2 Base Damage; When Overshields active: +34 Base Damage
II | Reified Bane | Lato | +30 Base Damage; On Reload From Empty: +30 Base Damage
II | Reified Bane | Lato Vandal | +12 Base Damage; On Reload From Empty: +30 Base Damage
II | Reified Bane | Lato Prime | +2 Base Damage; On Reload From Empty: +24 Base Damage
III | Void's Guidance | ALL | +50% Accuracy; -50% Recoil
III | Marksman's Gain | ALL | On Headshot: 20% chance for +50% Ammo Efficiency
III | Exact Penance | ALL | On Kill: 50% chance for Instant Reload
IV | Survivor's Edge | Lato | +20% Base Critical Chance; +12% Base Status Chance
IV | Survivor's Edge | Lato Vandal | +6% Base Critical Chance; +12% Base Status Chance
IV | Survivor's Edge | Lato Prime | +4% Base Critical Chance; +10% Base Status Chance
IV | Deathtrap Trigger | Lato | On equip from Primary: +50% Base Critical Chance; +3.2 Base Critical Multiplier
IV | Deathtrap Trigger | Lato Vandal | On equip from Primary: +38% Base Critical Chance; +2.6 Base Critical Multiplier
IV | Deathtrap Trigger | Lato Prime | On equip from Primary: +30% Base Critical Chance; +2.3 Base Critical Multiplier
IV | Carnage Reign | ALL | +40% Direct Damage per Status Type affecting the target`,
  },
  {
    variants: ['Lex', 'Lex Prime'],
    lines: `
II | Hoplite Virtue | Lex | +80 Base Damage; On Shield Break: +80 Base Damage
II | Hoplite Virtue | Lex Prime | +20 Base Damage; On Shield Break: +80 Base Damage
II | Trusty Sidearm | Lex | +80 Base Damage; When Channeled Ability active: +60% Ammo Efficiency
II | Trusty Sidearm | Lex Prime | +20 Base Damage; When Channeled Ability active: +60% Ammo Efficiency
III | Lex Talionis | ALL | On Headshot: -20% Weapon Recoil; Stacks up to 4x.
III | Extended Volley | ALL | +10 Base Magazine Capacity
III | Ready Retaliation | ALL | On Reload From Empty: +100% Reload Speed
IV | Executioner's Dawn | ALL | On Equip: +100% Headshot Damage
IV | Elemental Balance | Lex | +40% Base Status Chance
IV | Elemental Balance | Lex Prime | +30% Base Status Chance
IV | Critical Parallel | Lex | +20% Base Critical Chance; +0.4 Base Critical Multiplier
IV | Critical Parallel | Lex Prime | +19% Base Critical Chance; +0.4 Base Critical Multiplier`,
  },
  {
    variants: ['Sicarus', 'Sicarus Prime'],
    lines: `
II | Feigned Retreat | Sicarus | +50 Base Damage; When enemy below half Health: +40% Damage
II | Feigned Retreat | Sicarus Prime | +40 Base Damage; When enemy below half Health: +40% Damage
II | King's Gambit | Sicarus | +50 Base Damage; Bodyshots can't crit, weak point hits get +150% Critical Chance
II | King's Gambit | Sicarus Prime | +40 Base Damage; Bodyshots can't crit, weak point hits get +150% Critical Chance
III | Void's Guidance | ALL | +40% Accuracy
III | Rapid Reinforcement | ALL | +50% Reload Speed
III | Extended Volley | ALL | +9-12 Base Magazine Capacity
IV | Commodore's Fortune | Sicarus | +18% Base Critical Chance
IV | Commodore's Fortune | Sicarus Prime | +14% Base Critical Chance
IV | Survivor's Edge | Sicarus | +12% Base Critical Chance; Base Status Chance set to 12%
IV | Survivor's Edge | Sicarus Prime | +9% Base Critical Chance; Base Status Chance set to 9%
IV | Wiseman's Regard | ALL | Converts 30% of current Critical Chance to Base Status Chance, max 40%`,
  },
  {
    variants: ['Vasto', 'Vasto Prime'],
    lines: `
II | Lone Gun | Vasto | +66 Base Damage; When No Primary equipped: +40 Base Damage
II | Lone Gun | Vasto Prime | +24 Base Damage; When No Primary equipped: +40 Base Damage
II | Deathtrap Trigger | Vasto | +66 Base Damage; On equip from Primary: +30% Base Critical Chance; +2.2 Base Critical Multiplier
II | Deathtrap Trigger | Vasto Prime | +24 Base Damage; On equip from Primary: +30% Base Critical Chance; +0.8 Base Critical Multiplier
III | Extended Volley | ALL | +6 Base Magazine Capacity
III | Marksman's Hand | ALL | -50% Weapon Recoil
III | Awakened Readiness | ALL | When Holstered: +20% Magazine Reloaded per second [Normal only]
IV | Commodore's Fortune | Vasto | +16% Base Critical Chance
IV | Commodore's Fortune | Vasto Prime | +18% Base Critical Chance
IV | Survivor's Edge | ALL | +10% Base Critical Chance; +10% Base Status Chance
IV | Reaper's Plenty | ALL | On Headshot: +100% Ammo Efficiency [Normal only]`,
  },
  {
    variants: ['Zylok', 'Zylok Prime'],
    lines: `
II | Precision's Payoff | Zylok | +76 Base Damage; On Burst Headshots: +20 Base Damage [Normal only]; Stacks up to 3x.
II | Precision's Payoff | Zylok Prime | +30 Base Damage; On Burst Headshots: +20 Base Damage [Normal only]; Stacks up to 3x.
II | Mauler's Magazine | Zylok | +76 Base Damage; On Reload From Empty: +1 Base Critical Multiplier; Stacks up to 2x.
II | Mauler's Magazine | Zylok Prime | +30 Base Damage; On Reload From Empty: +1 Base Critical Multiplier; Stacks up to 2x.
III | Extended Volley | ALL | +12-18 Base Magazine Capacity [Normal only]
III | Rapid Reinforcement | ALL | +50% Reload Speed
III | Void's Guidance | ALL | +60% Accuracy; -60% Recoil
IV | Survivor's Edge | Zylok | +20% Base Critical Chance; +20% Base Status Chance
IV | Survivor's Edge | Zylok Prime | +22% Base Critical Chance; +16% Base Status Chance
IV | Commodore's Fortune | Zylok | +32% Base Critical Chance
IV | Commodore's Fortune | Zylok Prime | +30% Base Critical Chance
IV | Fatal Affliction | ALL | +40% Direct Damage per Status Type affecting the target`,
  },
  {
    variants: ['Skana', 'Prisma Skana', 'Skana Prime'],
    lines: `
II | Guardian's Promise | Skana | +100 Base Damage; When Overshields active: +80% Heavy Attack Efficiency
II | Guardian's Promise | Prisma Skana | +100 Base Damage; When Overshields active: +80% Heavy Attack Efficiency
II | Guardian's Promise | Skana Prime | +10 Base Damage; When Overshields active: +80% Heavy Attack Efficiency
II | Wartime Nerve | Skana | +90 Base Damage; On hitting undamaged enemies: +9 Combo Count
II | Wartime Nerve | Prisma Skana | +90 Base Damage; On hitting undamaged enemies: +9 Combo Count
II | Wartime Nerve | Skana Prime | +10 Base Damage; On hitting undamaged enemies: +9 Combo Count
III | Orokin Reach | ALL | +0.4 Range
III | Resolute Force | ALL | +6s Combo Duration
III | Swift Break | ALL | +50% Heavy Attack Wind Up Speed
IV | Survivor's Edge | Skana | +12% Base Critical Chance; +10% Base Status Chance
IV | Survivor's Edge | Prisma Skana | +12% Base Critical Chance; +10% Base Status Chance
IV | Survivor's Edge | Skana Prime | +2% Base Critical Chance; +4% Base Status Chance
IV | Elemental Excess | Skana | +20% Base Status Chance
IV | Elemental Excess | Prisma Skana | +20% Base Status Chance
IV | Elemental Excess | Skana Prime | +10% Base Status Chance
IV | Absolute Valor | Skana | +25% Base Critical Chance
IV | Absolute Valor | Prisma Skana | +25% Base Critical Chance
IV | Absolute Valor | Skana Prime | +4% Base Critical Chance`,
  },
  {
    variants: ['Furax', 'Mk1-Furax', 'Furax Wraith'],
    lines: `
II | Swordsman's Flourish | Furax | +110 Base Damage; When Melee Weapon equipped: +100% Combo Count Chance
II | Swordsman's Flourish | Mk1-Furax | +100 Base Damage; When Melee Weapon equipped: +100% Combo Count Chance
II | Swordsman's Flourish | Furax Wraith | +65 Base Damage; When Melee Weapon equipped: +100% Combo Count Chance
II | Kill Joy | Furax | +90 Base Damage; When enemies within 6m: +10% Attack Speed; Stacks up to 5x.
II | Kill Joy | Mk1-Furax | +80 Base Damage; When enemies within 6m: +10% Attack Speed; Stacks up to 5x.
II | Kill Joy | Furax Wraith | +55 Base Damage; When enemies within 6m: +10% Attack Speed; Stacks up to 5x.
III | Moonrise Velocity | ALL | +1 Range
III | Overhand | ALL | Heavy Attack Efficiency set to 20%
III | Standoff | ALL | Combo Timer paused while holstered
IV | Flashing Bleed | ALL | On Impact Status Effect: +40% chance of Bleed
IV | Kinetic Killer | ALL | Slide Attacks: Base Critical Multiplier set to 4x
IV | Absolute Dominion | Furax | +24% Base Status Chance
IV | Absolute Dominion | Mk1-Furax | +22% Base Status Chance
IV | Absolute Dominion | Furax Wraith | +14% Base Status Chance`,
  },
  {
    variants: ['Okina', 'Okina Prime'],
    lines: `
II | Seeing Red | Okina | +60 Base Damage; +5 extra Combo on Slash-affected targets
II | Seeing Red | Okina Prime | +20 Base Damage; +5 extra Combo on Slash-affected targets
II | Synergist Surety | Okina | +60 Base Damage; On Critical Hit: +8% Status Damage; Stacks up to 5x.
II | Synergist Surety | Okina Prime | +20 Base Damage; On Critical Hit: +6% Status Damage; Stacks up to 5x.
III | Orokin Reach | ALL | +1 Range
III | Standoff | ALL | Combo Timer paused while holstered
III | Swordsman's Celerity | ALL | +30% Movement Speed
IV | Commodore's Fortune | Okina | +12% Base Critical Chance
IV | Commodore's Fortune | Okina Prime | +6% Base Critical Chance
IV | Alchemy of War | Okina | +16% Base Status Chance; +25% Status Duration
IV | Alchemy of War | Okina Prime | +12% Base Status Chance; +25% Status Duration
IV | Survivor's Edge | Okina | +6% Base Critical Chance; +10% Base Status Chance
IV | Survivor's Edge | Okina Prime | +2% Base Critical Chance; +8% Base Status Chance`,
  },
  {
    variants: ['Bo', 'Mk1-Bo', 'Bo Prime'],
    lines: `
II | Stalwart Oak | Bo | +110 Base Damage; When Armor over 450: +30 Parry Angle
II | Stalwart Oak | Mk1-Bo | +90 Base Damage; When Armor over 450: +30 Parry Angle
II | Stalwart Oak | Bo Prime | +34 Base Damage; When Armor over 450: +30 Parry Angle
II | Swordsman's Flourish | Bo | +100 Base Damage; When Melee Weapon equipped: +100% Combo Count Chance
II | Swordsman's Flourish | Mk1-Bo | +85 Base Damage; When Melee Weapon equipped: +100% Combo Count Chance
II | Swordsman's Flourish | Bo Prime | +30 Base Damage; When Melee Weapon equipped: +100% Combo Count Chance
III | Orokin Reach | ALL | +0.5 Range
III | Overhand | ALL | Base Heavy Attack Efficiency set to 20%
III | Swordsman's Celerity | ALL | +20% Movement Speed
IV | Flashing Bleed | ALL | On Impact Status Effect: +40% chance of Bleed
IV | Subtle Force | Bo | +12% Base Critical Chance; +12% Base Status Chance
IV | Subtle Force | Mk1-Bo | +15% Base Critical Chance; +15% Base Status Chance
IV | Subtle Force | Bo Prime | +6% Base Critical Chance; +6% Base Status Chance
IV | Absolute Dominion | Bo | +34% Base Status Chance
IV | Absolute Dominion | Mk1-Bo | +38% Base Status Chance
IV | Absolute Dominion | Bo Prime | +30% Base Status Chance`,
  },
  {
    variants: ['Ack & Brunt'],
    lines: `
II | Templar's Wrath | ALL | +150 Base Damage; When Armor over 450: +70% Heavy Attack Efficiency
II | Shieldmaiden's Rush | ALL | +150 Base Damage; On Shield Break: +300% Combo Count Chance while Blocking
III | Orokin Reach | ALL | +0.7 Range
III | Abiding Hold | ALL | Combo Timer paused while holstered
III | Swift Break | ALL | +70% Heavy Attack Wind Up Speed
IV | Rogue Readiness | ALL | On Kill: 50% chance to instantly reload Primary and Secondary
IV | Absolute Valor | ALL | +17% Base Critical Chance
IV | Versatile Creed | ALL | +9% Base Critical Chance; +9% Base Status Chance`,
  },
  {
    variants: ['Anku'],
    lines: `
II | Edge of Justice | ALL | +50 Base Damage; When Melee Weapon equipped: +40% Attack Speed
II | Guardian's Promise | ALL | +50 Base Damage; When Overshields active: +80% Heavy Attack Efficiency
III | Standoff | ALL | Combo Timer paused while holstered
III | Swordsman's Celerity | ALL | +20% Movement Speed
III | Swift Break | ALL | +60% Heavy Attack Wind Up Speed
IV | Absolute Dominion | ALL | +20% Base Status Chance
IV | Subtle Force | ALL | +6% Base Critical Chance; +14% Base Status Chance
IV | Absolute Valor | ALL | +12% Base Critical Chance`,
  },
  {
    variants: ['Ceramic Dagger'],
    lines: `
II | Gun and Blade | ALL | +100 Base Damage; On Primary Kill: +1 Initial Combo; Stacks up to 100x.
II | Breacher's Opportunity | ALL | +120 Base Damage; On Shield Break: +80 Base Damage
III | Orokin Reach | ALL | +1 Range
III | Adept Reflexes | ALL | +20 Initial Combo
III | Rogue Readiness | ALL | On Kill: 40% chance to instantly reload Primary and Secondary
IV | Red Right Hand | ALL | On first attack with Primary equipped: +2 Base Critical Multiplier
IV | Absolute Dominion | ALL | +30% Base Status Chance
IV | Absolute Valor | ALL | +30% Base Critical Chance`,
  },
  {
    variants: ['Dual Ichor'],
    lines: `
II | Alchemist's Wrath | ALL | +90 Base Damage; On Toxin-affected targets: +5 Combo
II | Ronin's Rush | ALL | +90 Base Damage; On final hit of Neutral Combo: +30% Attack Speed
III | Orokin Reach | ALL | +0.6 Range
III | Resolute Force | ALL | +7s Combo Duration
III | Swift Break | ALL | +100% Heavy Attack Wind Up Speed
IV | Absolute Valor | ALL | +34% Base Status Chance
IV | Poison Parasite | ALL | On killing an enemy with 3+ Toxin stacks: +33 Health Regen/s
IV | Universal Readiness | ALL | Collecting ammo grants +5 Combo`,
  },
  {
    variants: ['Hate'],
    lines: `
II | Swordsman's Flourish | ALL | +30 Base Damage; When Melee Weapon equipped: +100% Combo Count Chance
II | Stalker's Legacy | ALL | +30 Base Damage; When Dread and Despair equipped: +30 Initial Combo
III | Orokin Reach | ALL | +0.8 Range
III | Swift Break | ALL | +60% Heavy Attack Wind Up Speed
III | Resolute Force | ALL | +10s Combo Duration
IV | Absolute Valor | ALL | +10% Base Critical Chance
IV | Absolute Dominion | ALL | +20% Base Status Chance
IV | Subtle Force | ALL | +6% Base Critical Chance; +10% Base Status Chance`,
  },
  {
    variants: ['Magistar', 'Sancti Magistar'],
    lines: `
II | Crushing Verdict | Magistar | +100 Base Damage; When Channeled Ability active: +40% Follow Through
II | Crushing Verdict | Sancti Magistar | +20 Base Damage; When Channeled Ability active: +40% Follow Through
II | Edge of Justice | Magistar | +100 Base Damage; When Melee Weapon equipped: +40% Attack Speed
II | Edge of Justice | Sancti Magistar | +20 Base Damage; When Melee Weapon equipped: +40% Attack Speed
III | Seismic Slam | ALL | +100% Slam Radius
III | Orokin Reach | ALL | +1.4 Range
III | Swift Break | ALL | +30% Heavy Attack Wind Up Speed
IV | Flashing Bleed | ALL | On Impact Status Effect: +50% chance of Bleed
IV | Subtle Force | ALL | +8% Base Critical Chance; +8% Base Status Chance
IV | Critical Parallel | Magistar | +16% Base Critical Chance; +1 Base Critical Multiplier
IV | Critical Parallel | Sancti Magistar | +12% Base Critical Chance; +0.2 Base Critical Multiplier`,
  },
  {
    variants: ['Nami Solo'],
    lines: `
II | Brigand's Frenzy | ALL | +80 Base Damage; On Equip: +30% Attack Speed
II | Master's Flourish | ALL | +80 Base Damage; On Finisher Kill: +40 Health per second
III | Lone Blade | ALL | When Melee Weapon equipped: +60% Base Follow Through
III | Swift Break | ALL | +50% Heavy Attack Wind Up Speed
III | Resolute Force | ALL | +6s Combo Duration
IV | Absolute Valor | ALL | +21% Base Critical Chance
IV | Versatile Creed | ALL | +14% Base Critical Chance; +14% Base Status Chance
IV | Absolute Dominion | ALL | +30% Base Status Chance`,
  },
  {
    variants: ['Sibear'],
    lines: `
II | Master's Shatter | ALL | +20 Base Damage; On Cold-affected targets: +10 Combo
II | Thane's Wrath | ALL | +20 Base Damage; When Armor over 450: +40 Base Damage
III | Orokin Reach | ALL | +1 Range
III | Kinetic Harmony | ALL | +60% Heavy Attack Wind Up Speed
III | Resolute Force | ALL | +6s Combo Duration
IV | Mounting Avalanche | ALL | On killing an enemy with 3+ Cold stacks: +15 Initial Combo; Stacks up to 4x.
IV | Absolute Valor | ALL | +25% Base Critical Chance
IV | Red Right Hand | ALL | On first attack with Primary equipped: +2 Base Critical Multiplier`,
  },
  // ---- Circuit week 9 (Update 43, summer 2026). numbers from the wikiwiki.jp Incarnon pages since the English wiki tables
  // don't come through as text. Ballistica's columns there are Normal / Rakta / Prime
  {
    variants: ['Vectis', 'Vectis Prime'],
    lines: `
II | Inciting Incident | Vectis | +100 Base Damage; When Channeled Ability active: +2 Punch Through
II | Inciting Incident | Vectis Prime | +200 Base Damage; When Channeled Ability active: +2 Punch Through
II | Lone Enforcer | Vectis | +75 Base Damage; When no enemies within 5 m: +25% Multishot
II | Lone Enforcer | Vectis Prime | +150 Base Damage; When no enemies within 5 m: +25% Multishot
III | Rapid Reinforcement | ALL | +60% Reload Speed
III | Marksman's Hand | ALL | -60% Weapon Recoil
III | Silent Running | ALL | -100% Weapon Noise
IV | Deadhead | ALL | +25% Headshot Damage
IV | Critical Parallel | Vectis | +10% Base Critical Chance; +0.5 Base Critical Multiplier
IV | Critical Parallel | Vectis Prime | +8% Base Critical Chance; +0.5 Base Critical Multiplier
IV | Wiseman's Regard | ALL | +30% of current Critical Chance as Base Status Chance, up to 40%`,
  },
  {
    variants: ['Ballistica', 'Rakta Ballistica', 'Ballistica Prime'],
    lines: `
II | Headcracker | Ballistica | +30 Base Damage; On Headshot: +7.5% Fire Rate; Stacks up to 10x.
II | Headcracker | Rakta Ballistica | +10 Base Damage; On Headshot: +7.5% Fire Rate; Stacks up to 10x.
II | Headcracker | Ballistica Prime | +3 Base Damage; On Headshot: +7.5% Fire Rate; Stacks up to 10x.
II | Prolific Perforation | Ballistica | +30 Base Damage; On Punch Through hit: +10% Flat Critical Chance; Stacks up to 8x.
II | Prolific Perforation | Rakta Ballistica | +10 Base Damage; On Punch Through hit: +10% Flat Critical Chance; Stacks up to 8x.
II | Prolific Perforation | Ballistica Prime | +3 Base Damage; On Punch Through hit: +10% Flat Critical Chance; Stacks up to 8x.
III | Rapid Reinforcement | ALL | +50% Reload Speed
III | Swift Deliverance | ALL | +50% Projectile Speed
III | Void's Guidance | ALL | +40% Accuracy; -40% Recoil
IV | Elemental Balance | Ballistica | +20% Base Status Chance [Normal only]; +20% Base Status Chance [Incarnon Form only]
IV | Elemental Balance | Rakta Ballistica | +20% Base Status Chance [Normal only]; +20% Base Status Chance [Incarnon Form only]
IV | Elemental Balance | Ballistica Prime | +18% Base Status Chance [Normal only]; +72% Base Status Chance [Incarnon Form only]
IV | Survivor's Edge | Ballistica | +10% Base Critical Chance; +10% Base Status Chance [Normal only]; +10% Base Status Chance [Incarnon Form only]
IV | Survivor's Edge | Rakta Ballistica | +8% Base Critical Chance; +8% Base Status Chance [Normal only]; +8% Base Status Chance [Incarnon Form only]
IV | Survivor's Edge | Ballistica Prime | +7% Base Critical Chance; +7% Base Status Chance [Normal only]; +28% Base Status Chance [Incarnon Form only]
IV | Critical Parallel | Ballistica | +15% Base Critical Chance; +1 Base Critical Multiplier
IV | Critical Parallel | Rakta Ballistica | +14% Base Critical Chance; +1 Base Critical Multiplier
IV | Critical Parallel | Ballistica Prime | +12% Base Critical Chance; +1 Base Critical Multiplier`,
  },
  {
    variants: ['Stug'],
    lines: `
II | Blazing Barrel | ALL | +175 Base Damage; On Shot (resets on reload): +5% Multishot; Stacks up to 10x.
II | Overcharge Blast | ALL | +300 Base Damage; When Max Energy 700 or more: +50% Blast Radius
III | Rapid Reinforcement | ALL | +50% Reload Speed
III | Swift Deliverance | ALL | +50% Projectile Speed
III | Resonant Restore | ALL | On Reload from Empty: +10 Base Magazine Capacity; Stacks up to 3x.
IV | Survivor's Edge | ALL | +15% Base Critical Chance; +15% Base Status Chance
IV | Deathtrap Trigger | ALL | +25% Base Critical Chance; +1.5 Base Critical Multiplier
IV | Elemental Balance | ALL | +20% Base Status Chance [Normal only]; +40% Base Status Chance [Incarnon Form only]`,
  },
  // melee Incarnon form is assumed up (perkAppliesTo), so "doubled in Incarnon Form" perks get the doubled number
  {
    variants: ['Destreza', 'Destreza Prime'],
    lines: `
II | Weighted Impetus | Destreza | +50 Base Damage; On Heavy Attack Kill: +100% Heavy Attack Wind Up Speed
II | Weighted Impetus | Destreza Prime | +40 Base Damage; On Heavy Attack Kill: +100% Heavy Attack Wind Up Speed
II | Piercing Stature | Destreza | +50 Base Damage; On Puncture Status Effect: +20% Flat Status Chance; Stacks up to 5x.
II | Piercing Stature | Destreza Prime | +40 Base Damage; On Puncture Status Effect: +20% Flat Status Chance; Stacks up to 5x.
III | Orokin Reach | ALL | +1 Range
III | Overhand | ALL | Heavy Attack Efficiency fixed at 30%
III | Adept Reflexes | ALL | +20 Initial Combo
IV | Absolute Dominion | Destreza | +20% Base Status Chance
IV | Absolute Dominion | Destreza Prime | +16% Base Status Chance
IV | Critical Forte | Destreza | +1.2 Base Critical Multiplier
IV | Critical Forte | Destreza Prime | +0.6 Base Critical Multiplier
IV | Decisive Stature | ALL | +25% of current Status Chance as Base Critical Chance, up to 35%`,
  },
  {
    variants: ['Obex', 'Prisma Obex'],
    lines: `
II | Balanced Stagger | Obex | +50 Base Damage; On Neutral Combo hit: 20% chance to stagger for a Finisher
II | Balanced Stagger | Prisma Obex | +10 Base Damage; On Neutral Combo hit: 20% chance to stagger for a Finisher
II | Armored Finisher | Obex | +50 Base Damage; When target Armor 450 or more: +80% Finisher Damage
II | Armored Finisher | Prisma Obex | +10 Base Damage; When target Armor 450 or more: +80% Finisher Damage
III | Rapid Conclusion | ALL | On Finisher Kill: +2.5% Parkour Velocity; Stacks up to 16x.
III | Orokin Reach | ALL | +1.2 Range
III | Standoff | ALL | Combo timer pauses while holstered
IV | Subtle Force | Obex | +10% Base Critical Chance; +18% Base Status Chance
IV | Subtle Force | Prisma Obex | +10% Base Critical Chance; +12% Base Status Chance
IV | Absolute Dominion | Obex | +28% Base Status Chance
IV | Absolute Dominion | Prisma Obex | +20% Base Status Chance
IV | Critical Coefficient | ALL | +1.2 Base Critical Multiplier`,
  },
]
