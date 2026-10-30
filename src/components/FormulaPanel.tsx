// the bottom of the calculator: the damage math written out in LaTeX with the current build's numbers plugged in.
// three formulas: one damage instance, one status proc, and damage over a time window. the numbers come straight
// from the calc's own factors (result.breakdown / dot.factors), so they multiply out to what the stats panel shows
import { useMemo, useState } from 'react'
import katex from 'katex'
import type { CalcResult, TypePart } from '../calc/damage'
import { expectedDamage, shotTimes } from '../calc/simulate'

interface Props {
  result: CalcResult
}

type CritView = 'average' | 'normal' | 'crit'
type Show = 'both' | 'symbols' | 'numbers'

// numbers for LaTeX: 3 significant decimals on small ones, thousands separators on big ones
const num = (value: number) => {
  if (!Number.isFinite(value)) return '\\infty'
  const abs = Math.abs(value)
  const text = abs >= 1000 ? Math.round(value).toLocaleString('en-US') : abs >= 10 ? value.toFixed(2) : value.toFixed(3)
  return text.replace(/\.?0+$/, (match) => (text.includes('.') ? '' : match)).replace(/,/g, '{,}')
}
const label = (text: string) => `\\text{\\tiny ${text}}`

function Tex({ tex }: { tex: string }) {
  // line breaks need an environment in display mode
  const source = tex.includes('\\\\') ? `\\begin{gathered}${tex}\\end{gathered}` : tex
  const html = useMemo(() => katex.renderToString(source, { displayMode: true, throwOnError: false }), [source])
  return <div className="formula-tex" dangerouslySetInnerHTML={{ __html: html }} />
}

