# verbose-spork-wf-calc
calculator for warframe

React + Vite + TypeScript. Item data comes from [@wfcd/items](https://github.com/WFCD/warframe-items) (the package was renamed from `warframe-items`, which stopped updating in April 2025), trimmed at build time.

## Running it

```sh
npm install      # also generates src/data/*.json
npm run dev      # http://localhost:5173
npm run check    # calc sanity check + render smoke test
npm run build
npm run leaderboard  # re-run the optimizer and rewrite public/leaderboard.json (~1 min)
npm run deploy       # build + publish to GitHub Pages (gh-pages branch)
```

Bump data after a patch with `npm update @wfcd/items` (dev/build regenerate the JSON automatically).

## How the math works

Follows [Damage/Calculation](https://wiki.warframe.com/w/Damage/Calculation) and the status effect pages. All the game numbers live in `src/calc/constants.ts`.

1. Each damage type becomes a proportion of base damage (physical mods scale their own type, element mods add % of base, elements combine in slot order)
2. Each final type gets quantized to the nearest 1/32 of base damage
3. × modded base damage, × faction bonus (bane + Roar, additive), × crit
   - Condition Overload-type bonuses (CO, Galvanized Aptitude/Savvy/Shot per status type, Secondary Shiver per Cold stack) follow
     [Condition Overload (Mechanic)](https://wiki.warframe.com/w/Condition_Overload_(Mechanic)), see `src/calc/conditionOverload.ts`:
     additive `base × [(1 + mods) × other multipliers + CO]` by default, multiplicative `base × (1 + mods) × (1 + CO) × others` on the
     attacks the wiki lists (mostly projectiles: Torid, Cinta, Nataruk, Incarnon Latron/Paris/Dread, Akarius Prime, Seer, Epitaph...),
     scaled on a few (Ballistica charged 25%, Trumna AoE 164%, Zarr cluster 167%), none on others and on unlisted AoE
   - CO counts status types not stacks, lifted/knocked down counts as one. Longbow Sharpshot is its own multiplier (additive CO skips it)
4. Per type vs the target: U36 faction weakness (×1.5 / ×0.5), armor on health, Viral on health, Magnetic on shields/overguard, then vulnerability and headshot
5. Status procs: `tick = fraction × base × (1 + damage mods) × (1 + faction) × (1 + literal element mod) × (1 + faction) × (1 + status damage) × crit × body part`
   - fractions: Slash 35%, Heat/Toxin/Electricity/Gas 50% per tick for 6 damaging ticks, Blast 30% once after a 1.5s fuse
   - uses the full modded base damage (not quantized, not just that element's share)
   - only literal element mods count: Hellfire buffs Heat procs, Valence Formation's Gas buffs Gas, nothing buffs Slash or Blast procs
   - procs inherit the crit of the hit, so each proc shows non-crit / crit / average
   - Blast's 10-stack detonation does 300% modded base to enemies within 5m (not the target)
   - Gas clouds only get headshot *bonuses* (base 1x), Slash ignores armor

Arcanes: one arcane slot per weapon (primary arcanes on rifles, + shotgun arcanes on shotguns, + bow arcanes on bows, secondary, melee).
They go through the same parser as mods. Merciless/Deadhead/Dexterity damage is additive with Serration, Secondary Shiver adds +45% damage
per Cold stack (also additive, direct hits only), Blight/Frostbite/Conjunction Voltage/Cascadia Flare stack per status proc, Primary Acuity /
Cascadia Accuracy weak point crit only counts with Headshot on, Secondary Fortifier is x8 vs overguard. Conditional stacks default to max.

Headshots (wiki Weak_Point): body and head are always calculated side by side.
`head factor = (head multiplier + 1.5 × weak point damage bonuses) × (1 + headshot multiplier bonuses)`, head multiplier 3x on most
factions and ~1.5x on Murmur/Techrot. Weak point damage = Primary/Secondary Acuity, headshot bonuses = Deadhead +30%, Target Acquired +60%.
Headcrits double the weapon's *base* crit multiplier (mods scale it, Cold's flat bonus doesn't) on factions with headcrit heads
(Grineer/Corrupted/Narmer/Anarchs/Scaldra/Infested/Sentient, not most Corpus/Murmur/Techrot). Weak point crit chance (Acuity, Cascadia
Accuracy) only counts on heads. Procs get the full head factor except Gas clouds (only the bonus part). AoE can't headshot.

Incarnon evolutions: `src/data/incarnon.ts` has every Incarnon weapon's Evo II-V perks (46 families, per-variant numbers),
collected by hand from the wiki since warframe-items doesn't have them. `src/calc/incarnon.ts` parses them:
- "+N Base Damage" scales every damage type proportionally before mods, "Base" crit/crit mult/status/multishot add to the weapon's base
- native Incarnons (Felarx, Laetum, Phenmor, Onos, Ruvox, Praedos, Innodem) add plain crit/status chance flat after mods
- mod-like lines (+% Damage, +% Multishot, +% Fire Rate, CO-type per status, +% Headshot Damage) go through the mod parser
- Devouring/Devastating Attrition = 50% chance for +2000% on non-crits (expected value), Latron's Flensing Spikes = 20% armor per Puncture stack
- [Incarnon Form only] / [Normal only] restrict a statement to that attack, untagged applies to both. melee ignores the tags
- conditional parts ("When Channeled Ability active:", "On Kill: ... Stacks up to 4x.") start off, toggle them in the panel

Enemy box: pick a preset, set base level + level (slider) and Steel Path. Health/shields/armor scale with the
Enemy_Level_Scaling curves for the selected faction (smoothstep blend between 70-80 levels over base), armor clamps 200-2700.
Steel Path = +100 levels and x2.5 health/shields (armor isn't multiplied since U36). Shows shots to kill and time to kill from
average damage, toxin skips shields, no overflow from shields into health. "With DoTs" plays the fight out over time (procs tick
as they land, Heat stacks, reloads) and finds when the expected damage reaches the target's health.

Status types for Condition Overload / Galvanized default to the build's own damage types (a weapon with Impact/Puncture/Slash
that's modded into three elements counts 6), switchable to the debuff stacks in the Debuffs panel.
Magazine Capacity / Reload Speed mods are parsed, results show sustained DPS, burst DPS and damage in the first 10 s.

### Damage over time (`src/calc/simulate.ts`)
- Shots go out on the fire rate from t = 0, a full magazine, then a reload. Each status proc ticks on its own clock
  (Slash/Heat/Toxin at 1-6 s, Electricity/Gas at 0-5 s, Blast after a 1.5 s fuse) and only ticks inside the window count,
  so a long Status Duration tail past the end of the fight adds nothing (that's what was inflating Continuous Misery)
- Heat: a new Heat proc refreshes every Heat stack (wiki Heat_Damage, no stack cap), so while Heat procs keep coming within one
  duration the stacks keep ticking and the damage ramps. In the expected value that's assumed when the average gap between Heat procs
  is shorter than the duration
- Sustained DPS = expected damage over a 60 s fight / 60. The old formula (burst x uptime, every tick counted, no Heat stacking)
  is still shown as "if the target never died"
- Ranges: a Monte Carlo (60-300 runs, ~400k pellet rolls) rolls crit tier, status procs and proc type per pellet and gives the
  10th / 90th percentile for 3 / 10 / 30 / 60 s. It's seeded, so the numbers don't jump around between renders
- Shell-by-shell reloads (`src/data/reloads.ts`, wiki Reload_Speed): Felarx, Strun, Mk1-Strun, Strun Prime, Strun Wraith, Corinth, Zarr.
  Reload = (start/end delay + per shell x magazine) / (1 + reload speed), so magazine mods make the reload longer
- Fire rate / attack speed mods get an orange FR tag in the mod browser, the slots and leaderboard builds
Semi-___ Cannonade: semi-auto only and locks fire rate (both read from the mod's description in the data).

Debuffs: every status type has its stack count, plus Heat strip stage, Corrosive Projection auras, other armor strip %, generic vulnerability %, and Roar.
Armor strips multiply: (1 − heat) × (1 − corrosive) × (1 − 18% × auras) × (1 − other). Enemy presets level-scale armor (clamped 200–2700).

`npm run check` tests against the wiki's examples: quantization, Roar + Bane = 477, Roar Slash tick = 78.75, Bleed tick = 297.82, Gas tick = 3699.07, Blast proc = 72.075, Viral ×4.25, armor strip, Cold crit 3.86.

## Melee

Combo slider (1x-12x, Venka Prime 13x, Dex Nikana 11x at 11 hits per tier) and Gladiator pieces on the Warframe show up for melee.
- Combo only multiplies damage on Heavy Attacks and Heavy Slams (wiki Heavy_Attack):
  `[base x (1 + damage mods) x (1 + elemental mods)] x heavy multiplier x combo`, then crits. Bleed from a heavy scales with it too
- The export has no Heavy Attack entry, just `heavyAttackDamage` (= total x the class multiplier) and `windUp`, so build-data adds a
  "Heavy Attack" with the normal attack's damage split scaled up to that. Glaives list it at 1x, so they don't get one
- Blood Rush / Weeping Wounds / Gladiator set: `bonus x (combo - 1)` added in with the other crit/status mods
  (Blood_Rush: 20% x (1 + 1.2 + 0.4 x 3) = 68% at 4x). Applies to every melee attack, not just heavies
- "(x2 for Heavy Attacks)" (True Steel, Sacrificial Steel, Galvanized Steel): heavies get the doubled value instead of the normal
  one, per the Galvanized Steel hotfix (+220%, not +330%)
- Killing Blow / Melee Assimilation "Damage on Heavy Attack" add to damage mods on heavies, Melee Animosity adds heavy crit (420% cap)
- Heavy rate = wind-up / (1 + Wind Up Speed) + one swing at attack speed (Attack_Speed: attack speed doesn't shorten the wind-up)
- Heavy Attack Efficiency keeps that share of the combo count, capped at 90% (40% at 9x leaves 4x), shown as "Combo left"

## Weapon passives

The export only has passives as flavor text, so `src/data/passives.ts` is a hand-kept table: each entry has the weapon(s),
a wiki quote, which attacks it applies to, an optional condition with stacks, and effects from a small set of kinds
(mod-like stat, flat crit/status after mods, per-status-type crit or damage, final crit multiplier, status duration,
"next hit" overrides, multiplicative attack speed, reload/magazine overrides, non-combining element, Harmony detonation).
Chance-based ones are expected values, timed buffs are toggles. Conditional ones start at what the leaderboard assumes.

In the table now: Harmony (heavy detonation + Harmonic Resonance), Cedo, Galariak Prime, Gotva Prime, Sagek Prime, Buzlok,
AX-52, Arca Scisco, Vesper 77, Knell, Sporothrix / Coda Sporothrix, Reconifex, Ekhein, Lesion, Pennant, Slaytra, Dorrclave,
Tonkkatt, Pyrana Prime, Dual Coda Torxica, plus Tekko / Alternox / Epitaph signature bonuses (off on the leaderboard).

- Kuva / Tenet / Coda bonus element: pick the element and 25-60%. It's added as an innate element worth that share of base damage,
  so it combines after the elemental mods. The leaderboard tries all 7 at 60% and keeps the best
- Status Duration (mods like Lingering Torment, Slaytra, Harmonic Resonance) adds DoT ticks at one per second: floor(6 x (1 + duration))
- Harmony: the heavy's own procs land all their ticks at once (same total, just sooner), stacks already on the target (Debuffs panel)
  detonate too, counted at Normal Attack strength
- Covered by the attack list instead: Kuva Kohm (Fully Spooled), Nataruk (Perfect Shot)
- Not in the table: signature bonuses that aren't damage (ammo, reload on headshot...), Thalys shards, Catabolyst grenade scaling,
  Vadarya chain lightning, Arca Titron, Lesion-style effects whose numbers the wiki doesn't give

## Conditional stacks (`triggerUptime` in src/calc/parseMod.ts)

What the leaderboard (and a freshly equipped mod/arcane) assumes for "On X:" bonuses:
- most triggers (On Kill, On Status Effect...) at max stacks
- headshot / weak point *hit* triggers (Primary Crux, Longbow Sharpshot) off, since the scenario is body shots.
  Headshot *kill* triggers (Primary/Secondary Deadhead) stay on, the buff works on every shot once it's up
- melee-kill triggers on a gun (Primary/Secondary Dexterity) at half: you have to swap to melee and kill to keep them up
- Primary Bulwark (+1% damage per armor past 1,000, max +500%) at half (+250%), it needs a tank frame. In the calculator
  its stacks are armor points over 1,000, so type your Warframe's armor minus 1,000
- ties between arcanes go to the one with headshot / reload value on top (Deadhead's +30% headshot multiplier,
  Merciless's +30% reload), so with all three at +360%: Deadhead for single hits, Merciless for DPS, Dexterity never

## Added elements and guaranteed procs

Elements that get added on top of the weapon's own (Melee Exposure's Corrosive, Tonkkatt's Heat, Lesion's Toxin) add damage but
don't combine with other elements and take no share of the status procs. So they don't dilute your procs, but they don't proc
on their own either: you still need status chance and your own elements for procs. Effects with a guaranteed proc
(Reconifex's perfect-reload Heat rounds) add that proc to every hit on top of the status chance rolls.

## Warframe panel

Pick a Warframe (`src/data/warframes.json` from the export: base armor/energy/shields, slot + aura polarities) and mod it like
the in-game screen: 2x4 grid, aura slot, exilus slot (Jade has two aura slots), Orokin Reactor, capacity with aura bonus
(matching polarity x2, mismatch -20%). Only that frame's augments show up. From the equipped mods (`src/calc/warframeStats.ts`):
- Ability Strength: 100% + "+X% Ability Strength" mods (Intensify, Blind Rage, Transient Fortitude...), Growing Power assumed up,
  Power Donation -30%, plus an "Extra Ability Strength %" box for Archon Shards / arcanes
- armor: base x (1 + armor mods) + extra flat armor. Feeds Primary Bulwark (0 = use the arcane's own stack setting)
- squad auras that buff weapons, added in with damage mods: Steel Charge (melee), Rifle Amp (every non-shotgun primary),
  Dead Eye (snipers), Pistol Amp, Shotgun Amp; Worthy Comradery (weak point crit chance); Corrosive Projection adds to the
  Debuffs panel's count (max 4)
- Gladiator pieces on the Warframe

Abilities (`src/data/warframeAbilities.ts`), max-rank wiki values x Ability Strength (linear): your frame's own abilities use your
strength, the others count as a teammate's and use "Teammate strength %". Passives (Excalibur's) only work on that frame.
- Roar (Rhino) +50% faction damage, additive with banes, counts twice on status ticks
- Solar Eclipse (Mirage) x(1 + 200%), its own multiplier, not multiplied into additive Condition Overload
- Vex Armor (Chroma) +275% Fury, added in with Serration
- Xata's Whisper (Xaku) 26% of the weapon's damage as a separate Void hit (mods, crit, faction x2), its Void procs not modeled
- Nourish (Grendel) +75% Viral, like a Viral mod
- Freeze Force (Frost) +100% Cold, Electric Shield (Volt, guns, no strength scaling) +50% Electricity: don't combine, do proc;
  Electric Shield also doubles crit damage
- Warcry (Valkyr) +50% attack speed, Wrathful Advance (Kullervo) +200% crit after mods, Excalibur passive +10% damage / attack speed
The leaderboard scenario has no Warframe, so none of this changes the rankings.

Debuffs: every status has a stack count up to its cap. Slash/Heat/Toxin/Electricity have no cap (the box goes to 999), so
Harmony can detonate 100 Heat stacks. "Max all" puts the uncapped ones at 10.

## Mod restrictions

`src/calc/modConflicts.ts`, used by both the mod browser (blocked mods show greyed out with "Incompatible with X", an equipped
pair that conflicts gets a red outline) and the optimizer. The export has no incompatibility field, so:
1. same name
2. same internal mod: Primed / Galvanized / Spectral copies reuse the base mod's path with a suffix
   (Hell's Chamber `Shotgun/WeaponFireIterationsMod`, Galvanized Hell `Shotgun/WeaponFireIterationsSPMod`), plus "Primed X" vs "X"
3. `INCOMPATIBLE_GROUPS`, copied from the "Incompatible Mods" infobox on each mod's wiki page, for pairs the paths don't show:
   Galvanized Shot / Sure Shot, Galvanized Aptitude / Rifle Aptitude, the Serration family (Spectral, Amalgam, Higasa),
   the True Steel family (Sacrificial, Galvanized, Amalgam Ripkas), Pressure Point family, Fury / Berserker Fury,
   corrupted crit mods vs their normal one (Critical Delay / Point Strike, Creeping Bullseye / Pistol Gambit,
   Critical Deceleration / Blunderbuss), Split Flights / Split Chamber, and the Amalgam mods vs their source mod

`npm run check` tests the pairs both ways (blocked and allowed, e.g. Primed Chamber + Charged Chamber is fine per the wiki).

## Leaderboard

The page has two tabs: Calculator and Leaderboard. The leaderboard is precomputed, the site never runs the optimizer:
`npm run leaderboard` runs `scripts/build-leaderboard.ts`, which optimizes every weapon attack for every ranking and writes
`public/leaderboard.json` (committed, fetched only when the tab opens). After a data update: `npm run leaderboard`, then deploy.

Every attack (component) of every weapon gets its own listing (Normal Attack, Slam, Heavy Slam, Heavy Attack, alt-fire,
Incarnon form...), each optimized on its own. "Best attack per weapon only" collapses it back to one row per weapon.

One leaderboard, ranked by a setting (`src/optimizer/objectives.ts`, each one optimized separately):
- Sustained DPS: average over a 60 s fight (see Damage over time above)
- Damage in a time window (3 / 10 / 30 s): simulates shots from t = 0 with reloads, DoTs count the part that fits in the window
- Single damage instance: one hit of one projectile / one melee swing, crits averaged, no DoTs

The DPS-type rankings are optimized twice, with and without fire rate / attack speed mods (and arcanes), switched by "Allow fire rate
mods". If the search happens to find a better build without them, that build is used for the "allowed" board too.

Settings on the page: Rank by, time window, Primary/Secondary/Melee, search, "Allow fire rate mods" and "Include Incarnon forms". Incarnon forms run on
Incarnon charge which isn't in the data, so they never reload here, which is why they can be toggled off.

- Scenario (`src/optimizer/scenario.ts`): no faction, no armor, body shots, conditionals at max stacks with exceptions
  (`triggerUptime` in `src/calc/parseMod.ts`): headshot-hit triggers (Crux, Sharpshot) off, headshot-kill triggers (Deadhead) on,
  melee kills on a gun (Dexterity) and armor thresholds (Bulwark, +1%/armor past 1,000) at half. When two arcanes tie, the one with
  headshot multiplier / reload speed wins (reload counts half for single hit), so Deadhead and Merciless beat Dexterity,
  Condition Overload/Galvanized count only the build's own damage types (base physical + modded elements), capacity ignored, no rivens,
  melee at max combo. Heavy attacks/heavy slams only compete in Single damage instance, since they spend the combo they need
- Search (`src/optimizer/optimize.ts`): mod pool = compatible mods with an effect that can raise that ranking (`modPool.ts`, fire rate /
  magazine / reload only for the DPS-type rankings), beam search over 8 slots (width 8), single-mod swaps, best Incarnon perk per tier,
  best arcane, elemental slot order. Heuristic, so check odd results in the calculator ("Load build" applies the scenario too)
- Conflicts: same rules as the mod browser, see Mod restrictions below
- Not optimized: Exilus slot, polarities/capacity. Event-only attacks (reload explosions, turret expiry) are skipped
- Each attack is scored on its own (an impact + its explosion aren't summed). Incarnon forms count as 1 projectile. Charged attacks use
  `1 / (charge time + 1 / fire rate)`
- Not moddable weapons (anything outside LongGuns/Pistols/Melee in the data, e.g. the Drifter's Sirocco) are excluded entirely

## Layout

```
scripts/build-data.mjs    trims warframe-items to weapons/mods/arcanes/enemies JSON
scripts/check-calc.ts     wiki example checks
src/calc/constants.ts     faction table, status effects, DoT fractions
src/calc/parseMod.ts      stat lines -> effects, incl. "On Kill: ... Stacks up to 5x"
src/calc/damage.ts        the pipeline above
src/calc/target.ts        health/shield/armor level scaling, Steel Path, armor strip, armor DR
src/calc/kill.ts          shots / time to kill
src/calc/capacity.ts      mod drain + capacity (polarity match halves, mismatch +25%, both rounded up)
src/optimizer/            leaderboard scenario, objectives, mod pool + conflicts, beam search optimizer
scripts/build-leaderboard.ts  runs the optimizer on every attack across CPU cores, writes public/leaderboard.json
src/App.tsx               Calculator / Leaderboard tabs. src/Calculator.tsx is the calculator page
src/components/           Weapon/Mod/Target/Debuffs/Stats/Leaderboard panels. ModSlots is the in-game style 2x4 grid + exilus
```

## Data quirks I've hit

- Top-level `damage` on weapons has slash/puncture swapped sometimes, so I read `attacks[].damage` instead
- The export has unreleased `/Expert/` copies of normal mods that reuse the name (a 10-rank "Point Strike" at +275%). build-data drops /Expert/ copies when a regular version exists (unless they're "Primed ..."), plus Galvanized "SubMod" duplicates
- Primaries are split into Rifle/Sniper/Launcher/Bow/Shotgun types, so weapons are kept by category. Sniper/Bow/Assault Rifle mods only show for those types
- Primed Bane mods aren't in the export under their own name, so only regular Banes show up
- Weapon exilus mods are flagged `isUtility` in the export, not `isExilus`
- `heavyAttackDamage` isn't consistent between classes. Checked against the per-hit "Stanceless Combos" Heavy row on each class's
  wiki page: Heavy Scythes / Sun & Moon list every hit added up (18x = 3 x 200% + 2 x 600%), Assault Saws / Two-Handed Nikanas
  only the first part, Daggers / Tonfas / Warfans / Sparring neither. The wiki's Weapon Comparison "Heavy" column is the same
  number as the export, so it's no independent check. In-game, Coda Hirudo's arsenal shows 500% + 5 x 300% (first hit 1,375
  = 5x of 274.9 with 57.1% Heat), not the wiki's Sparring row or the export's 6.5x

## Multi-hit heavy attacks (`src/data/heavyAttacks.ts`)

12 classes hit more than once on a heavy (Heavy Scythe, Assault Saw, Blade and Whip, Dagger, Dual Daggers, Dual Nikanas,
Dual Swords, Machete, Sparring, Tonfa, Two-Handed Nikana, Warfan). Their hit lists come from the class pages, with in-game
arsenal readings overriding them per weapon (Coda Hirudo so far). The calc rescales the Heavy Attack from the hit list:
- default / leaderboard: the biggest single hit (one damage instance)
- "Full heavy (all hits)" in the calculator, "Count the full heavy" on the leaderboard: every hit added up, all at the current combo
- forced procs per hit (Bleed, Puncture, Lifted...) are listed in the breakdowns but not added to the damage
- the calculator's results and each leaderboard row show the hit-by-hit damage (click "Multi-hit heavy" on a row)
Classes not in the table hit once and keep the export's number
- Some weapon base damage doesn't match in game, e.g. Cernos Prime charged shot is 165.6 impact in the export but 289.8 in the arsenal
- Enemy health/armor types in the export are pre-Update 36, so only base stats + faction are used

## Assumptions to double check

- Puncture (+5%/stack) and Tau (+10%/stack) are added flat after mods
- Faction weaknesses apply to shields, not overguard
- Heat/Toxin/Electricity/Gas ticks are reduced by armor (the wiki pages don't say either way)
- Heat stacks tick on their own 1 s clocks here, in game they merge into one tick per second (same total, slightly different timing)
- Incarnon forms never reload (Felarx's form has its own 60-round pool that mods don't touch, the others' charge isn't in the data)
- Head multiplier/headcrit defaults are per faction, specific enemies differ (Juggernaut 4x, Ropalolyst 0.2x, armored heads),
  override them in the target panel
- Incarnon Genesis per-status bonuses aren't in the data (Cedo's +60%/status is in the passives table)

- Incarnon data: Burston Prime uses Burston's numbers and Soma Prime uses Soma's (their tables didn't come through),
  Untagged base damage perks are assumed to apply to the Incarnon form too
- Incarnon perks not modeled: Munitions Grit's multishot-projectile bonus, High Ground / Wiseman's Regard conversions,
  King's Gambit, Kinetic Killer, "Base Status Chance set to X", plus all utility perks (shown greyed out)

## Not modeled yet

- Rivens, bow ×2 fire rate
- Melee: slide attacks (Maiming Strike), Slam Damage multiplier, the class-specific heavy splits (Nikana heavies being pure bleed,
  Dagger 250% impact + 250% bleed, ...), combo duration / initial combo / combo count chance, Tennokai, a heavy-attack DPS loop
  that rebuilds combo between heavies
- Arcanes that aren't stat lines: Cascadia Empowered (+750 flat per proc), Secondary Encumber/Enervate/Surge/Kinship/Outburst,
  Melee Duplicate/Doughty/Retaliation, Primary Plated Round, Longbow Sharpshot treated as additive damage (unverified)
- Electricity chain and Blast/Gas AoE on other enemies
