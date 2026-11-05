# Verbose Spork Warframe Analysis
calculator and analysis for warframe (repo: verbose-spork-wf-calc)

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

Wiki data: `python3 scripts/pull-wiki-data.py` (needs `pip install lupa`) runs the wiki's Module:Weapons/data and
Module:Enemies/data Lua tables and saves `scripts/wiki-weapons.json` / `scripts/wiki-enemies.json` (committed, build-data reads
them). `node scripts/compare-wiki-data.mjs` lists every attack whose damage / crit / status / fire rate differs from the wiki.

## Tabs

- **Calculator**: one weapon attack vs one target, with your Warframe, debuffs, buffs, a riven and the damage math written out
  (FormulaPanel). The Build Advisor under it says what each stat is worth to the build right now and which mod gets it cheapest
- **Leaderboard**: precomputed best builds for every weapon attack, plus Boss time-to-kill boards (see Leaderboard)
- **Compare** (two pages):
  - **Build Paths**: one weapon, 2-4 build paths with their own rules (lock mods in/out, arcane, Incarnon perks, crit limits,
  a riven), each optimized and shown side by side. Runs in a worker, never writes to the leaderboard
  - **Weapons**: two weapons of one category, base stats with where each sits in its category (evolved Incarnon numbers),
  and what the leaderboard's best builds do with them
- **Rivens**: roll ranges per stat and layout, why some stats suit the weapon, and a god-roll search (the optimizer rebuilt
  around each candidate riven)
- **Damage Cap**: can one hit pass the 32-bit damage limit, and what it takes. A ladder of layers (mods, headshot, solo priming,
  Warframe arcanes, shards, your frame, enemy debuffs, allies), each optimized for the biggest single instance
- **⚠ Experimental** (two pages, flagged as leaning on more guesses):
  - **Ability Damage**: Warframe ability damage side by side against a real target (see Ability damage)
  - **Data Analysis**: the whole arsenal in graphs. An Attack switch at the top swaps every section (except Enervate) between Normal fire, Normal + Incarnon (Incarnon form where a weapon has one),
    Alt-fire & special (other fire modes, glaive throws, ranged melee attacks; the hardest-hitting one per weapon), Incarnon form
    and Melee heavy, and filters the leaderboard rows the same way (Normal fire = best non-Incarnon build). Slams aren't counted. Incarnon weapons' base stats include the evolutions the leaderboard picked for
    that attack (base-stat lines only: +base damage / crit / status / multiplier, "set to", native flat crit/status; conditionals at
    scenario stacks), and every dot's tooltip lists those evolutions. The leaderboard only stores tiers that change damage. Average/median crit, crit multiplier, status and base damage per
    category, crit and status histograms, a crit-vs-status scatter; a per-subtype breakdown
    (gun types plus spearguns, melee by wiki class: table of medians and median leaderboard score, then a picked subtype's
    histograms, scatter, top weapons and most picked mods/arcanes); the leaderboard section filters by subtype too; how much crit Secondary
    Enervate really gives by base crit, no other crit mods (the calc's own cycle average: ~103% at 0% base, ~133% at 60%),
    against Primed Pistol Gambit, Creeping Bullseye and Gambit + Galvanized Crosshairs; base stats
    by release update (wiki "Introduced", bucketed by 5 updates); what a Prime changes over the original; and what the
    leaderboard's best builds pick (mods, arcanes, damage mix, Incarnon share, and how well each base stat predicts the
    score, as a Spearman rank correlation). Charts are hand-rolled SVG (src/components/charts.tsx), no chart library
- **Status Guide**: how each status scales and what it does, with the numbers the calc uses
- **About**: empty for now

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
- conditional parts ("When Channeled Ability active:", "On Kill: ... Stacks up to 4x.") start where the leaderboard has them
  (`scenarioPerkStacks` in src/calc/incarnon.ts), change them in the panel:
  - the same rules as mod conditionals (max stacks, headshot hits off on body shots, kills off on the boss board), so Riddled
    Target sits at 4 (+100% multishot), Furis's Stormburst at 3 (+1.2 base multishot), Haven Foray's Overshield +30 on, Daring
    Reverie's channeled +38 on
  - off when the scenario can't meet it: another weapon equipped (Stalker's perks), crowds / range (within 6 m), a hurt or fresh
    target (below half health, undamaged, fewer than 3 statuses)
  - status triggers ("On Puncture Status Effect", "On hitting Electricity-affected enemies") switch back off when the build never
    applies that status: Stormburst does nothing on a Furis with no Electricity
  - Prelude of Might's "When Critical Chance below 40%" is checked against the build's final crit chance

Enemy box: pick a preset (its wiki base level fills in), set base level + level (slider) and Steel Path. Health/shields/armor scale with the
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
  "Heavy Attack" with the normal attack's damage split scaled up to that. Glaives list it at 1x, so they don't get one (their heavy
  is the detonation, see Glaives)
- Blood Rush / Weeping Wounds / Gladiator set: `bonus x (combo - 1)` added in with the other crit/status mods
  (Blood_Rush: 20% x (1 + 1.2 + 0.4 x 3) = 68% at 4x). Applies to every melee attack, not just heavies
- "(x2 for Heavy Attacks)" (True Steel, Sacrificial Steel, Galvanized Steel): heavies get the doubled value instead of the normal
  one, per the Galvanized Steel hotfix (+220%, not +330%)
