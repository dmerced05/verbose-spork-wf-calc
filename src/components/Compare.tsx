// third tab: pick a weapon, set up 2-4 build paths with their own rules (lock in / lock out mods, arcane and
// Incarnon perks, crit chance limits, a riven) and see what each path's best build does side by side.
// never writes to the leaderboard. builds that beat a leaderboard number in its own scenario get listed, with the
// command to rerun just those weapons
import { useEffect, useMemo, useRef, useState } from 'react'
import { arcanesById, getCompatibleArcanes, getCompatibleMods, modsById, weapons, weaponsById } from '../data'
import { getIncarnonTiers } from '../calc/incarnon'
import { RIVEN_MOD_ID, emptyRiven, rivenTypeFor, type RivenConfig, RIVEN_DISPOSITION } from '../calc/riven'
import { BOARDS } from '../optimizer/objectives'
import { boardsFor, emptyPath, type CompareResult, type ComparePath, type CompareRequest, type CompareScenario } from '../optimizer/compare'
import type { CompareMessage } from '../optimizer/compareWorker'
import type { SeedBuild } from '../optimizer/optimize'
import type { LeaderboardFile, LeaderboardEntry } from '../optimizer/leaderboardTypes'
import { SCENARIO_BUFFS, SCENARIO_DEBUFFS, SCENARIO_TARGET } from '../optimizer/scenario'
import type { StatusMode } from '../types'
import { RivenEditor } from './RivenEditor'
import { SearchSelect } from './SearchSelect'

interface Props {
  calculatorScenario: CompareScenario | null
  calculatorRiven: { weaponId: string; config: RivenConfig } | null
  onLoadBuild: (entry: LeaderboardEntry, riven: RivenConfig | null, keepScenario: boolean) => void
}

// builds found here that beat the leaderboard, kept in this browser so they can be rerun in one go later
interface Beat {
  weaponId: string
  weaponName: string
  attack: string
  board: string
  score: number
  leaderboardScore: number
  build: string
  foundAt: string
  seed: SeedBuild // what goes into scripts/leaderboard-seeds.json
}
const BEATS_KEY = 'wf-compare-beats'
const loadBeats = (): Beat[] => {
  try {
    return (JSON.parse(localStorage.getItem(BEATS_KEY) ?? '[]') as Beat[]).filter((beat) => beat.seed)
  } catch {
    return []
  }
}
const saveBeats = (beats: Beat[]) => {
  try {
    localStorage.setItem(BEATS_KEY, JSON.stringify(beats))
  } catch {
    // private window etc., the list just won't survive a reload
  }
}

// the leaderboard JSON is ~9 MB, fetched once and only when a run in the leaderboard scenario needs it
let leaderboardPromise: Promise<LeaderboardFile | null> | null = null
const loadLeaderboard = () =>
  (leaderboardPromise ??= fetch('./leaderboard.json').then((response) => (response.ok ? (response.json() as Promise<LeaderboardFile>) : null)).catch(() => null))

const boardLabel = (key: string) => {
  const spec = BOARDS.find((candidate) => candidate.key === key)!
  return `${spec.objective.label}${spec.allowFireRateMods ? '' : ' (no fire rate mods)'}`
}
const formatScore = (value: number) => (value >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1))
const percent = (value: number) => `${Math.round(value * 1000) / 10}%`
const pathLetter = (index: number) => String.fromCharCode(65 + index)
const defaultWeaponId = weapons.find((weapon) => weapon.name === 'Phenmor')?.uniqueName ?? weapons[0].uniqueName
const weaponOptions = weapons.map((weapon) => ({ id: weapon.uniqueName, label: weapon.name }))

