// the Status Guide tab: how each status effect's damage scales and what it does for a mission, with the numbers the
// calculator uses. everything here is from the wiki (Status_Effect, Damage_over_Time, Damage/Heat_Damage, Oct 2026)
import { useState } from 'react'

interface DotStatus {
  type: string
  name: string // the proc's in-game name
  perTick: string
  timing: string
  scalesWith: string[]
  doesNot: string[]
  macro: string
  goodOn: string
  calc: string // what the calculator does with it
}

const DOTS: DotStatus[] = [
  {
    type: 'slash', name: 'Bleed', perTick: '35% of modded base damage', timing: '6 ticks, the first 1 s after the proc. Stacks with no limit.',
    scalesWith: ['Base damage mods (Serration)', 'Crit of the hit that applied it', 'Faction mods, twice', 'Status damage (Elementalist)', 'Headshots'],
    doesNot: ['Slash mods: "Sawtooth Clip do not buff Slash status damage"', 'Armor: "This damage bypasses Armor"'],
    macro: 'The armor answer. Bleeds ignore armor completely, so they keep full damage on Steel Path Grineer where every other DoT is cut down.',
    goodOn: 'High-Slash weapons, and anything with Hunter Munitions (Slash on crit) or Internal Bleeding (Slash on Impact procs).',
    calc: 'Modeled per proc, armor-free. Hunter Munitions and Internal Bleeding add Slash procs.',
  },
  {
    type: 'heat', name: 'Ignite', perTick: '50% of modded base damage × (1 + Heat mods)', timing: '6 ticks, 1 s delay. Every new Heat proc refreshes all of them (see Heat Inherit).',
    scalesWith: ['Base damage mods', 'Heat mods (Hellfire)', 'Crit and headshots of the hit', 'Faction mods, twice', 'Status damage'],
    doesNot: ['Only literal Heat mods count: Heat combined into Blast/Gas/Radiation isn\'t Heat any more'],
    macro: 'Strips up to 50% armor (15/30/40/50% in 0.5 s steps) and makes most enemies panic for about 4 s. Stacks keep growing as long as you keep proccing it.',
    goodOn: 'Fast, high-status weapons that can keep the stacks refreshed (Ignis, Trumna, Heat beams). Weak on slow single shots.',
    calc: 'Sustained DPS models the stacking over a 10 s fight: each proc refreshes the rest, so it ramps. The armor strip is the Debuffs panel\'s Heat strip.',
  },
  {
    type: 'toxin', name: 'Poison', perTick: '50% of modded base damage × (1 + Toxin mods)', timing: '6 ticks, 1 s delay. Stacks with no limit, each on its own timer.',
    scalesWith: ['Base damage mods', 'Toxin mods (Infected Clip)', 'Crit and headshots', 'Faction mods, twice', 'Status damage'],
    doesNot: ['Shields: "This damage can bypass Shields"', 'Armor: it does get reduced by armor'],
    macro: 'Goes straight to health on shielded Corpus, so shields don\'t have to come down first.',
    goodOn: 'Status weapons fighting Corpus or anything with big shields.',
    calc: 'Modeled per proc; on the shield layer it hits health instead.',
  },
  {
    type: 'electricity', name: 'Tesla Chain', perTick: '50% of modded base damage × (1 + Electricity mods)', timing: '6 ticks starting the moment it procs (0-5 s).',
    scalesWith: ['Base damage mods', 'Electricity mods (Stormbringer)', 'Crit and headshots', 'Faction mods, twice', 'Status damage'],
    doesNot: ['It stuns the target for 3 s, but the stun doesn\'t get longer with Status Duration'],
    macro: 'Hits everything within 3 m of the target and stuns, so it\'s crowd damage plus crowd control.',
    goodOn: 'Weapons fighting in packs. Shines with multishot shotguns and AoE weapons.',
    calc: 'Counted on the one target only, so in a crowd it does more than the calculator shows.',
  },
  {
    type: 'gas', name: 'Gas Cloud', perTick: '50% of modded base damage × (1 + Gas mods)', timing: '6 ticks from the moment it procs. Up to 10 clouds; each stack adds 0.3 m to the 3 m radius.',
    scalesWith: ['Base damage mods', 'Only literal Gas mods (Leaded Gas, Valence Formation)', 'Crit and headshots of the hit', 'Faction mods, twice', 'Status damage'],
    doesNot: ['Heat and Toxin mods: "DoTs of combined status effects (i.e. Gas, Blast) are not buffed by their component mods"'],
    macro: 'An area cloud around the target that damages everything inside it. Strong AoE clear on status weapons.',
    goodOn: 'High-status weapons in dense missions, especially with Leaded Gas or a Gas bonus element.',
    calc: 'Counted on the one target; clouds beyond the 10-stack cap aren\'t.',
  },
  {
    type: 'blast', name: 'Detonate', perTick: '30% of modded base damage, once, after 1.5 s', timing: 'One hit after a 1.5 s fuse. At 10 stacks every stack pops at once.',
    scalesWith: ['Base damage mods', 'Only literal Blast damage (a Blast riven or bonus element)', 'Crit and headshots of the hit', 'Faction mods, twice', 'Status damage'],
    doesNot: ['Heat and Cold mods ("not buffed by their component mods")', 'Status Duration: it\'s one hit, so there are no extra ticks'],
    macro: 'The 10-stack pop deals 300% of base damage per stack to enemies within 5 m, a chain-reaction clear on status-heavy weapons.',
    goodOn: 'Very high status AoE or multishot weapons that can reach 10 stacks quickly.',
    calc: 'Modeled as the delayed hit on the target; the 10-stack pop shows as "10-stack AoE" on other enemies.',
  },
]