// inline symbol for the legend
function Sym({ tex }: { tex: string }) {
  const html = useMemo(() => katex.renderToString(tex, { displayMode: false, throwOnError: false }), [tex])
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

const quantized = (raw: number) => Math.floor(raw * 32 + 0.5) / 32
const cap = (word: string) => word[0].toUpperCase() + word.slice(1)

// one type's share written out: physical = base share x (1 + IPS mods), elements = mods + innate share (combined
// elements list both halves)
function partSymbols(parts: TypePart[], damageType: string): string {
  return parts.map((part) => {
    if (part.kind === 'physical') return `\\tfrac{B_{${label(damageType)}}}{B}(1+P_{${label(damageType)}})`
    if (part.kind === 'element') return `(E_{${label(part.element)}}${part.innate > 0 ? ` + \\tfrac{B_{${label(part.element)}}}{B}` : ''})`
    return part.source === 'ability' ? `G_{${label(damageType)}}` : `Z_{${label(damageType)}}`
  }).join(' + ')
}
function partNumbers(parts: TypePart[]): string {
  return parts.map((part) => {
    if (part.kind === 'physical') return `${num(part.base)}\\cdot(1+${num(part.mod)})`
    if (part.kind === 'element') return part.innate > 0 ? `(${num(part.mod)}+${num(part.innate)})` : num(part.mod)
    return num(part.value)
  }).join(' + ')
}

function FormulaBlock({ title, note, symbols, numbers, show }: { title: string; note?: string; symbols: string; numbers: string; show: Show }) {
  const [copied, setCopied] = useState(false)
  const latex = [show !== 'numbers' ? symbols : null, show !== 'symbols' ? numbers : null].filter(Boolean).join('\n\\\\[6pt]\n')
  const copy = () => {
    void navigator.clipboard?.writeText(latex)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="formula-block">
      <div className="row spread">
        <h3>{title}</h3>
        <button onClick={copy}>{copied ? 'Copied' : 'Copy LaTeX'}</button>
      </div>
      {show !== 'numbers' && <Tex tex={symbols} />}
      {show !== 'symbols' && <Tex tex={numbers} />}
      {note && <p className="muted">{note}</p>}
    </div>
  )
}

export function FormulaPanel({ result }: Props) {
  const [show, setShow] = useState<Show>('both')
  const [critView, setCritView] = useState<CritView>('average')
  const [seconds, setSeconds] = useState(10)
  const [dotPick, setDotPick] = useState<string | null>(null)
  const b = result.breakdown
  const dot = result.dots.find((row) => row.damageType === dotPick) ?? result.dots[0] ?? null

  // the crit factor for the picked view
  const crit = {
    average: { symbol: 'K = 1 + c\\,(k-1)' + (b.attrition > 0 ? ' + A' : ''), value: b.critAverage + b.attrition, name: 'average' },
    normal: { symbol: 'K = 1 + \\lfloor c \\rfloor (k-1)', value: b.critNormal, name: 'lowest tier' },
    crit: { symbol: 'K = 1 + \\lceil c \\rceil (k-1)', value: b.critHit, name: 'next tier up' },
  }[critView]

  // damage scale: how CO goes in depends on the weapon (wiki Condition Overload)
  const scaleSymbol = b.coMode === 'multiply' ? '(1+M)(1+CO)\\,S' : b.coMode === 'add' ? '(1+M)\\,S + CO' : '(1+M)\\,S'
  const scaleNumbers = b.coMode === 'multiply'
    ? `(1+${num(b.damageBonus)})(1+${num(b.coBonus)})\\cdot ${num(b.separateMultiplier)}`
    : b.coMode === 'add'
      ? `(1+${num(b.damageBonus)})\\cdot ${num(b.separateMultiplier)} + ${num(b.coBonus)}`
      : `(1+${num(b.damageBonus)})\\cdot ${num(b.separateMultiplier)}`
  const beams = result.beam && result.beamMerge > 1

  // ---- one damage instance ----
  const typeSum = b.types.map((row) => `${num(row.share)}\\cdot ${num(row.type)}_{${label(row.damageType)}}`).join(' + ')
  const sumValue = b.types.reduce((total, row) => total + row.share * row.type, 0)
  const instanceValue = (b.baseDamage * b.damageScale * b.heavyCombo * sumValue + b.extraHit) * b.faction * (1 + b.vulnerability) * b.headshot * crit.value
    * (beams ? result.beamMerge : 1)
  const hitSymbols = [
    'H = \\Big(\\underbrace{B}_{' + label('base') + '}\\cdot\\underbrace{\\big[' + scaleSymbol + '\\big]}_{' + label('damage scale') + '}',
    b.heavyCombo !== 1 ? '\\cdot \\underbrace{C}_{' + label('combo') + '}' : '',
    '\\cdot \\sum_t \\underbrace{q_t}_{' + label('share') + '} \\underbrace{T_t}_{' + label('vs target') + '}',
    b.extraHit > 0 ? ' + X' : '',
    '\\Big)\\cdot \\underbrace{F}_{' + label('faction') + '}\\cdot (1+V)\\cdot \\underbrace{W}_{' + label('headshot') + '}\\cdot K',
    beams ? '\\cdot \\underbrace{b}_{' + label('beams') + '}' : '',
    ',\\quad ' + crit.symbol,
  ].join('')
  const hitNumbers = [
    `H = \\Big(${num(b.baseDamage)}\\cdot\\big[${scaleNumbers}\\big]`,
    b.heavyCombo !== 1 ? `\\cdot ${num(b.heavyCombo)}` : '',
    `\\cdot \\big(${typeSum || '0'}\\big)`,
    b.extraHit > 0 ? ` + ${num(b.extraHit)}` : '',
    `\\Big)\\cdot ${num(b.faction)}\\cdot (1+${num(b.vulnerability)})\\cdot ${num(b.headshot)}\\cdot ${num(crit.value)}`,
    beams ? `\\cdot ${num(result.beamMerge)}` : '',
    ` = \\mathbf{${num(instanceValue)}}`,
  ].join('')
  const hitNote = `Quantized shares q (each type rounded to 1/32 of base). T = faction weakness × armor × Viral/Magnetic for that type. `
    + `Crit: ${crit.name}, c = ${(b.critChance * 100).toFixed(1)}%, k = ${b.critMultiplier.toFixed(2)}×.`
    + (b.coMode === 'add' ? ' This weapon adds CO outside the damage mods.' : b.coMode === 'multiply' ? ' This weapon multiplies CO with the damage mods.' : '')

  // ---- where each type's share and target multiplier come from ----
  const typeRows = b.typeParts.map((row) => ({ row, target: b.types.find((typeRow) => typeRow.damageType === row.damageType) }))
  const combined = b.typeParts.filter((row) => row.parts.filter((part) => part.kind === 'element').length === 2)
  const typesSymbols = [
    `q_t = \\frac{\\lfloor 32\\,\\hat q_t + \\tfrac12\\rfloor}{32},\\qquad`,
    `\\hat q_{${label('IPS')}} = \\tfrac{B_t}{B}\\,(1+P_t),\\qquad`,
    `\\hat q_{${label('element')}} = E_t + \\tfrac{B_t}{B},\\qquad`,
    `\\hat q_{${label('combined')}} = \\hat q_{e_1} + \\hat q_{e_2},\\qquad`,
    `T_t = \\underbrace{w_t}_{${label('weakness')}}\\cdot\\underbrace{\\alpha_t}_{${label('armor')}}\\cdot\\underbrace{D}_{${label(b.types[0]?.debuffName === 'magnetic' ? 'magnetic' : 'viral')}}`,
  ].join(' ')
  const typesNumbers = typeRows.map(({ row, target }) => {
    const name = label(row.damageType)
    const q = quantized(row.raw)
    const share = `\\hat q_{${name}} = ${partSymbols(row.parts, row.damageType)} = ${partNumbers(row.parts)} = ${num(row.raw)}\\ \\to\\ q = ${num(q)}`
    const t = target ? `,\\qquad T_{${name}} = ${num(target.weakness)}\\cdot ${num(target.armor)}\\cdot ${num(target.debuff)} = ${num(target.type)}` : ''
    return share + t
  }).join(' \\\\ ')
  const typesNote = 'B_t = the attack\'s own base damage of that type, P = physical (IPS) mods for that type, E = elemental mods for that element '
    + '(a % of all base damage, not just one type). '
    + (combined.length ? `Combined: ${combined.map((row) => `${cap(row.damageType)} = ${row.parts.map((part) => (part.kind === 'element' ? part.element : '')).join(' + ')}`).join(', ')} (elements pair up in mod order, innate ones go last). ` : '')
    + 'Each type is rounded to the nearest 1/32 of base on its own (quantization). w = the faction\'s weakness or resistance, '
    + `α = 1 − armor reduction (${typeRows.some(({ target }) => target && target.armor < 1) ? `${num(1 - (typeRows.find(({ target }) => target && target.armor < 1)?.target?.armor ?? 1))} of the damage blocked here` : 'no armor here'}, Slash procs and True damage skip it), `
    + 'D = Viral on health (Magnetic on shields / overguard).'

  // ---- one status proc ----
  let procSymbols = ''
  let procNumbers = ''
  let procNote = ''
  if (dot) {
    const f = dot.factors
    const critFactor = crit.value - (critView === 'average' ? b.attrition : 0) // attrition is a direct-hit thing
    const tick = f.fraction * f.statusBase * f.element * f.faction * (1 + f.statusDamage) * (1 + f.vulnerability) * f.headshot * f.merged * f.type * critFactor
    procSymbols = [
      `\\text{tick}_{${label(dot.damageType)}} = \\underbrace{f}_{${label('fraction')}}\\cdot\\underbrace{B\\,\\big[${scaleSymbol}\\big]${b.heavyCombo !== 1 ? 'C' : ''}\\,F}_{${label('status base')}}`,
      `\\cdot \\underbrace{E}_{${label('element mods')}}\\cdot F\\cdot (1+\\underbrace{SD}_{${label('status dmg')}})\\cdot (1+V)\\cdot W`,
      f.merged !== 1 ? '\\cdot b' : '',
      `\\cdot T\\cdot K,\\quad \\text{proc} = \\text{tick}\\cdot N,\\quad \\text{DPS} = r\\cdot\\text{proc}`,
    ].join('')
    procNumbers = [
      `\\text{tick} = ${num(f.fraction)}\\cdot ${num(f.statusBase)}\\cdot ${num(f.element)}\\cdot ${num(f.faction)}\\cdot (1+${num(f.statusDamage)})\\cdot (1+${num(f.vulnerability)})\\cdot ${num(f.headshot)}`,
      f.merged !== 1 ? `\\cdot ${num(f.merged)}` : '',
      `\\cdot ${num(f.type)}\\cdot ${num(critFactor)} = \\mathbf{${num(tick)}}`,
      `\\\\ \\text{proc} = ${num(tick)}\\cdot ${dot.ticks} = \\mathbf{${num(tick * dot.ticks)}},\\quad \\text{DPS} = ${num(dot.procsPerSecond)}/\\text{s}\\cdot ${num(tick * dot.ticks)} = \\mathbf{${num(dot.procsPerSecond * tick * dot.ticks)}}`,
    ].join('')
    procNote = `Faction counts twice on status damage (once in the status base, once more). The status base uses the full modded base, `
      + `not this type's share. N = ${dot.ticks} tick${dot.ticks === 1 ? '' : 's'}${dot.damageType === 'heat' ? ' (Heat refreshes, so sustained fire keeps it going)' : ''}. `
      + `r = procs per second. ${f.merged !== 1 ? 'b = merged beams (beams count multishot twice on damaging procs). ' : ''}`
  }

  // ---- damage over a window ----
  const model = result.shotModel
  const windowSeconds = Math.max(1, seconds)
  const shots = shotTimes(model, windowSeconds).length
  const direct = shots * model.multishot * model.hit.average
  const dotParts = model.dots
    .map((dotModel) => ({ dotModel, damage: expectedDamage({ ...model, hit: { normal: 0, crit: 0, average: 0 }, dots: [dotModel] }, windowSeconds) }))
    .filter((part) => part.damage > 0)
  const total = direct + dotParts.reduce((sum, part) => sum + part.damage, 0)
  const windowSymbols = [
    `D(\\tau) = \\underbrace{n(\\tau)}_{${label('shots')}}\\cdot \\underbrace{m}_{${label('multishot')}}\\cdot \\bar H`,
    ` + \\sum_d n(\\tau)\\cdot \\underbrace{p_d}_{${label('procs/pellet')}}\\cdot m\\cdot \\overline{\\text{tick}}_d\\cdot \\underbrace{\\bar k_d(\\tau)}_{${label('ticks landed per proc')}}`,
    `,\\quad \\text{DPS}_\\tau = \\frac{D(\\tau)}{\\tau}`,
  ].join('')
  const dotTerms = dotParts.map(({ dotModel, damage }) => {
    const perTick = dotModel.procsPerPellet * model.multishot * dotModel.tick.average
    // average ticks each proc gets in before the window closes (Heat's refreshes can push it past 6)
    const landedPerProc = perTick > 0 && shots > 0 ? damage / perTick / shots : 0
    return `\\underbrace{${shots}\\cdot ${num(dotModel.procsPerPellet)}\\cdot ${num(model.multishot)}\\cdot ${num(dotModel.tick.average)}\\cdot ${num(landedPerProc)}}_{${label(dotModel.damageType)}}`
  }).join(' + ')
  const windowNumbers = [
    `D(${windowSeconds}) = ${shots}\\cdot ${num(model.multishot)}\\cdot ${num(model.hit.average)}`,
    dotTerms ? ` + ${dotTerms}` : '',
    ` = \\mathbf{${num(total)}},\\quad \\text{DPS}_{${windowSeconds}} = \\mathbf{${num(total / windowSeconds)}}`,
  ].join('')
  const windowNote = `n(τ): shots fired in ${windowSeconds}s at ${model.fireRate.toFixed(2)}/s`
    + (model.magazineSize ? ` with a ${model.magazineSize}-round magazine and ${model.reloadTime?.toFixed(2)}s reloads` : ', no reloads')
    + `. H̄ is the average hit per pellet (crits averaged, whatever the crit view above). p = procs per pellet, k̄ = ticks of that`
    + ` status each proc gets in before the window closes, on average (late procs get cut off, Heat's refreshes keep old stacks going past 6).`

  // every symbol, what it is, and what it is right now
  const physicalMods = b.typeParts.flatMap((row) => row.parts.flatMap((part) => (part.kind === 'physical' && part.mod ? [`${row.damageType} ${num(part.mod * 100)}%`] : [])))
  const elementMods = b.typeParts.flatMap((row) => row.parts.flatMap((part) => (part.kind === 'element' && part.mod ? [`${part.element} ${num(part.mod * 100)}%`] : [])))
  const legend: { sym: string; meaning: string; value: string }[] = [
    { sym: 'B', meaning: 'base damage of the attack (all types)', value: num(b.baseDamage) },
    { sym: 'B_t', meaning: 'base damage of one type', value: Object.keys(result.damageTypes).length ? 'per type, see Damage types' : '' },
    { sym: 'M', meaning: 'base damage mods (Serration, Pressure Point...)', value: `+${num(b.damageBonus * 100)}%` },
    { sym: 'S', meaning: 'separate multipliers (Sharpshot, slam / throw / finisher bonuses...)', value: `×${num(b.separateMultiplier)}` },
    ...(b.coMode !== 'none' ? [{ sym: 'CO', meaning: `Condition Overload / Galvanized per status (${b.coMode === 'multiply' ? 'multiplies' : 'adds'} on this weapon)`, value: `+${num(b.coBonus * 100)}%` }] : []),
    ...(b.heavyCombo !== 1 ? [{ sym: 'C', meaning: 'heavy attack / ability combo multiplier', value: `×${num(b.heavyCombo)}` }] : []),
    { sym: 'P_t', meaning: 'physical (IPS) mods for that type', value: physicalMods.join(', ') || 'none' },
    { sym: 'E_t', meaning: 'elemental mods for that element (% of all base damage)', value: elementMods.join(', ') || 'none' },
    { sym: 'q_t', meaning: 'share of base damage for type t, rounded to 1/32', value: b.types.map((row) => `${row.damageType} ${num(row.share)}`).join(', ') },
    { sym: 'T_t', meaning: 'how much of type t reaches health: w · α · D', value: b.types.map((row) => `${row.damageType} ${num(row.type)}`).join(', ') },
    { sym: 'w_t', meaning: 'faction weakness / resistance', value: b.types.map((row) => `${row.damageType} ${num(row.weakness)}`).join(', ') },
    { sym: '\\alpha_t', meaning: 'armor: 1 − damage reduction', value: num(Math.min(...b.types.map((row) => row.armor), 1)) },
    { sym: 'D', meaning: 'Viral (health) / Magnetic (shields) debuff', value: `×${num(b.types[0]?.debuff ?? 1)}` },
    ...(b.extraHit > 0 ? [{ sym: 'X', meaning: 'separate extra hits (Xata\'s Whisper...)', value: num(b.extraHit) }] : []),
    { sym: 'F', meaning: 'faction damage (Bane, Roar)', value: `×${num(b.faction)}` },
    { sym: 'V', meaning: 'damage vulnerability on the target', value: `+${num(b.vulnerability * 100)}%` },
    { sym: 'W', meaning: 'headshot multiplier', value: `×${num(b.headshot)}` },
    { sym: 'c', meaning: 'crit chance', value: `${num(b.critChance * 100)}%` },
    { sym: 'k', meaning: 'crit multiplier', value: `${num(b.critMultiplier)}×` },
    { sym: 'K', meaning: `crit factor (${crit.name})`, value: `×${num(crit.value)}` },
    ...(b.attrition > 0 ? [{ sym: 'A', meaning: 'Devouring Attrition style non-crit bonus', value: num(b.attrition) }] : []),
    ...(beams ? [{ sym: 'b', meaning: 'beams merged into one tick (multishot on a beam)', value: num(result.beamMerge) }] : []),
    ...(dot ? [
      { sym: 'f', meaning: `status damage fraction (${dot.damageType})`, value: num(dot.factors.fraction) },
      { sym: 'SD', meaning: 'status damage mods', value: `+${num(dot.factors.statusDamage * 100)}%` },
      { sym: 'N', meaning: 'ticks per proc', value: String(dot.ticks) },
      { sym: 'r', meaning: 'procs per second', value: num(dot.procsPerSecond) },
    ] : []),
    { sym: 'n(\\tau)', meaning: 'shots fired in the window', value: String(shots) },
    { sym: 'm', meaning: 'multishot', value: num(model.multishot) },
  ]

  return (
    <section className="panel formula-panel">
      <div className="row spread">
        <h2>Damage formulas</h2>
        <div className="row">
          <label className="inline-number">
            Show
            <select value={show} onChange={(event) => setShow(event.target.value as Show)}>
              <option value="both">symbols + numbers</option>
              <option value="symbols">symbols</option>
              <option value="numbers">numbers</option>
            </select>
          </label>
          <label className="inline-number">
            Crit
            <select value={critView} onChange={(event) => setCritView(event.target.value as CritView)}>
              <option value="average">averaged</option>
              <option value="normal">lowest tier</option>
              <option value="crit">next tier up</option>
            </select>
          </label>
          <label className="inline-number">
            Window
            <input type="number" min={1} max={300} value={seconds} onChange={(event) => setSeconds(Math.max(1, Math.min(300, Number(event.target.value) || 1)))} />
            s
          </label>
          {result.dots.length > 0 && (
            <label className="inline-number">
              Status
              <select value={dot?.damageType ?? ''} onChange={(event) => setDotPick(event.target.value)}>
                {result.dots.map((row) => <option key={row.damageType} value={row.damageType}>{row.damageType}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
      <details className="formula-legend" open>
        <summary>Legend</summary>
        <div className="legend-grid">
          {legend.map((entry) => (
            <div key={entry.sym} className="legend-row">
              <span className="legend-sym"><Sym tex={entry.sym} /></span>
              <span className="legend-meaning">{entry.meaning}</span>
              <span className="legend-value">{entry.value}</span>
            </div>
          ))}
        </div>
      </details>
      <FormulaBlock title="Single damage instance" symbols={hitSymbols} numbers={hitNumbers} note={hitNote} show={show} />
      <FormulaBlock title="Damage types (IPS and elements)" symbols={typesSymbols} numbers={typesNumbers} note={typesNote} show={show} />
      {dot
        ? <FormulaBlock title={`Status proc damage (${dot.damageType})`} symbols={procSymbols} numbers={procNumbers} note={procNote} show={show} />
        : <p className="muted">No status procs on this attack (no status chance, or the target is immune).</p>}
      <FormulaBlock title={`Damage in a ${windowSeconds} s window`} symbols={windowSymbols} numbers={windowNumbers} note={windowNote} show={show} />
    </section>
  )
}