- Killing Blow / Melee Assimilation "Damage on Heavy Attack" add to damage mods on heavies, Melee Animosity adds heavy crit (420% cap)
- Heavy rate = wind-up / (1 + Wind Up Speed) + one swing at attack speed (Attack_Speed: attack speed doesn't shorten the wind-up)
- Heavy Attack Efficiency keeps that share of the combo count, capped at 90% (40% at 9x leaves 4x), shown as "Combo left"
- Slams: Seismic Wave "+200% Slam Attack Damage" is its own multiplier on Slam / Heavy Slam (wiki: "multiplicative to base damage")
- Melee Duplicate: a crit strikes a second time (separate damage instance, rerolls crit + status, forced procs come along). Counted as
  `1 + min(1, crit chance) x 100%` strikes per attack: in DPS, procs and Whole attack, not in the single-hit number

### Glaives (detonation = heavy attack)

- A Heavy Attack while the glaive is in flight detonates it, "an explosion that deals Heavy Attack damage" (wiki Heavy_Attack). That's
  the export's (Charged) Throw Recall Explosion rows, so build-data marks them `heavy`: x combo, Killing Blow, True Steel family x2,
  Melee Animosity. No wind-up ("the Heavy attack input does not initiate an attack animation")
- Forced procs per glaive from each wiki page's Recall Explosion row (`GLAIVE_DETONATION_PROCS` in build-data): Glaive Prime Impact +
  Slash, Cerata Toxin + Impact, Xoris Impact + Electricity, Pathocysts Impact + Viral, Orvius Cold, Falcor Electricity, the rest Impact.
  Glaive Prime's forced Slash is most of its damage (the overframe detonation guide says the same)
- CO doesn't apply ("Condition Overload does not affect the explosion"), headshot x1 (AoE)
- Thrown Melee mods now fit glaives (the export has no melee class, so the glaive list in build-data decides; Daggers go by path).
  Power Throw: +100% x 3 stacks, its own multiplier (wiki: multiplicative with Pressure Point) on the throw itself. The wiki doesn't
  say it reaches the explosion, so it doesn't here
- Not modeled: the explosion hitting a whole group (one target only), Volatile bounce explosions as a rotation, Corrupt Charge /
  initial combo (the scenario sits at 12x anyway)

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
- Incarnon perk conditions too, with a few extra rules (see the Incarnon section above)
- Secondary Outburst at the full 12x (Crescendo builds)
- headshot / weak point *hit* triggers (Primary Crux, Longbow Sharpshot) off, since the scenario is body shots (on for guns on
  the Single damage instance board, which is headshots).
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
(matching polarity x2, mismatch -20%). Only that frame's augments show up, plus the augments of a subsumed ability (picked by the
"<Ability> Augment:" text). The mod search only opens when you click a slot (click it again, Close or Esc to hide it). From the equipped mods (`src/calc/warframeStats.ts`):
- Ability Strength: 100% + "+X% Ability Strength" mods (Intensify, Blind Rage, Transient Fortitude...), Growing Power assumed up,
  Power Donation -30%, plus an "Extra Ability Strength %" box for Archon Shards / arcanes