export function Compare({ calculatorScenario, calculatorRiven, onLoadBuild }: Props) {
  const [weaponId, setWeaponId] = useState(defaultWeaponId)
  const [attackIndex, setAttackIndex] = useState(0)
  const [scenarioMode, setScenarioMode] = useState<'leaderboard' | 'calculator'>('leaderboard')
  const [boards, setBoards] = useState<string[]>(['sustained', 'single'])
  const [thorough, setThorough] = useState(false)
  const [statusMode, setStatusMode] = useState<StatusMode>('normal')
  const [paths, setPaths] = useState<ComparePath[]>([emptyPath('Path A'), emptyPath('Path B')])
  const [results, setResults] = useState<CompareResult[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ranWith, setRanWith] = useState<CompareRequest | null>(null)
  const [detailBoard, setDetailBoard] = useState<string | null>(null)
  const [beats, setBeats] = useState<Beat[]>(loadBeats)
  const [copied, setCopied] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const jobId = useRef(0)

  const weapon = weaponsById.get(weaponId)!
  const attack = weapon.attacks[attackIndex] ?? weapon.attacks[0]
  const availableBoards = useMemo(() => boardsFor(attack), [attack])
  const selectedBoards = boards.filter((board) => availableBoards.includes(board))
  const tiers = useMemo(() => getIncarnonTiers(weapon.name) ?? [], [weapon])
  const rivenType = rivenTypeFor(weapon)

  useEffect(() => () => workerRef.current?.terminate(), [])

  const pickWeapon = (id: string | null) => {
    if (!id) return
    setWeaponId(id)
    setAttackIndex(0)
    setPaths([emptyPath('Path A'), emptyPath('Path B')]) // mods/perks/rivens are per weapon
    setResults([])
    setRanWith(null)
  }
  const updatePath = (index: number, next: ComparePath) => setPaths(paths.map((path, other) => (other === index ? next : path)))

  // quick setups for the usual forks
  const nonCritPerk = tiers.flatMap(({ tier, perks }) => perks.filter((perk) => perk.statements.some((statement) => statement.effect?.kind === 'nonCritBonus')).map((perk) => ({ tier, perk })))[0]
  // the generic fork: a crit build vs a status build vs whatever's best. against an immune target the status path is
  // pointless (no procs, no CO count), so it's left out
  const critVsStatus: ComparePath[] = [
    { ...emptyPath('Crit (100%+)'), minCritChance: 1 },
    ...(statusMode === 'immune' ? [] : [{ ...emptyPath('Status (no crit mods)'), maxCritChance: attack.critChance }]),
    emptyPath('Best overall'),
  ]
  const presets: { label: string; paths: ComparePath[] }[] = [
    { label: statusMode === 'immune' ? 'Crit vs best (target immune to status)' : 'Crit vs status', paths: critVsStatus },
    ...(nonCritPerk ? [{
      label: `${nonCritPerk.perk.name}: anti-crit vs crit`,
      paths: [
        // capped at the base crit (no crit mods), 0% usually isn't reachable without a negative-crit riven
        { ...emptyPath(`Anti-crit + ${nonCritPerk.perk.name}`), lockedPerks: { [nonCritPerk.tier]: nonCritPerk.perk.name }, maxCritChance: attack.critChance },
        { ...emptyPath(`Crit, no ${nonCritPerk.perk.name}`), excludedPerkNames: [nonCritPerk.perk.name] },
        emptyPath('No rules'),
      ],
    }] : []),
    { label: 'Your riven vs none', paths: [{ ...emptyPath('With riven'), riven: calculatorRiven?.weaponId === weaponId ? calculatorRiven.config : emptyRiven() }, emptyPath('No riven')] },
  ]

  // the scenario a run uses: the leaderboard's neutral one or the calculator's, with the target's status behaviour on top.
  // only the plain leaderboard scenario (normal status) can be compared against the leaderboard
  const scenarioFor = (): CompareScenario | null => {
    const base = scenarioMode === 'calculator' ? calculatorScenario : null
    if (statusMode === 'normal' && !base) return null
    const scenario = base ?? { target: SCENARIO_TARGET, armor: 0, debuffs: SCENARIO_DEBUFFS, buffs: SCENARIO_BUFFS }
    return { ...scenario, target: { ...scenario.target, statusMode } }
  }

  const run = (runPaths: ComparePath[] = paths) => {
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../optimizer/compareWorker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const id = ++jobId.current
    const request: CompareRequest = { weaponId, attackIndex, boards: selectedBoards, paths: runPaths, thorough, scenario: scenarioFor() }
    const collected: CompareResult[] = []
    setResults([])
    setError(null)
    setRanWith(request)
    setDetailBoard(selectedBoards[0] ?? null)
    setProgress({ done: 0, total: selectedBoards.length * runPaths.length })
    if (!request.scenario) void loadLeaderboard() // start the download while the search runs
    worker.onmessage = (event: MessageEvent<CompareMessage>) => {
      const message = event.data
      if (message.id !== id) return
      if (message.type === 'progress') {
        collected.push(message.result)
        setResults([...collected])
        setProgress({ done: message.done, total: message.total })
      } else if (message.type === 'error') {
        setError(message.message)
        setProgress(null)
      } else {
        setProgress(null)
        worker.terminate()
        if (!request.scenario) void recordBeats(request, collected)
      }
    }
    worker.postMessage({ id, request })
  }

  // leaderboard scenario, no riven: anything noticeably above the leaderboard's number for that board is a build the
  // leaderboard search missed
  const [leaderboard, setLeaderboard] = useState<LeaderboardFile | null>(null)
  const recordBeats = async (request: CompareRequest, found: CompareResult[]) => {
    const file = await loadLeaderboard()
    setLeaderboard(file)
    if (!file) return
    const runWeapon = weaponsById.get(request.weaponId)!
    const runAttack = runWeapon.attacks[request.attackIndex] ?? runWeapon.attacks[0]
    const next = [...loadBeats()]
    for (const result of found) {
      // a missed crit rule is the user's rule, the build itself is still legal, so it still counts
      if (request.paths[result.pathIndex].riven) continue
      const listed = file.boards[result.board]?.find((entry) => entry.weaponId === runWeapon.uniqueName && entry.attack === runAttack.name)
      if (!listed || result.entry.score <= listed.score * 1.001) continue
      const existing = next.findIndex((beat) => beat.weaponId === runWeapon.uniqueName && beat.attack === runAttack.name && beat.board === result.board)
      if (existing >= 0 && next[existing].score >= result.entry.score) continue
      const beat: Beat = {
        weaponId: runWeapon.uniqueName, weaponName: runWeapon.name, attack: runAttack.name, board: result.board,
        score: result.entry.score, leaderboardScore: listed.score, foundAt: new Date().toISOString(),
        build: [...result.entry.mods.map((mod) => mod[1]), ...result.entry.perks.map((perk) => perk.name), ...(result.entry.arcane ? [result.entry.arcane[1]] : [])].join(', '),
        seed: {
          weaponId: runWeapon.uniqueName, attack: runAttack.name, board: result.board,
          mods: result.entry.mods.map((mod) => mod[0]), arcane: result.entry.arcane?.[0] ?? null,
          perks: result.entry.perks, bonusElement: result.entry.bonusElement ?? null,
        },
      }
      if (existing >= 0) next[existing] = beat
      else next.push(beat)
    }
    setBeats(next)
    saveBeats(next)
  }
  const leaderboardScoreFor = (board: string) => {
    if (!leaderboard || !ranWith || ranWith.scenario) return null
    const runWeapon = weaponsById.get(ranWith.weaponId)!
    const runAttack = runWeapon.attacks[ranWith.attackIndex] ?? runWeapon.attacks[0]
    return leaderboard.boards[board]?.find((entry) => entry.weaponId === runWeapon.uniqueName && entry.attack === runAttack.name)?.score ?? null
  }

  // merged into whatever's already in the seeds file by the user, one seed per weapon/attack/board
  const seedsJson = JSON.stringify(beats.map((beat) => beat.seed), null, 2)
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const resultFor = (pathIndex: number, board: string) => results.find((result) => result.pathIndex === pathIndex && result.board === board)
  const loadResult = (result: CompareResult) => {
    const entry = result.entry
    const expanded: LeaderboardEntry = {
      ...entry,
      mods: entry.mods.map(([id, name, rank, conditionalStacks]) => ({ id, name, rank, conditionalStacks })),
      arcane: entry.arcane ? { id: entry.arcane[0], name: entry.arcane[1], rank: entry.arcane[2], conditionalStacks: entry.arcane[3] } : null,
    }
    onLoadBuild(expanded, ranWith?.paths[result.pathIndex].riven ?? null, Boolean(ranWith?.scenario))
  }

  return (
    <div className="compare">
      <section className="panel">
        <h2>Compare build paths</h2>
        <p className="muted">
          Each path is optimized separately under its own rules, so two ways of building a weapon can be put side by side
          (Phenmor: crit vs anti-crit with Devouring Attrition). Nothing here changes the leaderboard.
        </p>
        <div className="row compare-controls">
          <SearchSelect options={weaponOptions} selectedId={weaponId} onSelect={pickWeapon} placeholder="Search weapons" />
          {weapon.attacks.length > 1 && (
            <select value={attackIndex} onChange={(event) => { setAttackIndex(Number(event.target.value)); setResults([]) }}>
              {weapon.attacks.map((option, index) => <option key={option.name} value={index}>{option.name}</option>)}
            </select>
          )}
          <select value={scenarioMode} onChange={(event) => setScenarioMode(event.target.value as 'leaderboard' | 'calculator')}>
            <option value="leaderboard">Leaderboard scenario (neutral target)</option>
            <option value="calculator" disabled={!calculatorScenario}>Calculator's target, debuffs and Warframe</option>
          </select>
          <label className="inline-number" title="How the enemy takes status. Immune: no procs or debuffs at all, so CO / Galvanized / DoTs do nothing. Capped: at most 4 stacks of each status, so DoT builds stall early">
            Status
            <select value={statusMode} onChange={(event) => setStatusMode(event.target.value as StatusMode)}>
              <option value="normal">normal</option>
              <option value="capped">capped at 4 stacks</option>
              <option value="immune">immune</option>
            </select>
          </label>
          <label className="inline-check" title="Twice the search width. Slower, but finds a bit more when the rules are tight">
            <input type="checkbox" checked={thorough} onChange={(event) => setThorough(event.target.checked)} /> Thorough search
          </label>
        </div>
        <div className="row compare-boards">
          {availableBoards.map((board) => (
            <label key={board} className="inline-check">
              <input type="checkbox" checked={boards.includes(board)}
                onChange={(event) => setBoards(event.target.checked ? [...boards, board] : boards.filter((other) => other !== board))} />
              {boardLabel(board)}
            </label>
          ))}
        </div>
        <div className="row">
          <span className="muted-inline">One click (sets the paths and runs):</span>
          {presets.map((preset, index) => (
            <button key={preset.label} className={index === 0 ? 'primary' : ''} disabled={!selectedBoards.length || Boolean(progress)}
              onClick={() => { setPaths(preset.paths); run(preset.paths) }}>
              {preset.label}
            </button>
          ))}
        </div>
        {statusMode !== 'normal' && (
          <p className="muted">
            {statusMode === 'immune'
              ? 'Immune target: no procs and no debuffs, so Condition Overload, Galvanized mods, Viral/Heat and DoTs are worth nothing and the search drops them.'
              : 'Capped target: 4 stacks per status at most, so DoTs stop growing early and Viral tops out at ×2.75. Builds lean toward direct hits.'}
            {scenarioMode === 'leaderboard' && ' Not comparable with the leaderboard, which assumes normal status.'}
          </p>
        )}
      </section>

      <div className="path-grid">
        {paths.map((path, index) => (
          <PathEditor
            key={index}
            letter={pathLetter(index)}
            path={path}
            weaponId={weaponId}
            tiers={tiers}
            rivenType={rivenType}
            calculatorRiven={calculatorRiven?.weaponId === weaponId && calculatorRiven.config.stats.length ? calculatorRiven.config : null}
            onChange={(next) => updatePath(index, next)}
            onRemove={paths.length > 1 ? () => setPaths(paths.filter((_, other) => other !== index)) : undefined}
          />
        ))}
        {paths.length < 4 && (
          <button className="add-path" onClick={() => setPaths([...paths, emptyPath(`Path ${pathLetter(paths.length)}`)])}>+ Add path</button>
        )}
      </div>

      <section className="panel">
        <div className="row spread">
          <h2>Results</h2>
          <div className="row">
            {progress && <span className="muted-inline">Optimizing {progress.done}/{progress.total}…</span>}
            <button className="primary" disabled={!selectedBoards.length || Boolean(progress)} onClick={() => run()}>
              {progress ? 'Running…' : `Run ${selectedBoards.length * paths.length} searches`}
            </button>
          </div>
        </div>
        {error && <p className="riven-issues">{error}</p>}
        {!ranWith && <p className="muted">Pick the goals and paths, then run. Each search takes about half a second.</p>}
        {ranWith && (
          <>
            <div className="table-scroll">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>Goal</th>
                    {ranWith.paths.map((path, index) => <th key={index}>{pathLetter(index)}: {path.name}</th>)}
                    {!ranWith.scenario && <th>Leaderboard</th>}
                  </tr>
                </thead>
                <tbody>
                  {ranWith.boards.map((board) => {
                    const scores = ranWith.paths.map((_, index) => resultFor(index, board)?.entry.score ?? 0)
                    const top = Math.max(...scores)
                    const listed = leaderboardScoreFor(board)
                    return (
                      <tr key={board} className={detailBoard === board ? 'selected' : ''} onClick={() => setDetailBoard(board)}>
                        <td>{boardLabel(board)}</td>
                        {ranWith.paths.map((path, index) => {
                          const result = resultFor(index, board)
                          if (!result) return <td key={index} className="muted-inline">…</td>
                          const beatsBoard = listed !== null && !path.riven && result.entry.score > listed * 1.001
                          return (
                            <td key={index} className={result.entry.score === top && top > 0 ? 'best' : ''}>
                              <b>{formatScore(result.entry.score)}</b>
                              <div className="muted-inline">
                                {result.entry.score === top ? 'best' : `${percent(result.entry.score / top - 1)}`} · crit {percent(result.entry.stats.critChance)}
                              </div>
                              {result.critMiss > 0 && <div className="warn-inline" title="The rule couldn't be met, this is the closest the search got">crit rule not reachable</div>}
                              {beatsBoard && <div className="beats-tag">beats leaderboard +{percent(result.entry.score / listed - 1)}</div>}
                            </td>
                          )
                        })}
                        {!ranWith.scenario && <td className="muted-inline">{listed === null ? (leaderboard ? 'not listed' : '…') : formatScore(listed)}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {detailBoard && (
              <>
                <h3>Builds for {boardLabel(detailBoard)} <span className="muted-inline">(click a goal row to switch)</span></h3>
                <div className="path-grid">
                  {ranWith.paths.map((path, index) => {
                    const result = resultFor(index, detailBoard)
                    if (!result) return <div key={index} className="panel muted">Searching…</div>
                    const { entry } = result
                    return (
                      <div key={index} className="panel build-detail">
                        <div className="row spread">
                          <b>{pathLetter(index)}: {path.name}</b>
                          <button onClick={() => loadResult(result)}>Load in calculator</button>
                        </div>
                        <ol className="build-mods">
                          {entry.mods.map(([id, name, rank]) => (
                            <li key={id}>{id === RIVEN_MOD_ID ? <span className="riven-title">{name}</span> : name}{rank !== (modsById.get(id)?.fusionLimit ?? rank) ? ` (rank ${rank})` : ''}</li>
                          ))}
                        </ol>
                        <div className="row">
                          {entry.arcane && <span className="chip">{entry.arcane[1]}</span>}
                          {entry.perks.map((perk) => <span key={perk.name} className="chip perk-chip">{perk.tier}: {perk.name}</span>)}
                          {entry.bonusElement && <span className="chip">{entry.bonusElement.damageType} {percent(entry.bonusElement.value)}</span>}
                          {!result.usedFireRateMods && BOARDS.find((spec) => spec.key === detailBoard)?.allowFireRateMods && (
                            <span className="chip" title="The search found the no-fire-rate build scored higher">no fire rate mods won</span>
                          )}
                        </div>
                        <p className="muted">
                          Crit {percent(entry.stats.critChance)} ×{entry.stats.critMultiplier.toFixed(2)} · Status {percent(entry.stats.statusChance)} ·
                          Multishot {entry.stats.multishot.toFixed(2)} · {entry.stats.fireRate.toFixed(2)}/s ·
                          Sustained {formatScore(entry.stats.sustainedDps)} · Hit {formatScore(entry.stats.singleHit)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
            <p className="muted">
              Best found, not proven best: the search is a heuristic, and tight rules give it less room. Paths that lock things in keep
              them in the first slots, so element order with a locked riven or mod may be worth fixing by hand in the calculator.
            </p>
          </>
        )}
      </section>

      {beats.length > 0 && (
        <section className="panel">
          <div className="row spread">
            <h2>Beats the leaderboard</h2>
            <div className="row">
              <button onClick={() => copy(seedsJson)}>{copied ? 'Copied' : 'Copy seeds'}</button>
              <button onClick={() => { setBeats([]); saveBeats([]) }}>Clear</button>
            </div>
          </div>
          <p className="muted">
            Builds found here (leaderboard scenario, no riven) that score above that weapon's leaderboard entry, so the leaderboard's search
            walked past them. Saved in this browser. To fold them in: <b>Copy seeds</b>, paste into <code>scripts/leaderboard-seeds.json</code>,
            run <code>npm run leaderboard</code>. Only these weapons rerun, each seed is scored the leaderboard's way and only kept if it
            still beats the search.
          </p>
          <div className="table-scroll">
          <table className="compare-table">
            <thead><tr><th>Weapon</th><th>Goal</th><th>Found</th><th>Leaderboard</th><th>Build</th></tr></thead>
            <tbody>
              {beats.map((beat) => (
                <tr key={`${beat.weaponId}|${beat.attack}|${beat.board}`}>
                  <td>{beat.weaponName} <span className="muted-inline">{beat.attack}</span></td>
                  <td>{boardLabel(beat.board)}</td>
                  <td><b>{formatScore(beat.score)}</b> <span className="beats-tag">+{percent(beat.score / beat.leaderboardScore - 1)}</span></td>
                  <td>{formatScore(beat.leaderboardScore)}</td>
                  <td className="muted-inline">{beat.build}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      )}
    </div>
  )
}

interface PathEditorProps {
  letter: string
  path: ComparePath
  weaponId: string
  tiers: NonNullable<ReturnType<typeof getIncarnonTiers>>
  rivenType: ReturnType<typeof rivenTypeFor>
  calculatorRiven: RivenConfig | null
  onChange: (path: ComparePath) => void
  onRemove?: () => void
}

function PathEditor({ letter, path, weaponId, tiers, rivenType, calculatorRiven, onChange, onRemove }: PathEditorProps) {
  const weapon = weaponsById.get(weaponId)!
  // one entry per mod name (the highest-rank copy), like the calculator's browser
  const modOptions = useMemo(() => {
    const byName = new Map<string, { id: string; label: string }>()
    for (const mod of getCompatibleMods(weapon)) if (!byName.has(mod.name)) byName.set(mod.name, { id: mod.uniqueName, label: mod.name })
    return [...byName.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [weapon])
  const arcaneOptions = useMemo(() => getCompatibleArcanes(weapon), [weapon])
  const [adderKey, setAdderKey] = useState(0) // remounts the search boxes so they clear after adding
  const slotsUsed = path.lockedModIds.length + (path.riven ? 1 : 0)

  const lockMod = (id: string | null) => {
    if (!id || slotsUsed >= 8 || path.lockedModIds.includes(id)) return
    const name = modsById.get(id)!.name
    onChange({ ...path, lockedModIds: [...path.lockedModIds, id], excludedModNames: path.excludedModNames.filter((other) => other !== name) })
    setAdderKey(adderKey + 1)
  }
  const banMod = (id: string | null) => {
    if (!id) return
    const name = modsById.get(id)!.name
    if (!path.excludedModNames.includes(name)) {
      onChange({ ...path, excludedModNames: [...path.excludedModNames, name], lockedModIds: path.lockedModIds.filter((other) => modsById.get(other)!.name !== name) })
    }
    setAdderKey(adderKey + 1)
  }
  // perk chips cycle: search picks -> locked -> banned -> search picks
  const perkState = (tier: string, name: string) =>
    path.lockedPerks[tier] === name ? 'locked' : path.excludedPerkNames.includes(name) ? 'banned' : 'auto'
  const cyclePerk = (tier: string, name: string) => {
    const state = perkState(tier, name)
    const lockedPerks = { ...path.lockedPerks }
    let excluded = path.excludedPerkNames.filter((other) => other !== name)
    if (state === 'auto') lockedPerks[tier] = name
    else if (state === 'locked') {
      delete lockedPerks[tier]
      excluded = [...excluded, name]
    }
    onChange({ ...path, lockedPerks, excludedPerkNames: excluded })
  }
  const percentInput = (value: number | null) => (value === null ? '' : Math.round(value * 1000) / 10)
  const parsePercent = (text: string) => (text.trim() === '' ? null : Number(text) / 100)

  return (
    <section className="panel path-editor">
      <div className="row spread">
        <span className="path-letter">{letter}</span>
        <input className="path-name" value={path.name} onChange={(event) => onChange({ ...path, name: event.target.value })} />
        {onRemove && <button className="remove-inline" title="Remove path" onClick={onRemove}>×</button>}
      </div>

      <div className="path-section">
        <span className="label">Lock in ({slotsUsed}/8 slots)</span>
        <div className="row">
          {path.lockedModIds.map((id) => (
            <span key={id} className="chip lock-chip">
              {modsById.get(id)?.name}
              <button className="chip-x" onClick={() => onChange({ ...path, lockedModIds: path.lockedModIds.filter((other) => other !== id) })}>×</button>
            </span>
          ))}
          {path.riven && <span className="chip lock-chip riven-title">Riven</span>}
        </div>
        <SearchSelect key={`lock-${adderKey}`} options={modOptions} selectedId={null} onSelect={lockMod} placeholder="Add a mod to lock in" />
      </div>

      <div className="path-section">
        <span className="label">Lock out</span>
        <div className="row">
          {path.excludedModNames.map((name) => (
            <span key={name} className="chip ban-chip">
              {name}
              <button className="chip-x" onClick={() => onChange({ ...path, excludedModNames: path.excludedModNames.filter((other) => other !== name) })}>×</button>
            </span>
          ))}
        </div>
        <SearchSelect key={`ban-${adderKey}`} options={modOptions} selectedId={null} onSelect={banMod} placeholder="Add a mod to keep out" />
      </div>

      <div className="path-section">
        <span className="label">Arcane</span>
        <select value={path.lockedArcaneId ?? ''} onChange={(event) => onChange({ ...path, lockedArcaneId: event.target.value === '' ? null : event.target.value })}>
          <option value="">Search picks</option>
          <option value="none">No arcane</option>
          {arcaneOptions.map((arcane) => <option key={arcane.uniqueName} value={arcane.uniqueName}>Lock: {arcane.name}</option>)}
        </select>
        {path.lockedArcaneId && path.lockedArcaneId !== 'none' && !arcanesById.has(path.lockedArcaneId) && <span className="warn-inline">unknown arcane</span>}
      </div>

      {tiers.length > 0 && (
        <div className="path-section">
          <span className="label">Incarnon (click: search picks → locked → banned)</span>
          {tiers.map(({ tier, perks }) => (
            <div key={tier} className="row perk-row">
              <span className="evo-label">{tier}</span>
              {perks.map((perk) => {
                const state = perkState(tier, perk.name)
                return (
                  <button key={perk.name} className={`perk-toggle ${state}`} onClick={() => cyclePerk(tier, perk.name)} title={perk.statements.map((statement) => statement.text).join('\n')}>
                    {state === 'locked' ? '🔒 ' : state === 'banned' ? '✕ ' : ''}{perk.name}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      <div className="path-section row">
        <label>
          Crit chance ≥
          <input type="number" className="stack-input" placeholder="any" value={percentInput(path.minCritChance)}
            onChange={(event) => onChange({ ...path, minCritChance: parsePercent(event.target.value) })} />%
        </label>
        <label>
          ≤
          <input type="number" className="stack-input" placeholder="any" value={percentInput(path.maxCritChance)}
            onChange={(event) => onChange({ ...path, maxCritChance: parsePercent(event.target.value) })} />%
        </label>
      </div>

      {rivenType && (
        <div className="path-section">
          <div className="row">
            {!path.riven && <button disabled={slotsUsed >= 8} onClick={() => onChange({ ...path, riven: emptyRiven() })}>+ Riven</button>}
            {calculatorRiven && <button onClick={() => onChange({ ...path, riven: calculatorRiven })}>Use the calculator's riven</button>}
            {path.riven && <button onClick={() => onChange({ ...path, riven: null })}>Remove riven</button>}
          </div>
          {path.riven && (
            <RivenEditor type={rivenType} disposition={RIVEN_DISPOSITION}
              config={path.riven} onChange={(riven) => onChange({ ...path, riven })} />
          )}
        </div>
      )}
    </section>
  )
}