interface UtilityStatus { type: string; name: string; effect: string; macro: string; calc: string }
const UTILITY: UtilityStatus[] = [
  { type: 'viral', name: 'Virus', effect: '+100% damage to health, +25% per extra stack, up to 325% at 10 stacks. 6 s.', macro: 'The biggest single multiplier against health. Even one stack doubles every hit.', calc: 'Debuffs panel: Viral stacks.' },
  { type: 'corrosive', name: 'Corrosion', effect: '-26% armor, -6% per extra stack, up to -80% at 10 stacks. 8 s.', macro: 'Strips armor for every weapon, yours and your squad\'s. Multiplies with Heat\'s strip.', calc: 'Debuffs panel: Corrosive stacks.' },
  { type: 'cold', name: 'Freeze', effect: '50% slow (+5% per stack, 90% at 9), +0.1x crit multiplier (+0.05 per stack, +0.5x at 9). At 10 stacks: frozen solid for 3 s, +1.0x crit multiplier.', macro: 'Crowd control, plus extra crit damage taken from direct hits (not AoE).', calc: 'Debuffs panel: Cold stacks add to your crit multiplier.' },
  { type: 'magnetic', name: 'Disrupt', effect: '+100% damage to shields and Overguard, +25% per stack, up to 325%. Stops shield regen. Breaking the shields triggers an Electricity proc worth 3% of max shields per stack.', macro: 'The Viral of shields and Overguard: Corpus, Eximus.', calc: 'Debuffs panel: Magnetic stacks, used on the shield and Overguard layers.' },
  { type: 'radiation', name: 'Confusion', effect: 'The target attacks its allies and takes 100% more damage from them (+50% per stack, up to 550%). 12 s.', macro: 'Turns heavy hitters against their own side.', calc: 'Not modeled (it\'s enemy-on-enemy damage).' },
  { type: 'puncture', name: 'Weakened', effect: 'The target deals 40% less damage (up to 80% at 5 stacks). You get +5% crit chance on it per stack, up to +25%, after mods, not for AoE.', macro: 'Survivability, plus a flat crit boost for direct hits.', calc: 'Debuffs panel: Puncture stacks add flat crit chance.' },
  { type: 'impact', name: 'Knockback', effect: 'Staggers for 1 s. Each stack raises the health threshold for a Parazon mercy kill by 8%, up to 5 stacks.', macro: 'Stagger and earlier mercy kills.', calc: 'Not modeled (no damage).' },
  { type: 'tau', name: 'Status Vulnerability', effect: '+10% status chance taken per stack, up to +100% at 10 stacks.', macro: 'Everything you hit procs more often.', calc: 'Debuffs panel: Tau stacks add status chance.' },
]