- armor: base x (1 + armor mods) + extra flat armor. Feeds Primary Bulwark (0 = use the arcane's own stack setting)
- squad auras that buff weapons, added in with damage mods: Steel Charge (melee), Rifle Amp (every non-shotgun primary),
  Dead Eye (snipers), Pistol Amp, Shotgun Amp; Worthy Comradery (weak point crit chance); Corrosive Projection adds to the
  Debuffs panel's count (max 4)
- Gladiator pieces on the Warframe

Under the mods: the frame's 4 abilities (names/descriptions from the export) and its passive. Any one slot can be swapped for a
Helminth ability (each frame's "Subsumable to Helminth" ability, `SUBSUMABLE`, plus the Helminth's own). Damage buffs (Roar,
Eclipse, Xata's Whisper) only go on frames that already have one, replacing that one (Roar wiki: "Subsumed Roar can only replace
Vex Armor, Resupply, Eclipse, Amp, ..."). Then "Allies' abilities": a dropdown that adds abilities cast by a teammate.

Abilities (`src/data/warframeAbilities.ts`), max-rank wiki values x Ability Strength (linear): your own and your subsumed ability use
your strength (so your Warframe mods scale them), allies' use "Ally strength %". Subsumed ones use the Helminth value where the wiki
gives one: Roar 30%, Eclipse 30%, Nourish 45% Viral, Warcry 30%, Wrathful Advance 100%. Freeze Force needs the augment equipped
when it's yours. Passives (Excalibur's) only work on that frame.
- Roar (Rhino) +50% faction damage, additive with banes, counts twice on status ticks
- Solar Eclipse (Mirage) x(1 + 200%), its own multiplier, not multiplied into additive Condition Overload
- Vex Armor (Chroma) +275% Fury, added in with Serration
- Xata's Whisper (Xaku) 26% of the weapon's damage as a separate Void hit (mods, crit, faction x2), its Void procs not modeled
- Nourish (Grendel) +75% Viral, like a Viral mod
- Freeze Force (Frost) +100% Cold, Electric Shield (Volt, guns, no strength scaling) +50% Electricity: don't combine, do proc;
  Electric Shield also doubles crit damage
- Warcry (Valkyr) +50% attack speed, Wrathful Advance (Kullervo) +200% crit after mods, Excalibur passive +10% damage / attack speed
The leaderboard scenario has no Warframe, so none of this changes the rankings.

Warframe arcanes: two slots under the mod grid (the same arcane can't go in twice). Their weapon lines count only on the
weapon type they name ("to Melee Weapons", "to Pistols", "on Secondary Weapon", "(Excludes Shotguns)"...), the
"21% chance for" part is the slot's on/off stack. Arcane Avenger is flat crit after mods (wiki: "adds 45 percentage points to a
weapon's critical chance after other bonuses"). Their Warframe lines (Arcane Guardian +900 armor, Molt Augmented strength,
Arcane Blessing health, Double Back damage resistance) feed the frame's stats.

Survivability (`warframeTotals`): health / shields / armor from base x (1 + % mods + % from abilities) + flat (arcanes, extra
armor). Abilities that add defense: Warcry +50% armor (wiki: "Base Armor x (1 + Armor Mods + Warcry Modifier x (1 + Strength
Mods))", allies too), Vex Armor's Scorn +350%, Elemental Ward (Cold) +145%, Null Star (particles = 12 x Ability Duration, each 5% x
Strength, cap 90%, 75% subsumed, only Nova), Immolation at max heat (85% x Strength, cap 90%), Ash's passive (Slash procs +25%
damage, +50% duration). Damage reduction: armor / (armor + 300) on health only, shields' innate 50% (toggle, from the wiki's example), Null Star,
Adaptation, Double Back and an "Other DR %" box, all multiplied together ("Sources of damage reduction (including armor) stack
multiplicatively with each other"). Effective health = health / (1 - health DR) + shields / (1 - shield DR).

Damage augments (each needs its mod equipped when it's your own frame; allies are assumed to have it): Fireball Frenzy, Shock
Trooper, Smite Infusion, Venom Dose (+100% element x strength, added parallel to your elements and not merged, takes its share of the procs, also boosts
that element's DoT; Smite Infusion wiki example: 100 Impact + Hellfire + 110% strength = 100 Impact / 90 Heat / 110 Radiation, procs
100/300, 90/300, 110/300). Shock Trooper is the exception: its Electricity takes no proc share and every hit forces an Electricity
proc instead. The same buff twice doesn't stack, only the strongest counts, Thermal Transfer (pick the cast on the card: hold = +75% Heat,
tap = +75% Cold, both = Blast "equaling the sum" = +150%; x strength, doesn't combine, Heat/Cold also boost their DoTs like a mod),
Biting Frost (+200% crit chance / +100% crit damage on frozen targets), Empowered Quiver (+100% crit damage), Smoke Shadow (+150%
crit chance), Teeming Virulence (+200% crit chance, primaries), Thrall Pact (+25% primary damage per Thrall). The crit ones are
added in with crit mods since the wiki doesn't say how they stack.

"This build assumes" (red, under the results): every conditional the numbers lean on. Mod/arcane triggers with their stacks
(Galvanized "on Kill", Deadhead "on Weak Point Kill", Bulwark's armor), weapon passive and Incarnon conditions, each Warframe
ability/augment that has to be up (and its condition: frozen target, invisible, standing in a Dashwire...), the combo when
something reads it, headshots, and the status types CO-style mods count.

Mod sets (`src/calc/modSets.ts`, set text from the export in `src/data/modSets.json`): pieces count across the Warframe and the
weapon in the calculator (companion and other weapons aren't modeled). In the numbers:
- Umbral: "Enhance mods in this set", Fiber/Vitality +30% / +80% of their values with 2 / 3 pieces, Intensify +25% / +75%
- Sacrificial: both pieces = +25% of all stats (Steel +275% crit, Pressure +137.5%, x1.4125 Sentients)
- Gladiator: frame pieces counted automatically now (the manual box is gone)
- Vigilante: 5% per piece to enhance a primary crit by one tier, i.e. + chance x min(1, crit chance) effective crit chance
- Nira's: +150% slam damage per piece, added with Seismic Wave
The rest (Augur, Boreal, Proton, companion sets...) are listed with their text but don't change weapon damage.

Weapon augments the normal stat patterns can't read have a rule each in `src/calc/specialLines.ts` (values read from the line, so
ranks scale): Biotic Rounds, Leaded Gas, Burning Hate, Clip Delegation, Combat Reload, Critical Mutation, Critical Precision, Deadly
Maneuvers, Double Tap (20 stacks of +20% next shot), Dreadful Killshot (stacks from the Warframe panel's health), Entropy Burst /
Napalm Grenades (final status chance), Exposing Harpoon, Eximus Advantage, Flux Overdrive (the middle of its range), Hata-Satya
(100 hits = half a magazine), Necrophagic Vigor, Range Advantage, Sentient Surge (3 Tendrils assumed), Spring-Loaded Broadhead,
Unseen Dread, Prototype Shock Coils (+20% Electricity proc chance), Lasting Purity, Volatile Variant, Precision Strike. Pure
utility lines (ammo, accuracy, projectile speed, punch through...) are dropped. Stance-class mods (Whips, Polearms, Dual Daggers,
Thrown) now show up on those weapons, and weapon-named augments go on their weapon whatever type the export files them under
(Range Advantage on the Akjagara and Clip Delegation on the Sobek are "Primary Mods"). Still not in the numbers: on-death explosions (Acid Shells, Vulcan Blitz...), Sentient
Incision, Static Discharge, alt-fire modes (Wild Frenzy, Spontaneous Singularity, Vile Discharge), Meticulous Aim's body shot penalty.

More ability buffs (each frame's Abilities wiki page): Prismatic Gem (Citrine, +100% status chance and duration), Resupply (Cyte-09,
pick the element on the card: an extra hit of it worth 25% x strength, 50% on snipers, with its forced proc), Seek (+75% weak point
damage), Deathbringer (Jade, +100% like Serration), Ripper's Wail (Temple, +75% Heat + 5% per Backbeat hit up to 750%, doesn't
combine), Silken Stride (Oraxia, 40% / 80% wall latched Toxin extra hit, 100% status), Demonium (Uriel, 30% Heat extra hit with
forced Heat, +30% fire rate), Narin's passive (50% Cold extra hit with forced Cold), Petrify (+50% damage vulnerability), Ensnare
(Whipclaw x2). Synergies: Hysteria triples Warcry's armor ("Warcry's armor bonus is multiplied by 3x when used while Hysteria is
active"), on automatically when the weapon is Valkyr Talons.

Exalted weapons (`src/data/exalted.ts`): the export's Misc list has them with max-rank base numbers, build-data turns the primary /
secondary / melee ones into weapons (archgun / archmelee ones left out). Exalted Blade, Valkyr Talons, Iron Staff, Desert Wind,
Shadow Claws, Diwata, Dex Pixia, Artemis Bow (7 arrows), Balefire Charger, Noctua, Glory: base damage x your Ability Strength.
Regulators: innate +150% x strength in with Hornet Strike, plus the x2.5 Peacemaker ramp (a requirement). Neutralizer: +25% x
strength in with Serration. Pseudo-exalted (Shattered Lash, Landslide, Whipclaw, Blade Storm's Shadow Clones): base x strength,
"+1x damage per combo multiplier" on every hit, no attack speed (Casting Speed instead), no blocking/heavy/finisher mods. Blade
Storm has no numbers in the export: 1,500 Finisher (True) per hit with a guaranteed Bleed, from the wiki. Garuda's Talons are her
innate claws, a normal weapon. The hold-to-cast elemental augments and Thermal Transfer don't apply to exalted weapons. Noctua's Active Attack needs a full
meter (60 s, -1 s per primary hit), so it's one every 24 s while firing. Not modeled:
Desert Wind's waves, Noctua's fragments, Chromatic Blade, Glory's alt-fire exceptions, Mass Vitrify/Splinter
Storm with Shattered Lash.

Every box on the calculator folds up: click its title.

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

The leaderboard is precomputed, the site never runs the optimizer: `npm run leaderboard` runs `scripts/build-leaderboard.ts`,
which optimizes every weapon attack for every ranking and writes `public/leaderboard.json` (committed, fetched only when the tab
opens). After a data update: `npm run leaderboard`, then deploy.

Rebuilds are incremental (`scripts/leaderboardFingerprint.ts`): one engine hash over the shared code (damage formula, optimizer,
scenario, stances, weapon classes) and one hash per weapon over what the per-item lookups *return* for it (its mods, passives,
Incarnon perks, heavy combo...). Engine change = full rebuild, a fixed augment only reruns the weapons that can equip it.
Comment-only edits don't count. Flags: `--dry` (just say what's stale), `--only=<names>`, `--all`, `--boards=<keys>` (only re-optimize those boards, e.g. `single`; the rest are kept from the old file), `--adopt` (stamp fingerprints without rerunning), `--boss`.

Boss time-to-kill boards (`src/optimizer/bossLeaderboard.ts`, `--boss` into `public/boss-leaderboard.json`): each build is
optimized to kill one Steel Path hardmode boss solo as fast as it can, ranked by seconds (stored as 1 / seconds):
- Janus Captain Vor: wiki "Health = 7500, Shield = 2750, Armor = 250", "SpawnLevel = 375", Grineer, "Solo: 1x health", and
  "immune to armor reduction" (Heat, Corrosive, auras, Flensing Spikes do nothing). Level 375 with Steel Path's x2.5: 942k shields,
  14.3M health, 2,700 armor
- The Fragmented One: "Health = 50000", "SpawnLevel = 225" solo, The Murmur, "Viral damage resistance and immunity to Viral
  status", plus Update 40's "Steel Path / Deep Archimedea base health bonus: 150,000": 80.8M health, no shields or armor
- damage attenuation (`attenuatedTimeToKill` in src/calc/simulate.ts), the wiki's two-layer model (Necramite / Archon "Damage
  Resistance Logic"): each trigger is Reinhard-mapped, MDPT x DPT / (DPT + MDPT), then a bucket follows the last 1 s of damage and
  decays toward it with lambda = 2/3, and damage is scaled by MDPS / bucket while the bucket is over MDPS. Update 40 made the caps
  "proportional to Max Health" but no hardmode boss has published numbers, so both use Hemocyte's (the only post-rework ones on the
  wiki): MDPT = 5% of max health, MDPS = 20% of max health. A guess, `BOSS_ATTENUATION` in bossLeaderboard.ts. It puts a floor of
  ~5 s on any boss's health. The search uses a quick estimate (each layer at least pool / min(MDPS, mapped burst) x uptime), the
  picked build is then timed on the full bucket model
- time to kill = time to strip the shields (shield-layer damage) + time to deal the health, each off the expected damage over time
  (reloads, Incarnon refills, DoT ticks as they land), found by a few secant steps and a short bisection over the killing shot.
  Past 10 minutes it's extrapolated ("10+ min" on the page) so weak builds still give the search a slope
- status capped at 4 stacks a type, on-kill conditionals off, Devouring Attrition off, gauge-gated alt-fires left out, heavies left
  out, body shots
- not modeled: invulnerable phases (Vor's shielded phases and turrets), adds, movement

Every attack (component) of every weapon gets its own listing (Normal Attack, Slam, Heavy Slam, Heavy Attack, alt-fire,
Incarnon form...), each optimized on its own. "Best attack per weapon only" collapses it back to one row per weapon.

Attack-type filter (`src/optimizer/attackKinds.ts`, chips on the page, double-click one to show only it): melee normal attacks,
heavy attacks (incl. glaive detonations), slams (incl. heavy slams), throws / other melee, gun primary fire, alt-fire, explosions / AoE (the data's AoE flag
or an explosion-style name), Incarnon forms. The export has no attack-type field, so alt-fire is guessed from the name; anything
on a gun that isn't recognised counts as primary fire. The filter applies before ranking, so #1 is the best of the picked types.

One leaderboard, ranked by a setting (`src/optimizer/objectives.ts`, each one optimized separately):
- Sustained DPS: average over a 60 s fight (see Damage over time above)
- Damage in a time window (3 / 10 / 30 s): simulates shots from t = 0 with reloads, DoTs count the part that fits in the window
- Single damage instance: one hit of one projectile / one melee swing, crits averaged, no DoTs. Guns score it on headshots
  (weak point mods, Acuity and headshot-hit triggers in play; AoE can't headshot), melee stays on body hits
- Whole attack (hit + procs): everything one attack does to one target, every pellet / Melee Duplicate strike plus the full DoT of
  each proc it lands (forced ones included). Made for heavies and glaive detonations, which live on their procs

The DPS-type rankings are optimized twice, with and without fire rate / attack speed mods (and arcanes), switched by "Allow fire rate
mods". If the search happens to find a better build without them, that build is used for the "allowed" board too.

Settings on the page: Rank by, time window (3 s by default, the burst ranking), Primary/Secondary/Melee, search, "Allow fire rate
mods" and "Include Incarnon forms".

Incarnon forms run on their charges, then have to be earned back (`incarnonRefill` in build-data, damage.ts):
- each Genesis page: "each charge producing N rounds to a maximum of M" per weak point hit (Vasto 3 to 24 = 8 hits, Onos 30 to
  350, Torid / Angstrum count direct hits), "Individual Multishot bullets can build charges"
- refill time = hits / the normal form's hit rate (its fire rate with the same fire rate mods x its projectiles, its own magazine and
  reloads included), every normal shot assumed to land on a weak point, Incarnon Efficiency's +50% charge counted
- plus switching both ways, each 2x the base reload (`INCARNON_SWAP_RELOADS` in damage.ts). The Genesis pages say "Mode switching
  is not instantaneous and has an animation equal to the weapon's reload speed", but in game the swap runs longer than a reload,
  and no page gives a timing, so 2x is my call until there's a measured number. Reload mods don't shorten it (Phenmor's reload
  perk "Does not affect transition from Incarnon back to base form")
- the leaderboard tags an Incarnon form "Refill" on sustained / boss and on any time window longer than its battery takes to fire:
  past that point the number leans on the refill assumption, and how long the refill really takes depends on your aim
- the calculator's Full results show the battery on its own: rounds and shots, time to fire it all, damage per battery (DoTs
  included), damage per second while it lasts, and the best-case refill
- so a small battery (Vasto Prime's 24 rounds, ~1.2 s of fire) spends most of a fight refilling: still near the top in 3 s, much
  lower in sustained. Unmodded Vasto Prime: 8 hits at 1.76/s = 4.5 s + 4 s switching per form

Onos's Incarnon form (`onosIncarnon` in build-data): holding the trigger charges for 4 s (the module's 0.25/s) while the Radiation
beam ticks 7 times, ramping "up to 2.5x" (Talk:Onos measured 36, 41 ... 69 off a 30 base: 30 x (1 + 1.5k/8)), then the Heat blast
and its 3 m explosion. 1 round a tick + 50 for the blast = 57 rounds a cycle, 6 cycles a 350-round form. "Held Damage + Charge Attack
+ Charge Radial Attack" is the whole cycle, and nothing lands at t = 0: the blast comes one charge in (4 s unmodded), so it misses
a 3 s window without fire rate mods

- Scenario (`src/optimizer/scenario.ts`): no faction, no armor, body shots (gun single hits: headshots), conditionals at max stacks with exceptions
  (`triggerUptime` in `src/calc/parseMod.ts`): headshot-hit triggers (Crux, Sharpshot) off, headshot-kill triggers (Deadhead) on,
  melee kills on a gun (Dexterity) and armor thresholds (Bulwark, +1%/armor past 1,000) at half. When two arcanes tie, the one with
  headshot multiplier / reload speed wins (reload counts half for single hit), so Deadhead and Merciless beat Dexterity,
  Condition Overload/Galvanized count only the build's own damage types (base physical + modded elements), capacity ignored, no rivens,
  melee at max combo. Heavy attacks/heavy slams/glaive detonations only compete in Single damage instance and Whole attack, since they
  spend the combo they need
- Search (`src/optimizer/optimize.ts`): mod pool = compatible mods with an effect that can raise that ranking (`modPool.ts`, fire rate /
  magazine / reload only for the DPS-type rankings), beam search over 8 slots (width 8), single-mod swaps, best Incarnon perk per tier,
  best arcane, elemental slot order. Incarnon perks that need a status the build brings (Furis's Stormburst needs Electricity,
  Latron's Riddled Target Puncture, 9 weapons in all) also get a full search with the perk locked in, since the perk pass runs on
  finished mods and would never add the element for it (Furis: 619k -> 1.42M sustained). Heuristic, so check odd results in the calculator ("Load build" applies the scenario too)
- Conflicts: same rules as the mod browser, see Mod restrictions below
- Not optimized: Exilus slot, polarities/capacity. Event-only attacks (reload explosions, turret expiry) are skipped
- Each attack is scored on its own (an impact + its explosion aren't summed). Incarnon forms count as 1 projectile. Charged attacks use
  `1 / (charge time + 1 / fire rate)`
- Not moddable weapons (anything outside LongGuns/Pistols/Melee in the data, e.g. the Drifter's Sirocco) are excluded entirely

## Stances (`src/data/stances.ts`)

Melee Normal Attacks follow a stance combo from the wiki's Module:Stances/data (summed per combo in `scripts/wiki-stances.txt`).
A combo is N hits over "Length @ 1.0 Attack Speed" seconds, so hits/s = hits / length x attack speed, and each hit is worth the
combo's total multiplier / hits on average. Forced procs in the combo (Bleeds, Lifted...) come along as forced status. The
calculator picks the best combo per stance (or the one you choose), the leaderboard uses the best one. Checked against
Underframe with the same combo (60,752 vs 60,383). Heavies, slams, slides and throws keep their own numbers.

## Rivens (`src/calc/riven.ts`, `src/components/RivenEditor.tsx`)

Typed in as the game shows them at rank 8. Max-rank value = base x disposition x layout weight x roll, roll 90-110% ("randomly
chosen between 90% and 110% of the base value, multiplied by the weapon's Riven Disposition"). Stats that can only roll one sign
are enforced (POSITIVE_ONLY / NEGATIVE_ONLY), Fire Rate is doubled on bows ("x2 for Bows"), and Riven Splicer (Update 44.1) is
in: the spliced trait "inherits the higher random value out of the consumed stats", one per riven. Rivens never go into the
optimizer or the leaderboard (pure RNG), only into the calculator, Compare and the god-roll search.

## Archon Shards (`src/data/archonShards.ts`)

5 slots, Tauforged x1.5, "Bonuses from different shards stack additively", weapon ones go in with the matching mods (Melee Crit
Damage with Organ Shatter) and apply to exalted weapons too. Strength/Duration/energy/armor/health/shields feed the frame's
stats, Crimson ability damage vs Electricity/Radiation/Corrosive feeds ability damage. Orb effects, casting speed etc. are listed
but not modeled.

## Ability damage (`src/calc/abilityDamage.ts`, `src/data/abilityDamage.ts`)

Each damaging ability is a timeline of hits from its wiki page (raw = base x Ability Strength unless the page says otherwise),
run against the target: faction weakness, armor (with the ability's own strips), Viral, Corrosive, its own Heat's 50% strip,
status DoTs (Heat refreshes every Heat stack but each keeps its own once-a-second rhythm, Gas capped at 10, Blast after 1.5 s),
shields soaking first, % of current health hits (Smite, Reap), True damage. Results: per cast, first 10 s, biggest hit, share of
target HP, kill time, and status notes (Viral x10, armor at its lowest).
- Roar: "applies to all ability damage", once on hits and twice on status ticks. Multiple Roars don't stack (the max is used)
- Crimson shards: +ability damage vs targets with Electricity/Radiation/Corrosive
- Universal Weapon Bonuses only on abilities whose page says they take them (wiki Universal_Weapon_Bonuses). Jade Stars motes
  take elemental bonuses ("such as Nourish and Valence Formation") and crit from a flat chance *and* a multiplier bonus ("Base 0%
  critical chance", "Base 1.0x critical multiplier"), but "Not affected by base damage bonuses like Arcane Arachne ... or damage
  multipliers like Eclipse". Seeking Talons, Radial Javelin and Infernum fireballs take all of them, Final Stand and Soul Punch all but crit
- Augment versions (Gaseous Quake, Hallowed Reckoning, Cataclysmic Gate, Coil Recharge, Infernum, Jade's Judgment, Explosive
  Legerdemain, Elemental Sandstorm) replace the plain card when the augment is equipped
- Combos: Sow + Reap (Reap takes 25% of current health as True, then Radiation with its vulnerability), Thermal Sunder recasts
  (each Heat cast about doubles the last), Virulence at 500 Mutation stacks (Abundant Mutation), and Elemental Sandstorm + a
  subsumed Jade Stars ("Abilities that rapidly deal damage ticks ... will cause a mote to launch every time it deals damage"):
  a storm tick every 0.25 s launches a mote each time, Strength-many Heat procs per mote (doubled with Archon Vitality) plus
  Strength-many procs of the melee's damage types per tick. At level cap that's Viral x10 and armor 2700 -> 270 in a second or two

Cards show on the Warframe panel for your own and subsumed abilities. The Experimental > Ability Damage page runs every one on the build its page
says it scales with (`src/data/abilityBuilds.ts`: Max Strength 420% / Strength + Duration 321% Str 199% Dur / Max Duration 332%,
real mods at max rank plus Crimson shards, augments swapped in for filler mods) against a picked target, with Roar and UWB
(Valence Formation, Nourish, Eclipse, Arcane Avenger, a crit multiplier bonus, Arcane Arachne) as settings.

## Layout

```
scripts/build-data.mjs    trims warframe-items to weapons/mods/arcanes/enemies JSON
scripts/check-calc.ts     wiki example checks
scripts/pull-wiki-data.py wiki weapon + enemy modules -> scripts/wiki-*.json (build-data also writes src/data/introduced.json from it: each weapon's release update, only Data Analysis reads it). compare-wiki-data.mjs diffs weapons against them
src/calc/constants.ts     faction table, status effects, DoT fractions
src/calc/parseMod.ts      stat lines -> effects, incl. "On Kill: ... Stacks up to 5x"
src/calc/damage.ts        the pipeline above
src/calc/target.ts        health/shield/armor level scaling, Steel Path, armor strip, armor DR
src/calc/kill.ts          shots / time to kill
src/calc/capacity.ts      mod drain + capacity (polarity match halves, mismatch +25%, both rounded up)
src/optimizer/            leaderboard scenario, objectives, mod pool + conflicts, beam search optimizer
scripts/build-leaderboard.ts  runs the optimizer on every attack across CPU cores, writes public/leaderboard.json
src/calc/simulate.ts      damage over time (expected value + Monte Carlo ranges)
src/calc/riven.ts         riven ranges, rolls, splicing
src/calc/abilityDamage.ts ability damage timelines vs a target
src/calc/warframeStats.ts Warframe totals (Strength, survivability, auras)
src/data/*.ts             hand-kept wiki tables: incarnon, passives, stances, abilities, ability builds, shards, exalted, reloads
src/optimizer/            also Compare / Damage Cap / riven search (each with a Web Worker) and the boss board
src/App.tsx               the tabs. src/Calculator.tsx is the calculator page
src/components/           one per panel / tab. ModSlots is the in-game style 2x4 grid + exilus
```

## Data quirks I've hit

- Top-level `damage` on weapons has slash/puncture swapped sometimes, so I read `attacks[].damage` instead
- The export has unreleased `/Expert/` copies of normal mods that reuse the name (a 10-rank "Point Strike" at +275%). build-data drops /Expert/ copies when a regular version exists (unless they're "Primed ..."), plus Galvanized "SubMod" duplicates
- Primaries are split into Rifle/Sniper/Launcher/Bow/Shotgun types, so weapons are kept by category. Sniper/Bow/Assault Rifle mods only show for those types
- Weapon exilus mods are flagged `isUtility` in the export, not `isExilus`
- `heavyAttackDamage` isn't consistent between classes. Checked against the per-hit "Stanceless Combos" Heavy row on each class's
  wiki page: Heavy Scythes / Sun & Moon list every hit added up (18x = 3 x 200% + 2 x 600%), Assault Saws / Two-Handed Nikanas
  only the first part, Daggers / Tonfas / Warfans / Sparring neither. The wiki's Weapon Comparison "Heavy" column is the same
  number as the export, so it's no independent check. In-game, Coda Hirudo's arsenal shows 500% + 5 x 300% (first hit 1,375
  = 5x of 274.9 with 57.1% Heat), not the wiki's Sparring row or the export's 6.5x
- Weapon numbers vs the wiki's modules (`compare-wiki-data.mjs`): 1,566 attacks match, 5 differ and on purpose: Noctua's Active
  Attack (the meter, see Exalted), Vectis / Vectis Prime Incarnon (the module has placeholder 5s, the numbers come from the
  Genesis page's text). Cernos Prime's charged shot (165.6 Impact here and on the wiki, 289.8 in the arsenal) is still unexplained:
  its built-in mod is the innate headshot bonus, which doesn't touch body damage
- The export has no innate headshot bonuses. The wiki module's `ExtraHeadshotDmg` does: Kuva Chakkhurr / Cernos Prime +50%,
  Synapse / Coda Synapse +20% ("additive to other sources of +bonus damage on headshot such as Primary Deadhead"), and -2 on
  Alternox, Arca Plasmor, Fulmin's semi, Nataruk's Perfect Shot, read as no headshot multiplier at all
- Enemies in the export are pre-Update 36: old health types, old numbers (Crewman 60 health / 150 shields, 90 / 120 on the wiki),
  some with a weapon class for a faction (Lancer was "Rifle"), Techrot Babau missing. build-data takes the wiki's
  Module:Enemies/data instead: health, shields, armor, faction, base level and head multiplier, matched by name (export ids are
  kept so saved setups still work), plus ~550 enemies only the wiki has. Picking an enemy sets its base level and head multiplier
- The export files a few weapons under the wrong class (Coda Bubonico as a Rifle, Perigale Prime as a Rifle, Buzlok as a Sniper),
  build-data fixes them from the wiki's class lists. Melee classes aren't in the export at all (`src/data/weaponClasses.ts`)
- About half the stance combos on the wiki have no "Length", so they're left out
- The export has no ability numbers worth using, every ability number is from its wiki page by hand

## Multi-hit heavy attacks (`src/data/heavyAttacks.ts`)

12 classes hit more than once on a heavy (Heavy Scythe, Assault Saw, Blade and Whip, Dagger, Dual Daggers, Dual Nikanas,
Dual Swords, Machete, Sparring, Tonfa, Two-Handed Nikana, Warfan). Their hit lists come from the class pages, with in-game
arsenal readings overriding them per weapon (Coda Hirudo so far). The calc rescales the Heavy Attack from the hit list:
- default / leaderboard: the biggest single hit (one damage instance)
- "Full heavy (all hits)" in the calculator, "Count the full heavy" on the leaderboard: every hit added up, all at the current combo
- forced damage procs per hit (Bleed, Impact, Puncture) are added: each as a share of a proc on the scored hit, weighted by
  that hit's share of the damage (a Bleed from a 2.5x hit inside a 10x full heavy = 0.25 of a proc on the 10x hit, which ticks
  the same as a whole Bleed off the 2.5x hit). Knockdown / Ragdoll / Lifted / Stagger do no damage and stay listed only
- the calculator's results and each leaderboard row show the hit-by-hit damage (click "Multi-hit heavy" on a row)
Classes not in the table hit once and keep the export's number

## Assumptions to double check

- Puncture (+5%/stack) and Tau (+10%/stack) are added flat after mods
- Faction weaknesses apply to shields, not overguard
- Heat/Toxin/Electricity/Gas ticks are reduced by armor (the wiki pages don't say either way)
- Heat stacks tick on their own 1 s clocks here, in game they merge into one tick per second (same total, slightly different timing)
- Incarnon forms refill at 100% weak point accuracy with the normal form (the real number depends on your aim)
- Head multiplier/headcrit defaults are per faction. Picking an enemy uses the wiki's head multiplier when it has its own
  (about 80 do), the rest still follow the faction
- Incarnon Genesis per-status bonuses aren't in the data (Cedo's +60%/status is in the passives table)

- Incarnon data: Burston Prime uses Burston's numbers and Soma Prime uses Soma's (their tables didn't come through),
  Untagged base damage perks are assumed to apply to the Incarnon form too
- Incarnon perks: "Base X set to Y" (Survivor's Edge) replaces the base, King's Gambit zeroes body crit and adds +150% weak point
  crit chance like Acuity, "Converts X% of current ... to Base ..." (High Ground) works like Wiseman's Regard. Not modeled:
  Munitions Grit's multishot-projectile bonus, Kinetic Killer (slide attacks aren't in the calc), utility perks (shown greyed out)
- "On last shot in magazine" (Torid's Final Fusillade, +3 multishot) and "On final magazine burst" (Burston's Forceful Finality, +5)
  only hit one shot / burst per magazine, so they're averaged over it: value x rounds in that shot / shots per magazine. Torid's
  5-round grenades get +0.6, its Incarnon form's 170 charges +0.018
- Plentiful Mayhem (Torid, Miter): "Multishot consumes ammo directly from Capacity", so a shot costs its projectile count like an
  ammo-hungry alt-fire (5 rounds at 1.9 multishot = 2.6 shots a magazine, the Incarnon form "pools directly from its magazine").
  Torid's "+60%" goes on the extra projectiles only, "multiplicative to base damage bonuses like Serration": the average
  projectile gets 1 + 0.6 x (M - 1) / M. In the Incarnon form "all multishot bonuses are increased by 60%" instead. Miter's
  version (wiki "+20") has no damage part here, the number's unclear

## Not modeled yet

- Arcanes that aren't stat lines: Secondary Encumber/Surge/Kinship, Melee Retaliation, Longbow Sharpshot treated as additive
  damage (unverified)
- Glaives: throw rate isn't changed by anything, the single-hit leaderboard shows a stance's average combo hit
- Abilities: Elemental Sandstorm spreads its procs evenly over the melee's types (the game picks one at random each tick) and
  doesn't work on enemies Sandstorm can't lift (bosses, some Eximus)

### Bigger, not planned for now

These need something the calc doesn't have yet, so they're parked:
- A heavy-attack DPS loop that rebuilds combo between heavies, plus combo duration / initial combo / combo count chance / Tennokai
- Anything that needs more than one enemy: Electricity chains, Blast/Gas spreading, on-death explosions (Acid Shells, Vulcan Blitz)
- Slide attacks (Maiming Strike, Kinetic Killer): the export only has Stormpath's, the rest would come from the wiki per class

## Arcanes and augments with their own rule (added Nov 2026)

- Primary Plated Round: wiki "Max Damage Bonus = 15 x sqrt(5 x Magazine Size)" (%), "additive to base damage sources such as
  Serration", off the modded magazine. 25 rounds = +167.7%, 80 = +300%. Full bonus assumed, with a note on the fire rate it needs
  to last a whole magazine (magazine / 10 s, the wiki's "Ideal Fire Rate")
- Secondary Outburst: +20% crit chance and crit damage per combo multiplier consumed, in with crit mods ("additive with mods like
  Pistol Gambit"). Assumed at the full 12x (+240%): it's a Crescendo-build arcane that rides on a maxed combo
- Cascadia Empowered: an extra hit per status proc worth 750 of the proc's type x faction x (1 + vulnerability) x the target's
  armor/weakness for that type. "Not affected by damage, element, physical ... or critical mods", "Affected by faction mods and
  bonuses once", "Not affected by weakspots". It's a row next to the DoTs, procs/s = every proc that lands
- Meticulous Aim: "-45% Bodyshot Damage" multiplies everything off the head, and DoTs per the wiki: "always applied twice to
  Slash, Heat, Toxin, and Blast, but will not apply to Electricity or Gas if they are from a headshot"
- Ability cards on the Warframe panel now take your own casts as Universal Weapon Bonuses: Vex Armor / Deathbringer (base),
  Eclipse (multiplier), Nourish (Viral), Empowered Quiver (crit damage), Arcane Avenger and Crepuscular from the frame's arcanes
- Exalted Blade's energy waves: "Energy Wave" (the swing's damage, follows the stance), "Normal Attack + Energy Wave" (both hits
  on one target, "considered separate entities and will both deal damage separately") and "Heavy Attack Energy Wave" (heavy base
  damage, "does not scale off combo counter"). All point blank: waves fall "linearly with distance from 100% to 0% between 0 and 70m"
