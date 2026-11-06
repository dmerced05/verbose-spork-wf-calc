// the About page's write-ups, biggest algorithm first. each one cites the code it describes (sources), and
// src/about/verified.json holds the hash of that code from the last time the write-up was checked against it. edit the
// code and the page marks the write-up out of date until it's reread, fixed and restamped (npm run about:stamp).
// {{file#NAME}} pulls a constant's value straight out of the source, so numbers never go stale on their own.
// math is KaTeX. complexity uses: C = one damage calc, |P| = mod pool size, S = mod slots, B = beam width
import type { SourceRef } from './sync'

export interface Equation {
  name: string
  tex: string // display math
  complexity?: string // inline math, without $
  note?: string
}
export interface Algorithm {
  id: string
  title: string
  where: string // the page(s) it powers
  summary: string
  complexity: string // overall, inline math
  sources: SourceRef[]
  steps: string[] // plain text, $...$ for inline math
  equations: Equation[]
}

const OPT = 'src/optimizer/optimize.ts'
const SIM = 'src/calc/simulate.ts'
const DMG = 'src/calc/damage.ts'

export const ALGORITHMS: Algorithm[] = [
  {
    id: 'leaderboard',
    title: 'Leaderboard rebuild',
    where: 'Leaderboard, Compare, Data Analysis',
    summary: 'Precomputes the best build for every weapon attack on every ranking, offline, and only redoes the weapons whose inputs changed.',
    complexity: String.raw`O\!\left(\frac{|W_s|\,\bar A\,|\mathcal B|\;T_{opt}}{p}\right)`,
    sources: [
      { file: 'scripts/build-leaderboard.ts', symbol: 'main' },
      { file: 'scripts/build-leaderboard.ts', symbol: 'runShard' },
      { file: 'scripts/build-leaderboard.ts', symbol: 'writeFile' },
      { file: 'scripts/leaderboardFingerprint.ts' },
      { file: 'src/optimizer/leaderboardWeapon.ts', symbol: 'optimizeWeapon' },
      { file: 'src/optimizer/objectives.ts', symbol: 'BOARDS' },
    ],
    steps: [
      'Fingerprint: one engine hash over the generic code every weapon runs through (comment lines and whitespace stripped), and one hash per weapon over its own data plus the outputs of every lookup it hits (the parsed mods it can equip, its passives, Incarnon perks, stance...).',
      'A weapon is stale when the engine hash or its own hash changed (or it was named with --only). --boards limits the re-optimizing to some boards and keeps the rest from the old file.',
      'Stale weapons are dealt round-robin to one worker process per core (max 12), each running a pre-bundled copy of the script.',
      'Per weapon: every attack that does damage (reload/expiry/turret events and headshot-only parts skipped) × every board goes through the build optimizer. Heavies and gated alt-fires skip the fire-rate boards. Guns on the Single damage instance board are scored on headshots.',
      'On fire-rate boards, the build found without fire-rate mods replaces the normal one if it scores higher (the search is a heuristic).',
      'Whole shots ("A + B") are re-scored with every build found for their parts, plus any saved Compare seeds; a seed only replaces the entry if it scores higher.',
      'Kept and new entries are merged, each board is sorted by score, and the file is written compact: mods, arcanes and weapons become indexes into shared tables.',
    ],
    equations: [
      {
        name: 'Total work',
        tex: String.raw`T = \frac{1}{p}\sum_{w \in W_s}\;\sum_{a \in A_w}\;\sum_{b \in \mathcal{B}} T_{opt}(w, a, b)`,
        complexity: String.raw`O\!\left(|W_s|\,\bar A\,|\mathcal B|\,T_{opt} / p\right)`,
        note: 'W_s = stale weapons, A_w = the weapon\'s attacks, 𝓑 = boards (11 today), p = worker processes. T_opt is the build optimizer below.',
      },
      {
        name: 'Staleness test',
        tex: String.raw`\text{stale}(w) \iff H_{engine} \neq H'_{engine} \;\lor\; H_w \neq H'_w \;\lor\; w \in \text{--only}, \qquad H = \operatorname{sha256}(\cdot)_{[0,16)}`,
        complexity: String.raw`O(|\text{source}| + \sum_w |\text{lookups}_w|)`,
      },
      {
        name: 'Fire-rate fallback and seeds',
        tex: String.raw`E_b(w,a) = \operatorname*{arg\,max}_{x \,\in\, \{x_b,\; x_{b\text{-nofr}}\} \,\cup\, \{\text{seed}(s) : s \in \text{parts}(a) \cup \text{seeds}\}} f_b(x)`,
        complexity: String.raw`O(|\text{seeds}|\cdot C)`,
      },
      {
        name: 'Merge and sort',
        tex: String.raw`\text{board}_b = \operatorname{sort}_{\downarrow f}\big(\text{kept}_b \cup \text{new}_b\big)`,
        complexity: String.raw`O\!\left(\textstyle\sum_b N_b \log N_b\right)`,
      },
    ],
  },
  {
    id: 'optimizer',
    title: 'Build optimizer (beam search)',
    where: 'Leaderboard, Compare, Rivens, Damage Cap, Boss board',
    summary: 'Finds a strong 8-mod build plus arcane, Incarnon evolutions, bonus element and element order for one attack and one goal. A heuristic, not an exhaustive search: checked against hand-built meta builds.',
    complexity: String.raw`O\big((SB|P| + 2RS|P| + 2|\mathcal A| + 2\textstyle\sum_t|E_t| + 120)\,C\,(1+g)\big)`,
    sources: [
      { file: OPT, symbol: 'optimizeAttack' },
      { file: OPT, symbol: 'SLOT_COUNT' },
      { file: OPT, symbol: 'BEAM_WIDTH' },
      { file: OPT, symbol: 'MAX_SWAP_PASSES' },
      { file: OPT, symbol: 'MAX_ELEMENT_ORDERS' },
      { file: OPT, symbol: 'critViolation' },
      { file: 'src/optimizer/modPool.ts', symbol: 'damageModPool' },
      { file: 'src/optimizer/modPool.ts', symbol: 'usefulEffect' },
    ],
    steps: [
      'Pool: one copy per mod name (highest rank), only mods with an effect that can raise this goal\'s number (fire rate / magazine / reload only on time-based goals, banes only against their faction, weak point mods and Acuity only on headshots, heavy-only stats only on heavies).',
      'Bonus element (Kuva / Tenet / Coda): each element tried at the max value.',
      'Beam search: grow builds one mod at a time, keep the best B = {{src/optimizer/optimize.ts#BEAM_WIDTH}} distinct mod sets at each size, for S = {{src/optimizer/optimize.ts#SLOT_COUNT}} slots. Incompatible pairs (same family, exclusive mods) are skipped.',
      'Then, twice over: re-pick the bonus element, pick the best evolution per Incarnon tier, pick the arcane (ties go to the one with headshot / reload value), single-mod swaps until nothing improves (up to {{src/optimizer/optimize.ts#MAX_SWAP_PASSES}} passes), and try every slot order of the elemental mods (they combine in slot order), up to {{src/optimizer/optimize.ts#MAX_ELEMENT_ORDERS}} orders.',
      'Against a real target (faction or headshot), the whole search runs again on the plain pool and the better one wins: a bane can crowd out a better crit build early.',
      'Status-gated evolutions that weren\'t picked (Furis\'s Stormburst needs Electricity) each get a full search with the evolution locked in, since the mods never had a reason to add the status it needs.',
    ],
    equations: [
      {
        name: 'Search score',
        tex: String.raw`s(M) = f(M)\,\Big(1 - 10^{-7}\!\sum_{m \in M}\kappa(m)\Big)\cdot\begin{cases}1 & \mu = 0\\[2pt] 10^{-3}\,e^{-20\mu} & \mu > 0\end{cases},\qquad \mu = \max(0, c - c_{max}) + \max(0, c_{min} - c)`,
        complexity: 'O(C)',
        note: 'f = the goal\'s score from one damage calc, κ = 1 per catch (conditional or Niche mod) so ties go to the cleaner mod, μ = how far the crit chance c is outside the Compare tab\'s crit limits. The penalty is steep but smooth so the search still has a slope.',
      },
      {
        name: 'Beam step',
        tex: String.raw`\mathcal{B}_{k+1} = \operatorname{top}_{B}\Big\{\, M \cup \{m\} \;:\; M \in \mathcal{B}_k,\; m \in P,\; m \perp M \,\Big\},\qquad B = {{src/optimizer/optimize.ts#BEAM_WIDTH}},\; k < S = {{src/optimizer/optimize.ts#SLOT_COUNT}}`,
        complexity: String.raw`O(S\,B\,|P|\cdot C)`,
        note: 'Builds are keyed by their sorted mod set, so the same set reached in two orders counts once.',
      },
      {
        name: 'Swap pass',
        tex: String.raw`M \leftarrow M[i \mapsto m] \;\text{ if }\; s(M[i \mapsto m]) > s(M)(1 + 10^{-9}),\qquad i \le S,\; m \in P,\; \le R = {{src/optimizer/optimize.ts#MAX_SWAP_PASSES}} \text{ passes}`,
        complexity: String.raw`O(R\,S\,|P|\cdot C)`,
      },
      {
        name: 'Evolutions, arcane, element order',
        tex: String.raw`e_t^* = \operatorname*{arg\,max}_{e \in E_t \cup \{\varnothing\}} s(M \mid e),\quad a^* = \operatorname*{arg\,max}_{a \in \mathcal{A} \cup \{\varnothing\}} s(M \mid a),\quad \sigma^* = \operatorname*{arg\,max}_{\sigma \in \mathfrak{S}_k} s(\sigma M)`,
        complexity: String.raw`O\big((\textstyle\sum_t |E_t| + |\mathcal A| + \min(k!, 120))\cdot C\big)`,
        note: 'k = elemental mods in the build, so 5 elements = 120 orders.',
      },
      {
        name: 'Retries',
        tex: String.raw`x^* = \operatorname*{arg\,max}\big\{x,\; x_{\text{plain pool}},\; x_{e_1 \text{ locked}},\dots, x_{e_g \text{ locked}}\big\}`,
        complexity: String.raw`O\big((1 + [\text{real target}] + g)\,T_{opt}\big)`,
        note: 'g = status-gated evolutions not picked by the first search.',
      },
    ],
  },
  {
    id: 'damage-cap',
    title: 'Damage Cap ladder',
    where: 'Damage Cap',
    summary: 'How much has to stack up for one hit to pass the damage limit, as a ladder of steps that each add one layer and re-optimize for the biggest single instance.',
    complexity: String.raw`O\big(8\,T_{opt} + |F|\,K\,C + \tbinom{n+4}{5}\, T_{frame}\big)`,
    sources: [
      { file: 'src/optimizer/damageCap.ts', symbol: 'runCapLadder' },
      { file: 'src/optimizer/damageCap.ts', symbol: 'combos' },
      { file: 'src/optimizer/damageCap.ts', symbol: 'searchFrames' },
      { file: 'src/optimizer/damageCap.ts', symbol: 'searchShards' },
      { file: 'src/optimizer/damageCap.ts', symbol: 'searchPriming' },
      { file: 'src/optimizer/damageCap.ts', symbol: 'searchAllies' },
      { file: 'src/optimizer/frameBuild.ts', symbol: 'optimizeFrameMods' },
    ],
    steps: [
      '1. Mods, weapon arcane and Incarnon, optimized for the peak hit against a level 9,999 Steel Path Heavy Gunner. 2. + headshot (never on AoE, off for melee unless asked).',
      '3. + solo priming: the statuses the build applies itself plus a companion\'s (Diriga stands in for every primer). Companion picked, mods re-optimized for those debuffs, companion picked again on the new build.',
      '4. + Warframe arcanes and 5. + Archon Shards on "any Warframe" with nothing cast: every Tauforged 5-shard multiset, each with a quick frame mod search, then the best few searched properly.',
      '6. + your Warframe: every frame\'s own modeled abilities (every combination of one option per ability, capped at 400) plus one Helminth subsume, screened at a reference Strength; the shortlist gets a real frame mod build (beam search over 8 slots + aura + exilus, sets placed whole) and the weapon mods re-optimized.',
      '7. + enemy debuffs maxed, 8. + allies: one teammate at a time, the frame that adds the most on top.',
    ],
    equations: [
      {
        name: 'Peak hit (what each step maximizes)',
        tex: String.raw`\text{peak} = D_{\text{vs target, no crit}}\cdot\big(1 + \lceil c\rceil (M - 1)\big)\cdot \text{beamMerge}\cdot\text{batteryScale}`,
        complexity: 'O(C)',
        note: 'The top crit tier, not the average: the cap is about the biggest number one hit can show.',
      },
      {
        name: 'Ability setups per frame',
        tex: String.raw`|\text{setups}| = \min\Big(400,\; \prod_{g \in G} \big(|O_g| + [g \text{ optional}]\big)\Big) \times |\text{subsumes}|`,
        complexity: String.raw`O(|F|\cdot K \cdot C)`,
        note: 'F = frames, K = setups per frame after the cap.',
      },
      {
        name: 'Archon Shard sets',
        tex: String.raw`\#\text{multisets} = \binom{n + 5 - 1}{5}`,
        complexity: String.raw`O\big(\tbinom{n+4}{5}\, T_{frame}\big)`,
        note: 'n = shard options that can matter for this weapon class, 5 slots, order doesn\'t matter.',
      },
      {
        name: 'Frame mod beam',
        tex: String.raw`\mathcal{L}_{r+1} = \operatorname{top}_{6}\big\{\, \text{place}(L, m) : L \in \mathcal{L}_r,\; m \in P_f \cup \text{sets}\,\big\},\quad r \le 8 + \text{aura} + 1`,
        complexity: String.raw`O\big((8 + a)\cdot 6 \cdot |P_f| \cdot C\big)`,
      },
    ],
  },
  {
    id: 'riven',
    title: 'Riven god-roll search',
    where: 'Rivens',
    summary: 'Which riven stats raise an attack the most once the other 7 mods are rebuilt around it. Every candidate riven goes through the full optimizer with the riven locked in.',
    complexity: String.raw`O\big((1 + |S_r| + 84 + |K_r|)\,T_{opt}\big)`,
    sources: [{ file: 'src/optimizer/rivenSearch.ts', symbol: 'searchRivens' }, { file: 'src/optimizer/rivenSearch.ts', symbol: 'rollRiven' }],
    steps: [
      'Baseline: the attack\'s best build with no riven.',
      'Screen: each stat alone on a 2-stat + curse riven, at the max or average roll, full optimizer run each.',
      'Shortlist: at most the 3 best elements (a second element mostly just combines with the first) and the best of everything else, 8 in all.',
      'Combine: every 2- and 3-stat riven from the shortlist with at most one spliced stat. Each also tries the builds already found for its smaller parts with the riven dropped in, so a 3-stat riven never scores below its 2-stat parts.',
      'Curses: the best riven\'s build with each curse swapped in, same positives, to see which curses cost nothing.',
    ],
    equations: [
      {
        name: 'Candidates',
        tex: String.raw`|R| = \binom{8}{2} + \binom{8}{3} = 28 + 56 = 84 \;(\text{minus rivens with two spliced stats})`,
        complexity: String.raw`O(84\, T_{opt})`,
      },
      {
        name: 'Riven value',
        tex: String.raw`v(r) = \frac{\max\big(f(x^*_r),\; \max_{r' \subset r} f(x^*_{r'} \oplus r)\big)}{f(x^*_\varnothing)} - 1`,
        complexity: String.raw`O(2^{|r|}\,C)`,
        note: 'x*_r = the optimizer\'s build with riven r locked, x ⊕ r = an existing build with r dropped into its weakest slot.',
      },
    ],
  },
  {
    id: 'boss',
    title: 'Boss time-to-kill and damage attenuation',
    where: 'Leaderboard (Boss board)',
    summary: 'Ranks builds by seconds to strip a Steel Path boss\'s shields and health, solo, with the wiki\'s damage attenuation model on top of normal damage.',
    complexity: String.raw`O\big(T_{opt}^{est} + \tfrac{T_{max}}{\Delta t}\,\bar n\big)`,
    sources: [
      { file: 'src/optimizer/bossLeaderboard.ts', symbol: 'optimizeWeaponBoss' },
      { file: 'src/optimizer/bossLeaderboard.ts', symbol: 'BOSS_ATTENUATION' },
      { file: SIM, symbol: 'attenuationBins' },
      { file: SIM, symbol: 'attenuatedTimeToKill' },
      { file: SIM, symbol: 'BIN' },
      { file: SIM, symbol: 'LAMBDA' },
      { file: DMG, symbol: 'timeToReach' },
      { file: DMG, symbol: 'calculate' },
      { file: DMG, symbol: 'SHOTGUN_COMPENSATION' },
    ],
    steps: [
      'The search scores builds on a quick estimate (attenuation applied to the average rate), then the winner is re-scored with the exact bin simulation. Score = 1 / seconds.',
      'Per trigger, Reinhard tone mapping caps one shot\'s damage softly at MDPT; a bucket B tracks the mapped damage of the last second and scales everything down by MDPS / B when it\'s over.',
      'The caps are shares of the boss\'s max health (health only, no shields): {{src/optimizer/bossLeaderboard.ts#BOSS_ATTENUATION}}. The per-trigger 5% is on both Hemocyte\'s and Lephantis\'s wiki pages; the per-second 20% only on Hemocyte\'s. Multi-pellet weapons get {{src/calc/damage.ts#SHOTGUN_COMPENSATION}}× the per-trigger cap (the standardized model\'s ShotgunCompensation; where it applies is my guess). The boards are marked untested.',
      'Steps of Δt = {{src/calc/simulate.ts#BIN}} s out to 600 s. DoT ticks go into the bucket but skip the per-trigger step. Merged attacks (Onos\'s beam + blast) map each part\'s hits separately.',
      'Without attenuation, time to reach an amount: secant steps from the steady rate, then a few halvings over the killing shot\'s interval. Past 10 minutes it\'s extrapolated so weak builds still have a slope.',
    ],
    equations: [
      {
        name: 'Per-trigger mapping (Reinhard)',
        tex: String.raw`\hat d = \frac{M_t\, D}{D + M_t},\qquad D = \bar h\cdot\text{multishot},\qquad M_t = \text{perTrigger}\cdot HP\cdot k_{sg},\quad k_{sg} = \begin{cases}{{src/calc/damage.ts#SHOTGUN_COMPENSATION}} & \text{base multishot} > 1\\ 1 & \text{otherwise}\end{cases}`,
        complexity: 'O(1)',
      },
      {
        name: 'Rate bucket (damped follower)',
        tex: String.raw`B'' + 2\lambda B' + \lambda^2 B = \lambda^2 Q,\quad \lambda = {{src/calc/simulate.ts#LAMBDA}},\qquad d_{out} = \hat d\cdot\min\!\Big(1, \frac{M_s}{B}\Big),\quad M_s = \text{perSecond}\cdot HP`,
        complexity: String.raw`O(T_{max}/\Delta t)`,
        note: 'Q = mapped damage over the last 1 s. B jumps up to Q when Q > B and decays toward it otherwise.',
      },
      {
        name: 'Time to reach (no attenuation)',
        tex: String.raw`t_{n+1} = t_n + \frac{A - D(t_n)}{\dot D},\;\; n < N_{sec};\qquad \text{then bisect } [t_k - \tfrac1r,\, t_k] \text{ five times}`,
        complexity: String.raw`O\big((N_{sec} + 5)\cdot N_{shots}\big)`,
      },
    ],
  },
  {
    id: 'compare',
    title: 'Compare build paths',
    where: 'Compare › Build Paths',
    summary: 'Runs the build optimizer once per path (a set of rules: locked or banned mods, a riven, a fixed arcane or evolution, crit limits) per goal, so different build philosophies can be compared side by side.',
    complexity: String.raw`O(|\text{paths}|\cdot|\text{boards}|\cdot T_{opt})`,
    sources: [{ file: 'src/optimizer/compare.ts', symbol: 'runPath' }, { file: 'src/optimizer/compare.ts', symbol: 'constraintsFor' }],
    steps: [
      'Each path becomes optimizer constraints: locked mods (a riven too), excluded mods, locked or excluded arcane and evolutions, min / max crit chance.',
      '"Thorough" doubles the beam width (8 → 16). Runs in a Web Worker so the page stays responsive.',
    ],
    equations: [
      {
        name: 'One cell',
        tex: String.raw`x_{p,b} = \operatorname{optimize}\big(w, a, b \mid \text{constraints}(p)\big),\qquad B = \begin{cases}16 & \text{thorough}\\ 8 & \text{otherwise}\end{cases}`,
        complexity: String.raw`O(S\,B\,|P|\cdot C)`,
      },
    ],
  },
  {
    id: 'advisor',
    title: 'Build Advisor',
    where: 'Calculator',
    summary: 'How much each stat is worth to this exact build right now, the best real mod for it, which slots carry the least, and greedy build paths. Everything is measured by running the calc with one more or one less mod.',
    complexity: String.raw`O\big((|\Lambda| + S + |P| + 3 S |P|)\cdot C\big)`,
    sources: [
      { file: 'src/calc/advisor.ts', symbol: 'advise' },
      { file: 'src/calc/advisor.ts', symbol: 'greedyPath' },
      { file: 'src/calc/advisor.ts', symbol: 'pathWithArcane' },
      { file: 'src/calc/advisor.ts', symbol: 'buildPaths' },
      { file: 'src/calc/advisor.ts', symbol: 'rankingScorer' },
      { file: 'src/calc/advisor.ts', symbol: 'DOT_WEIGHT_OFF_DOT_WEAPON' },
    ],
    steps: [
      'Lever weights: each stat (damage, crit, each element, faction...) is added at one typical mod\'s worth (or the biggest mod still available for it) and the score change is read off.',
      'Slot values: the build with each mod vs without it.',
      'Best and cheapest real mod per stat: added to a free slot, or swapped for the weakest slot when the build is full; cheapest = most gain per capacity point.',
      'Over-stacking: a stat with 2+ mods where swapping one of them for the best mod of another stat makes the build bigger.',
      'Build paths: greedy, one slot at a time, always the mod that adds the most right now; then the best arcane, then the mods again with it in, until it settles. Three forks: pure greedy, crit only, status only.',
      'Status DoTs count at {{src/calc/advisor.ts#DOT_WEIGHT_OFF_DOT_WEAPON}}× in the rankings unless the weapon is built for them (25%+ base status, a beam, or forced procs).',
    ],
    equations: [
      {
        name: 'Lever weight',
        tex: String.raw`w_\ell = \frac{f(M \oplus \delta_\ell) - f(M)}{f(M)}`,
        complexity: String.raw`O(|\Lambda|\cdot C)`,
        note: 'Damage is a product of buckets, so adding to a bucket that\'s already big moves the product less: that\'s over-stacking in numbers.',
      },
      {
        name: 'Slot contribution',
        tex: String.raw`\gamma_m = \frac{f(M)}{f(M \setminus \{m\})} - 1`,
        complexity: String.raw`O(S\cdot C)`,
      },
      {
        name: 'Greedy path',
        tex: String.raw`M_{k+1} = M_k \cup \Big\{\operatorname*{arg\,max}_{m \in P,\, m \perp M_k} f(M_k \cup \{m\})\Big\}`,
        complexity: String.raw`O(S\,|P|\cdot C)\text{ per pass}`,
      },
    ],
  },
  {
    id: 'damage',
    title: 'Damage calculation',
    where: 'Every page',
    summary: 'One attack, one build, one target: base damage through mods, element combining, quantization, crit, multishot, armor and faction, status procs and DoTs, then magazine and reload. Everything else on the site calls this.',
    complexity: String.raw`O(L + T + N_{shots})`,
    sources: [
      { file: DMG, symbol: 'calculateOnce' },
      { file: DMG, symbol: 'calculate' },
      { file: DMG, symbol: 'quantize' },
      { file: 'src/calc/target.ts', symbol: 'scaleArmor' },
      { file: 'src/calc/target.ts', symbol: 'armorDamageMultiplier' },
      { file: 'src/calc/constants.ts', symbol: 'COMBINED_ELEMENTS' },
    ],
    steps: [
      'Collect every mod, arcane, passive, Warframe ability, combo and Incarnon effect into stat buckets. Conditionals at the scenario\'s stacks (per-shell stacks like Felarx\'s Mounting Momentum capped at the base form\'s magazine).',
      'Damage types: physical types scaled by their own mods, elements added in slot order and combined two at a time, each final type quantized to 1/32 of base damage.',
      'Crit (tiers above 100%, headcrit, Cold\'s crit damage), faction, multishot, fire rate.',
      'Target: armor (scaled by level, clamped, stripped by Heat / Corrosive / Corrosive Projection), faction weaknesses, headshot, vulnerability.',
      'Status: procs per second split by each type\'s share of damage, DoT ticks per proc, Heat stacks refreshing together.',
      'Magazine and reload (shell-by-shell where it applies), Incarnon battery and refill, then the sustained and time-window numbers via the shot simulator.',
    ],
    equations: [
      {
        name: 'Quantization',
        tex: String.raw`q(p) = \frac{\operatorname{sgn}(p)\,\big\lfloor 32|p| + 0.5\big\rfloor}{32},\qquad D_t = q\!\left(p_t\right)\cdot D_{base}(1 + \beta)`,
        complexity: 'O(T)',
        note: 'p_t = the type\'s share of base damage after its mods, β = base damage mods (Serration...).',
      },
      {
        name: 'Crit',
        tex: String.raw`\bar m_{crit} = 1 + c\,(M - 1),\qquad m_{\text{low tier}} = 1 + \lfloor c\rfloor (M-1),\qquad m_{\text{high tier}} = 1 + \lceil c\rceil (M-1)`,
        complexity: 'O(1)',
        note: 'Above 100% crit the lowest tier is the "normal" hit and the next tier up is the "crit". M includes headcrit (×2 on the base) and Cold\'s bonus.',
      },
      {
        name: 'Armor',
        tex: String.raw`A(q) = \operatorname{clamp}\!\Big(A_0\big(\ell + (h - \ell)\,s\big),\,200,\,2700\Big),\;\; \ell = 1 + 0.005\,q^{1.75},\; h = 1 + 0.4\,q^{0.75},\; s = \operatorname{smoothstep}\!\Big(\tfrac{q - 70}{10}\Big)`,
        complexity: 'O(1)',
      },
      {
        name: 'Armor damage multiplier',
        tex: String.raw`\text{DM}(A) = 1 - 0.9\sqrt{A / 2700}`,
        complexity: 'O(1)',
      },
      {
        name: 'Status procs',
        tex: String.raw`\lambda_t = s \cdot n_{hit} \cdot r \cdot \frac{w_t}{\sum_u w_u}`,
        complexity: 'O(T)',
        note: 's = status chance, n_hit = hits per attack, r = fire rate, w_t = the type\'s modded damage (separate elements excluded).',
      },
    ],
  },
  {
    id: 'simulate',
    title: 'Time windows and sustained DPS',
    where: 'Calculator, Leaderboard',
    summary: 'Damage over a stretch of time: shots on the fire rate, magazine and reload, status procs ticking on their own clocks. A deterministic expected version for the optimizer and a Monte Carlo version for the bad-luck / good-luck range.',
    complexity: String.raw`O(N_{shots}\cdot T\cdot \bar k)`,
    sources: [{ file: SIM, symbol: 'shotTimes' }, { file: SIM, symbol: 'expectedDamage' }, { file: SIM, symbol: 'simulateDamage' }, { file: SIM, symbol: 'heatExpiries' }, { file: SIM, symbol: 'ticksInside' }],
    steps: [
      'Shot times from t = 0: a full magazine at the fire rate, then a reload, and so on, until the window closes.',
      'Each shot adds its expected direct damage and, per status type, its expected procs\' DoT ticks that land inside the window (and before the proc expires).',
      'Heat: every stack refreshes on a new Heat proc, so stacks die together only when no new Heat proc lands within one duration.',
      'Monte Carlo: crits and procs rolled per pellet with a seeded mulberry32 RNG, runs capped at ~400k pellet rolls (60–300 runs).',
    ],
    equations: [
      {
        name: 'Shot times',
        tex: String.raw`t_{k+1} = t_k + \frac1r + R\cdot\big[(k+1) \bmod m = 0\big]`,
        complexity: String.raw`O(N_{shots})`,
      },
      {
        name: 'Expected damage in a window',
        tex: String.raw`E[D(T)] = \sum_{k} \Big(\bar h + \sum_{t} \pi_t\, \bar\tau_t \cdot \#\{\, j : t_k + \phi_t + j < \min(T,\; t_k + d_t) \,\}\Big)`,
        complexity: String.raw`O(N_{shots}\cdot T\cdot \bar k)`,
        note: 'π_t = expected procs of type t per shot, τ̄_t = average tick, φ_t = first tick delay, d_t = duration, k̄ = ticks per proc.',
      },
    ],
  },
  {
    id: 'incarnon',
    title: 'Incarnon battery and refill',
    where: 'Calculator, Leaderboard',
    summary: 'Incarnon forms fire a fixed battery of charges, then have to be refilled from the normal form with weak point hits. The refill counts as the form\'s "reload".',
    complexity: 'O(1)',
    sources: [{ file: DMG, symbol: 'INCARNON_SWAP_RELOADS' }, { file: DMG, symbol: 'calculateOnce' }, { file: 'src/data/reloads.ts', symbol: 'SHELL_BY_SHELL_RELOAD' }],
    steps: [
      'Charges come back per weak point hit (wiki: "each charge producing 3 rounds" on Vasto). Every normal-form bullet is assumed to land on a weak point (Torid / Angstrum count direct hits): the best case.',
      'Hits land at the normal form\'s own rate (its fire rate mods count) times its projectiles, reloads included.',
      'Switching forms takes {{src/calc/damage.ts#INCARNON_SWAP_RELOADS}}× the base form\'s reload each way (reload speed mods don\'t shorten it).',
      'Ammo Efficiency (mods, arcanes, evolutions) never stretches the charges: they aren\'t ammo.',
      'The refill\'s reloads are the base form\'s: shell-by-shell weapons (Felarx, Strun) reload shell by shell with the base form\'s modded magazine. The swap uses the listed reload stat.',
    ],
    equations: [
      {
        name: 'Refill time',
        tex: String.raw`t_{refill} = \frac{Q / \rho}{(1 + g)\; r_{norm}\; n_{proj}} + t_{reloads} + 2\cdot {{src/calc/damage.ts#INCARNON_SWAP_RELOADS}}\cdot R_{base}`,
        complexity: 'O(1)',
        note: 'Q = charges, ρ = rounds per hit, g = charge gain bonus (Incarnon Efficiency), t_reloads = the base form\'s own reloads while filling (shell by shell where it applies), R_base = the listed reload.',
      },
      {
        name: 'Sustained DPS of the form',
        tex: String.raw`\text{DPS} = \frac{D_{battery}}{t_{fire} + t_{refill}}`,
        complexity: 'O(1)',
      },
    ],
  },
  {
    id: 'percentile',
    title: 'Weapon standing (percentiles)',
    where: 'Compare › Weapons, Rivens',
    summary: 'Where a weapon\'s base numbers sit among its own subtype (shotguns vs shotguns, glaives vs glaives), from the unmodded attack data.',
    complexity: String.raw`O(n)\text{ per stat}`,
    sources: [{ file: 'src/calc/weaponProfile.ts', symbol: 'standing' }, { file: 'src/calc/weaponProfile.ts', symbol: 'MIN_GROUP' }, { file: 'src/calc/weaponProfile.ts', symbol: 'rankGroup' }],
    steps: [
      'Each weapon counts once per pool, by its first attack (or first Incarnon attack for the Incarnon pool). Exalted weapons are left out.',
      'A subtype with fewer than {{src/calc/weaponProfile.ts#MIN_GROUP}} weapons falls back to the whole category.',
      'Ties count half, so a value most weapons share reads as typical, not the lowest. "Highest" / "lowest" only when few weapons share the value.',
    ],
    equations: [
      {
        name: 'Share beaten',
        tex: String.raw`\text{beats}(v) = \frac{\#\{u < v\} + \max(0,\, \#\{u = v\} - 1)/2}{n - 1}`,
        complexity: 'O(n)',
        note: 'Flipped (counts u > v) for stats where lower is better, like reload time.',
      },
    ],
  },
  {
    id: 'enervate',
    title: 'Secondary Enervate average crit',
    where: 'Calculator, Data Analysis',
    summary: 'Enervate adds +10% crit per hit and resets after 6 big crits. The calc averages crit over a whole build-up-and-reset cycle as a small Markov chain.',
    complexity: String.raw`O(K\cdot J)`,
    sources: [{ file: DMG, symbol: 'enervateAverageCrit' }],
    steps: [
      'State = (hit number k, big crits so far j). A big crit (orange or red) happens with chance crit − 100% once crit is past 100%.',
      'The 6th big crit ends the cycle. Run until the remaining probability mass is under 10⁻¹².',
    ],
    equations: [
      {
        name: 'Chain',
        tex: String.raw`c_k = c_0 + 0.1k,\quad p_k = \operatorname{clamp}(c_k - 1, 0, 1),\quad \pi_{k+1,j} = \pi_{k,j}(1 - p_k) + \pi_{k,j-1}\,p_k \;\; (j < 6)`,
        complexity: String.raw`O(K\cdot J),\; J = 6`,
      },
      {
        name: 'Average crit',
        tex: String.raw`\bar c = \frac{\sum_k c_k \sum_j \pi_{k,j}}{\sum_k \sum_j \pi_{k,j}}`,
        complexity: 'O(K)',
        note: 'Past 200% every hit is a big crit, so it resets every 6 hits: (0 + 10 + … + 50%) / 6 = +25%.',
      },
    ],
  },
  {
    id: 'analysis',
    title: 'Data Analysis statistics',
    where: 'Experimental › Data Analysis',
    summary: 'Arsenal-wide summaries: medians, histograms, release-update buckets, Prime uplift and how well base stats predict leaderboard score.',
    complexity: String.raw`O(n \log n)`,
    sources: [
      { file: 'src/components/DataExplorer.tsx', symbol: 'median' },
      { file: 'src/components/DataExplorer.tsx', symbol: 'spearman' },
      { file: 'src/components/DataExplorer.tsx', symbol: 'pickShot' },
      { file: 'src/components/DataExplorer.tsx', symbol: 'applyEvolutions' },
      { file: 'src/components/DataExplorer.tsx', symbol: 'ERA_SIZE' },
      { file: 'src/components/DataExplorer.tsx', symbol: 'rowsFor' },
    ],
    steps: [
      'Per weapon, one shot per attack mode (normal, alt-fire / special, Incarnon, melee heavy): merged parts summed, the hardest-hitting one when there are several.',
      'Incarnon weapons get the base-stat lines of the evolutions the leaderboard picked for that attack.',
      'Unmodded DPS: each weapon run through the damage calculation with no mods and no arcane, only its innate passives and those evolutions, sustained DPS on the neutral target (one whole heavy for melee heavies). The subtype section uses only this; the leaderboard section is the only place with modded builds.',
      'Release trends bucket the wiki\'s "Introduced" update into groups of {{src/components/DataExplorer.tsx#ERA_SIZE}} updates.',
    ],
    equations: [
      {
        name: 'Median',
        tex: String.raw`\tilde x = \begin{cases} x_{((n+1)/2)} & n \text{ odd}\\ \tfrac12\big(x_{(n/2)} + x_{(n/2+1)}\big) & n \text{ even}\end{cases}`,
        complexity: String.raw`O(n\log n)`,
      },
      {
        name: 'Spearman rank correlation',
        tex: String.raw`\rho = \frac{\sum_i (R_i - \bar R)(S_i - \bar S)}{\sqrt{\sum_i (R_i - \bar R)^2 \sum_i (S_i - \bar S)^2}}`,
        complexity: String.raw`O(n\log n)`,
        note: 'R, S = ranks of the base stat and the score, ties share their average rank.',
      },
      {
        name: 'Prime uplift',
        tex: String.raw`\Delta = \operatorname{median}_{(b,\,p)}\Big(\frac{x_p}{x_b} - 1\Big)`,
        complexity: 'O(n log n)',
      },
    ],
  },
  {
    id: 'about-sync',
    title: 'This page\'s sync check',
    where: 'About',
    summary: 'Every write-up here cites the functions it describes and is stamped with a hash of them. When the code changes, the write-up is flagged as out of date and the project\'s checks fail until it\'s reread and restamped.',
    complexity: String.raw`O(|\text{source}|)`,
    sources: [{ file: 'src/about/sync.ts' }],
    steps: [
      'Each cited function is cut out of its file by bracket matching from its declaration; comment-only lines and whitespace are dropped so rewording a comment doesn\'t count.',
      'Numbers written as placeholders are read out of the code when the page renders, so a changed constant updates itself.',
    ],
    equations: [
      {
        name: 'Stamp',
        tex: String.raw`h = \operatorname{FNV1a}_{32}\Big(\textstyle\bigoplus_{s \in \text{sources}} \operatorname{normalize}(\operatorname{extract}(s))\Big),\qquad \text{stale} \iff h \ne h_{verified}`,
        complexity: String.raw`O(|\text{source}|)`,
      },
    ],
  },
]