const SECTIONS = ['How DoT scales', 'Heat Inherit', 'Damaging statuses', 'Utility statuses', 'Building for status'] as const
const sectionId = (section: string) => `sg-${section.replace(/\s+/g, '-').toLowerCase()}`

export function StatusGuide() {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="status-guide">
      <section className="panel">
        <h2>Status guide</h2>
        <p className="muted">
          How each status effect's damage scales, and what it does for a whole mission. Numbers are from the wiki's Status Effect, Damage over Time and
          Heat Damage pages, and they're the ones the calculator uses.
        </p>
        <nav className="sg-jump">
          {/* buttons, not #links: the URL hash is the tab, so a #section link would bounce back to the calculator */}
          {SECTIONS.map((section) => (
            <button key={section} className="link-button" onClick={() => document.getElementById(sectionId(section))?.scrollIntoView({ behavior: 'smooth' })}>{section}</button>
          ))}
        </nav>
      </section>

      <section className="panel" id="sg-how-dot-scales">
        <h3>How DoT scales</h3>
        <p>Every damaging status tick starts from the hit that applied it, so it inherits most of that hit's multipliers:</p>
        <pre className="sg-formula">tick = fraction × modded base × (1 + that element's mods) × (1 + faction)² × (1 + status damage) × crit × body part</pre>
        <ul className="hint-list">
          <li><b>Modded base</b> is base damage × (1 + base damage mods like Serration). Physical and elemental mods aren't in it.</li>
          <li><b>Element mods</b> only count for their own status, and only as that literal element: Hellfire buffs Heat procs, not Gas or Blast. Slash has no "element", so Sawtooth Clip does nothing for bleeds.</li>
          <li><b>Faction mods count twice</b>: "they are applied once more during the calculation of damaging status effects". A 30% Bane is +69% on DoTs, a 55% Primed Bane is +140%.</li>
          <li><b>Crits and headshots carry over</b>: a proc from an orange crit headshot ticks for the crit and the headshot multiplier. Sonar / Detect Vulnerability weak spots don't carry over.</li>
          <li><b>Status damage</b> (Elementalist mods, Emerald shards) multiplies every DoT and stacks additively with other status damage.</li>
          <li><b>More procs</b> come from status chance, multishot and fire rate. <b>More ticks</b> come from Status Duration: one tick per extra second (6 s → 12 s doubles a proc).</li>
        </ul>
        <p className="muted-inline">Wiki example: 100 base, Serration, Bane of Grineer, +90% status damage → Bleed per tick = 100 × 2.65 × 0.35 × 1.3² × 1.9 ≈ 298.</p>
      </section>

      <section className="panel" id="sg-heat-inherit">
        <h3>Heat Inherit</h3>
        <p>
          A community term for how Heat stacks on one enemy. Other DoTs are separate instances with their own timers. Heat
          isn't: "a Heat proc both adds a stack and refreshes the duration of all currently active heat stacks", and all stacks tick together as one number.
        </p>
        <ul className="hint-list">
          <li className="tone-good"><b>It ramps forever:</b> keep proccing within 6 s and the tick keeps growing linearly. That's why fast Heat weapons climb so hard over a long fight.</li>
          <li className="tone-bad"><b>The first proc sets the mods:</b> Heat and faction bonuses come from the first Heat proc on the enemy. If an ability or Manifold Bond lights them first, your weapon's Hellfire and Bane are lost for that whole fire. Ember allies can make this hard to control.</li>
          <li><b>Status damage is the exception:</b> Elementalist mods count for your weapon's share no matter who lit the enemy.</li>
          <li><b>Duration takes the longest:</b> stacks share one timer, reset to the longest Status Duration that has refreshed it. One Continuous Misery weapon makes every later refresh 12 s, even from a weapon without it.</li>
          <li><b>Armor strip ramps on its own clock:</b> 15 / 30 / 40 / 50% every 0.5 s, so 2 s to the full 50%; more procs don't speed it up. +100% Status Duration slows the ramp to 4 s. It comes back off in 1.5 s steps after the fire ends.</li>
        </ul>
        <p className="muted-inline">
          The calculator assumes your weapon lands the first Heat proc and keeps refreshing it, so its Heat numbers are the best case. Heat strip from the Debuffs
          panel multiplies with Corrosive and Corrosive Projection.
        </p>
      </section>

      <section className="panel" id="sg-damaging-statuses">
        <h3>Damaging statuses</h3>
        <div className="sg-grid">
          {DOTS.map((dot) => (
            <article key={dot.type} className="sg-card">
              <header>
                <span className={`dmg-${dot.type} sg-type`}>{dot.type}</span>
                <span className="muted-inline">{dot.name}</span>
              </header>
              <div className="sg-tick"><b>Per tick:</b> {dot.perTick}</div>
              <div className="muted-inline">{dot.timing}</div>
              <div className="sg-cols">
                <div><h4>Scales with</h4><ul>{dot.scalesWith.map((line) => <li key={line}>{line}</li>)}</ul></div>
                <div><h4>Doesn't</h4><ul>{dot.doesNot.map((line) => <li key={line}>{line}</li>)}</ul></div>
              </div>
              <p><b>In a mission:</b> {dot.macro}</p>
              <p><b>Good on:</b> {dot.goodOn}</p>
              <button className="link-button" onClick={() => setOpen(open === dot.type ? null : dot.type)}>{open === dot.type ? 'Hide' : 'In the calculator'}</button>
              {open === dot.type && <p className="muted-inline">{dot.calc}</p>}
            </article>
          ))}
        </div>
      </section>

      <section className="panel" id="sg-utility-statuses">
        <h3>Utility statuses</h3>
        <p className="muted-inline">No damage of their own, but they multiply everyone else's, or control the fight. All of them count as a status type for Condition Overload and Galvanized mods.</p>
        <table className="sg-table">
          <thead><tr><th>Status</th><th>What it does</th><th>Why it matters</th><th>In the calculator</th></tr></thead>
          <tbody>
            {UTILITY.map((row) => (
              <tr key={row.type}>
                <td><span className={`dmg-${row.type} sg-type`}>{row.type}</span><div className="muted-inline">{row.name}</div></td>
                <td>{row.effect}</td>
                <td>{row.macro}</td>
                <td className="muted-inline">{row.calc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel" id="sg-building-for-status">
        <h3>Building for status</h3>
        <ul className="hint-list">
          <li>Procs land in proportion to each damage type's share of the hit, so one big element mod pushes most procs to it. A small Heat mod on a Slash weapon mostly steals bleeds.</li>
          <li>Status damage beats more of the same element once you have one element mod: Elementalist multiplies every DoT, a second Heat mod only adds to Heat.</li>
          <li>DoT counts less on short fights and ticks land over 6 s, so on enemies that die in a second the direct hit is what matters. The build advisor counts DoT at half on weapons under 25% base status for that reason.</li>
          <li>Status types are their own payoff. Condition Overload and Galvanized mods add damage per status type on the target, so a cheap Viral or Corrosive proc can be worth it for the multiplier alone.</li>
        </ul>
      </section>
    </div>
  )
}
