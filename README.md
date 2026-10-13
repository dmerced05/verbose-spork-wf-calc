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
average damage, toxin skips shields, no overflow from shields into health. "With DoTs" divides by direct + DoT DPS.

Status types for Condition Overload / Galvanized default to the build's own damage types (a weapon with Impact/Puncture/Slash
that's modded into three elements counts 6), switchable to the debuff stacks in the Debuffs panel.
Magazine Capacity / Reload Speed mods are parsed, results show sustained DPS, burst DPS and damage in the first 10 s.
Semi-___ Cannonade: semi-auto only and locks fire rate (both read from the mod's description in the data).

Debuffs: every status type has its stack count, plus Heat strip stage, Corrosive Projection auras, other armor strip %, generic vulnerability %, and Roar.
Armor strips multiply: (1 − heat) × (1 − corrosive) × (1 − 18% × auras) × (1 − other). Enemy presets level-scale armor (clamped 200–2700).

`npm run check` tests against the wiki's examples: quantization, Roar + Bane = 477, Roar Slash tick = 78.75, Bleed tick = 297.82, Gas tick = 3699.07, Blast proc = 72.075, Viral ×4.25, armor strip, Cold crit 3.86.

## Leaderboard

The page has two tabs: Calculator and Leaderboard. The leaderboard is precomputed, the site never runs the optimizer:
`npm run leaderboard` runs `scripts/build-leaderboard.ts`, which optimizes every weapon attack for every ranking and writes
`public/leaderboard.json` (committed, fetched only when the tab opens). After a data update: `npm run leaderboard`, then deploy.

One leaderboard, ranked by a setting (`src/optimizer/objectives.ts`, each one optimized separately):
- Sustained DPS: direct + status DoTs with magazine and reload (`burst x mag / (fire rate x reload + mag)`, wiki Damage/Calculation)
- Damage in a time window (3 / 10 / 30 s): simulates shots from t = 0 with reloads, DoTs count the part that fits in the window
- Single damage instance: one hit of one projectile / one melee swing, crits averaged, no DoTs

Settings on the page: Rank by, time window, Primary/Secondary/Melee, search, and "Include Incarnon forms". Incarnon forms run on
Incarnon charge which isn't in the data, so they never reload here, which is why they can be toggled off.

- Scenario (`src/optimizer/scenario.ts`): no faction, no armor, body shots, conditionals at max stacks (headshot-triggered ones off),
  Condition Overload/Galvanized count only the build's own damage types (base physical + modded elements), capacity ignored, no rivens
- Search (`src/optimizer/optimize.ts`): mod pool = compatible mods with an effect that can raise that ranking (`modPool.ts`, fire rate /
  magazine / reload only for the DPS-type rankings), beam search over 8 slots (width 8), single-mod swaps, best Incarnon perk per tier,
  best arcane, elemental slot order. Heuristic, so check odd results in the calculator ("Load build" applies the scenario too)
- Conflicts: Primed/Amalgam/Archon/Umbral/Sacrificial/Spectral variants conflict with their base mod, plus `EXCLUSIVE_GROUPS` in `modPool.ts`
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
- Some weapon base damage doesn't match in game, e.g. Cernos Prime charged shot is 165.6 impact in the export but 289.8 in the arsenal
- Enemy health/armor types in the export are pre-Update 36, so only base stats + faction are used

## Assumptions to double check

- Puncture (+5%/stack) and Tau (+10%/stack) are added flat after mods
- Faction weaknesses apply to shields, not overguard
- Heat/Toxin/Electricity/Gas ticks are reduced by armor (the wiki pages don't say either way)
- Heat procs refresh all Heat stacks, so under sustained fire Heat ticks longer than the 6 shown per proc
- Head multiplier/headcrit defaults are per faction, specific enemies differ (Juggernaut 4x, Ropalolyst 0.2x, armored heads),
  override them in the target panel
- Weapon-innate CO bonuses (Cedo +60%/status, Incarnon Genesis per-status bonuses) aren't in the data

- Incarnon data: Burston Prime uses Burston's numbers and Soma Prime uses Soma's (their tables didn't come through),
  Thalys isn't in warframe-items yet. Untagged base damage perks are assumed to apply to the Incarnon form too
- Incarnon perks not modeled: Munitions Grit's multishot-projectile bonus, High Ground / Wiseman's Regard conversions,
  King's Gambit, Kinetic Killer, "Base Status Chance set to X", plus all utility perks (shown greyed out)

## Not modeled yet

- Melee combo / Blood Rush / Weeping Wounds, heavy attacks, rivens, bow ×2 fire rate
- Arcanes that aren't stat lines: Cascadia Empowered (+750 flat per proc), Secondary Encumber/Enervate/Surge/Kinship/Outburst,
  Melee Duplicate/Doughty/Retaliation/Animosity, Primary Plated Round, Longbow Sharpshot treated as additive damage (unverified)
- Reload / sustained DPS, charge and burst fire rate formulas
- Electricity chain and Blast/Gas AoE on other enemies
