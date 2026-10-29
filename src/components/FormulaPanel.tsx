// the bottom of the calculator: the damage math written out in LaTeX with the current build's numbers plugged in.
// three formulas: one damage instance, one status proc, and damage over a time window. the numbers come straight
// from the calc's own factors (result.breakdown / dot.factors), so they multiply out to what the stats panel shows
import { useMemo, useState } from 'react'
import katex from 'katex'
import type { CalcResult } from '../calc/damage'
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
      <FormulaBlock title="Single damage instance" symbols={hitSymbols} numbers={hitNumbers} note={hitNote} show={show} />
      {dot
        ? <FormulaBlock title={`Status proc damage (${dot.damageType})`} symbols={procSymbols} numbers={procNumbers} note={procNote} show={show} />
        : <p className="muted">No status procs on this attack (no status chance, or the target is immune).</p>}
      <FormulaBlock title={`Damage in a ${windowSeconds} s window`} symbols={windowSymbols} numbers={windowNumbers} note={windowNote} show={show} />
    </section>
  )
}
