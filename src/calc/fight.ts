// the damage simulator: one build vs one enemy, shot by shot, until it dies. the enemy keeps state (overguard, shields,
// health, status stacks, Heat's armor strip) and every pellet and DoT tick is priced by calculate() against that state at
// that moment, so damage.ts stays the only damage math. prices are cached per state, a fight only visits a few dozen.
// runs are seeded (seed + run index) so the same setup gives the same fight every time
import { INCARNON_SWAP_RELOADS, calculate, type CalcInput, type CalcResult } from './damage'
import { isIncarnonAttackName } from './incarnonForm'
import { rng, shotTimes, type ShotModel } from './simulate'
import type { TargetLayer } from '../types'

// ---- overguard scaling ----
// "All Eximus units have a base Overguard of 12." the multiplier blends two curves between levels 45 and 50 with a smoothstep,
// in 32-bit floats: f32(f1 + f32(f32(f2 - f1) x s)), f1 = 1 + 0.0015(x - 1)^4, f2 = 1 + 260(x - 1)^0.9 (Daniel's numbers
// from the wiki's Enemy Level Scaling, checked against its chart: x8,634 at 50, x16,258 at 100, x30,476 at 200)
export const EXIMUS_BASE_OVERGUARD = 12
const f32 = Math.fround
export function overguardMultiplier(level: number): number {
  const low = 1 + 0.0015 * (level - 1) ** 4
  const high = 1 + 260 * (level - 1) ** 0.9
  const t = Math.min(1, Math.max(0, (level - 45) / 5))
  const s = t * t * (3 - 2 * t)
  return f32(low + f32(f32(high - low) * s))
}
// Steel Path doesn't multiply overguard (Daniel's call): it's just a higher enemy level, and the level is what scales it
export const scaleOverguard = (baseOverguard: number, effectiveLevel: number) => baseOverguard * overguardMultiplier(effectiveLevel)

// ---- status timers ----
// Corrosive (wiki): "degrades the armor of the afflicted target by 20% for 8 seconds ... with each stack having its own
// duration. Any stacks applied after the 10th will replace the oldest stack." Viral: "for 6 seconds ... with each stack having
// their own duration". Cold: "It lasts 6 seconds and stacks to a maximum of 10, with each stack having its own duration."
// Puncture/Magnetic/the rest: 6 s. Status Duration stretches all of them
const BASE_DURATION: Record<string, number> = { corrosive: 8 }
const MAX_STACKS = 10
// Cold (wiki): "Bosses, as well as enemies with active Overguard, can receive a maximum of 4 Cold stacks."
const OVERGUARD_COLD_CAP = 4
// the statuses damage.ts reads by stack count. everything else only matters for being there (Condition Overload)
const COUNTED = new Set(['viral', 'magnetic', 'corrosive', 'cold', 'puncture', 'tau'])
const DOT_TYPES = new Set(['slash', 'heat', 'toxin', 'electricity', 'gas', 'blast'])

// Heat (wiki Heat_Damage): "Every 0.5 seconds after the initial proc, the enemy will have 15%, then 30%, 40%, and finally 50%
// of its armor stripped." and "After the proc ends, the target will regain armor every 1.5 seconds for 6 seconds. The enemy's
// armor strip will decrease as follows: 50%, 40%, 30%, 15%, 0%." "Status Duration mods will increase the time intervals for
// the armor strip as expected."
const HEAT_STAGES = [0, 0.15, 0.3, 0.4, 0.5]
const HEAT_UP_STEP = 0.5
const HEAT_DOWN_STEP = 1.5

export interface FightSetup {
  input: CalcInput // the Calculator's calcInput + target, as is
  pools: { overguard: number; shield: number; health: number }
  runs: number
  seconds: number // fight cap
  headshotShare: number // 0 = body only, 1 = head only
  seed?: number
  // test mode: nothing changes on the enemy (no stacks, no strip, no layers), just damage dealt on the starting layer
  frozen?: boolean
  // the what-if: DoT ticks deal nothing, but the procs still land (strips, Viral...), so it's when the hits alone would kill
  directOnly?: boolean
  // experimental, Incarnon forms only: instead of sitting idle while the form refills, switch out, fire the normal form for the
  // refill time (its hits do damage), switch back in. never used by the leaderboard (see incarnonCycle)
  cycle?: IncarnonCycle
}
export interface IncarnonCycle { normalInput: CalcInput; swapSeconds: number; fillSeconds: number }
export type ShadeKind = 'reload' | 'refill' | 'switch' | 'normal'
export interface Shade { start: number; end: number; kind: ShadeKind }

export type FightLayer = 'overguard' | 'shield' | 'health'
export interface FightEvent { t: number; kind: 'shot' | 'hit' | 'proc' | 'tick' | 'break' | 'kill'; text: string; damage?: number; layer?: FightLayer }
export interface ProcMark { t: number; type: string; hp: number } // hp = total enemy HP left when it landed
export interface Band { p10: number[]; median: number[]; p90: number[] }
export interface FightSummary {
  runs: number
  seconds: number
  pools: { overguard: number; shield: number; health: number; armor: number }
  killTimes: number[] // sorted, Infinity = alive at the cap
  kills: number
  ttk: { p10: number; median: number; p90: number }
  times: number[] // sample times for the curves
  curves: Record<FightLayer | 'armor', Band>
  shotsToKill: number | null // median over runs that killed
  reloadsToKill: number | null
  runsWithReload: number
  armorZeroAt: number | null // median time armor hit 0, over runs where it did
  runsArmorZero: number
  minArmor: number // median of each run's lowest armor
  log: FightEvent[] // the median run, step by step
  // direct hits vs status damage: the same fights with DoT ticks dealing nothing
  direct: { killTimes: number[]; kills: number; ttk: { p10: number; median: number; p90: number } }
  statusShare: number // DoT damage / all damage dealt, over every run
  reloads: Shade[] // reloads, Incarnon refills, switching and normal-form stretches (the same in every run), for shading the charts
  // the median run (same seed) with and without its DoTs: total enemy HP left on the sample grid, and where every proc landed
  race: { withStatus: number[]; directOnly: number[]; killAt: number; directKillAt: number; statusShare: number; procs: ProcMark[] }
  states: number // prices worked out
}

interface Priced {
  layer: FightLayer
  result: CalcResult
  hit: { normal: number; crit: number }
  critFloor: number
  critUp: number
  multishot: number
  procFloor: number
  procUp: number
  kinds: { type: string; dot: number }[] // what a proc can be: a DoT (index into dots) or a plain status (-1)
  weights: number[]
  dots: { label: string; type: string; normal: number; crit: number; ticks: number; firstTickAt: number; refreshes: boolean }[]
  toxinShare: number // share of the hit that's Toxin (it skips shields)
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
const medianOf = (values: number[]) => (values.length ? quantile([...values].sort((a, b) => a - b), 0.5) : null)

// small binary heap of timed events
interface Timed { t: number; seq: number; dot: string; crit: boolean; head: boolean; left: number; heatChain: number; normal: boolean } // heatChain -1 = not Heat, normal = fired by the normal form (cycle mode)
class Queue {
  items: Timed[] = []
  push(item: Timed) {
    const items = this.items
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!before(items[i], items[parent])) break
      ;[items[i], items[parent]] = [items[parent], items[i]]
      i = parent
    }
  }
  pop(): Timed | undefined {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (items.length && last) {
      items[0] = last
      let i = 0
      while (true) {
        const left = 2 * i + 1, right = left + 1
        let best = i
        if (left < items.length && before(items[left], items[best])) best = left
        if (right < items.length && before(items[right], items[best])) best = right
        if (best === i) break
        ;[items[i], items[best]] = [items[best], items[i]]
        i = best
      }
    }
    return top
  }
  peek() { return this.items[0] }
}
const before = (a: Timed, b: Timed) => a.t < b.t || (a.t === b.t && a.seq < b.seq)

export function makePricer(input: CalcInput, frozen: boolean) {
  const cache = new Map<string, Priced>()
  const base = input.debuffs
  return {
    get size() { return cache.size },
    price(layer: TargetLayer, head: boolean, stacks: Record<string, number>, heatStrip: number, overguardUp: boolean): Priced {
      const key = `${layer}|${head ? 1 : 0}|${heatStrip}|${overguardUp ? 1 : 0}|${Object.entries(stacks).filter(([, n]) => n > 0).map(([type, n]) => `${type}${n}`).sort().join(',')}`
      let priced = cache.get(key)
      if (priced) return priced
      // my stacks go on top of whatever the Debuffs panel already put there (teammates, abilities), capped at 10
      const merged: Record<string, number> = { ...base.stacks }
      for (const [type, n] of Object.entries(stacks)) merged[type] = Math.min(MAX_STACKS, (merged[type] ?? 0) + n)
      const debuffs = frozen ? base : {
        ...base,
        stacks: merged,
        heatArmorStrip: Math.max(base.heatArmorStrip, heatStrip),
        // the user's call: while Overguard is up the enemy "will completely ignore the crowd control effects", so no lifted /
        // knocked down bonus until it breaks
        liftedOrKnockedDown: base.liftedOrKnockedDown && !overguardUp,
        // my guess: Condition Overload counts what's really on the enemy right now, not the build's assumed set
        statusTypeSource: 'debuffs' as const,
      }
      const result = calculate({ ...input, debuffs, target: { ...input.target, headshot: head, layer } })
      const model = result.shotModel
      // same tier split as simulateDamage: floor tier vs next tier up, rescaled so the mean stays right
      const critFloor = Math.floor(model.critChance)
      const critUp = model.critChance - critFloor
      const tierMean = (1 - critUp) * model.hit.normal + critUp * model.hit.crit
      const hitScale = tierMean > 0 ? model.hit.average / tierMean : 1
      const kinds: Priced['kinds'] = []
      const weights: number[] = []
      model.dots.forEach((dot, index) => {
        // Cascadia Empowered isn't a status of its own: it's one flat hit on every real proc (handled in runFight)
        if (dot.damageType === 'cascadia') return
        kinds.push({ type: dot.damageType.split(' (')[0], dot: index })
        weights.push(dot.procsPerPellet)
      })
      for (const [type, perPellet] of Object.entries(result.procsPerPellet)) {
        if (DOT_TYPES.has(type) || perPellet <= 0) continue
        kinds.push({ type, dot: -1 })
        weights.push(perPellet)
      }
      const procsPerPellet = weights.reduce((a, b) => a + b, 0)
      const rows = result.damageTypes
      const rowTotal = rows.reduce((total, row) => total + row.vsTarget, 0)
      priced = {
        layer: layer as FightLayer,
        result,
        hit: { normal: model.hit.normal * hitScale, crit: model.hit.crit * hitScale },
        critFloor,
        critUp,
        multishot: model.multishot,
        procFloor: Math.floor(procsPerPellet),
        procUp: procsPerPellet - Math.floor(procsPerPellet),
        kinds,
        weights: weights.map((weight) => weight / (procsPerPellet || 1)),
        dots: model.dots.map((dot) => {
          const mean = (1 - critUp) * dot.tick.normal + critUp * dot.tick.crit
          const scale = mean > 0 ? dot.tick.average / mean : 1
          return { label: dot.damageType, type: dot.damageType.split(' (')[0], normal: dot.tick.normal * scale, crit: dot.tick.crit * scale, ticks: dot.ticks, firstTickAt: dot.firstTickAt, refreshes: dot.refreshes && !model.instantDots }
        }),
        toxinShare: rowTotal > 0 ? (rows.find((row) => row.damageType === 'toxin')?.vsTarget ?? 0) / rowTotal : 0,
      }
      cache.set(key, priced)
      return priced
    },
  }
}

interface RunResult {
  killTime: number
  shots: number
  reloads: number
  armorZeroAt: number | null
  minArmor: number
  samples: { overguard: Float64Array; shield: Float64Array; health: Float64Array; armor: Float64Array }
  dealtBy: (seconds: number) => number // frozen mode: damage dealt before `seconds`
  directDealt: number
  dotDealt: number
  procs: ProcMark[] // only with a log
  model: ShotModel // the shot model the run fired on (for the reload windows)
}

const SAMPLES = 240

export function runFight(setup: FightSetup, run: number, pricer: ReturnType<typeof makePricer>, log?: FightEvent[], horizon = setup.seconds, normalPricer?: ReturnType<typeof makePricer>): RunResult {
  const { input, frozen } = setup
  const random = rng((setup.seed ?? 12345) + run)
  const cap = setup.seconds
  const step = horizon / SAMPLES // the curves' sample grid, out to `horizon` (simulateFight picks it from a few pilot runs)
  const pools = { ...setup.pools }
  const startLayer: FightLayer = frozen ? (input.target.layer as FightLayer) : pools.overguard > 0 ? 'overguard' : pools.shield > 0 ? 'shield' : 'health'
  const say = (event: FightEvent) => { if (log && log.length < 3000) log.push(event) }

  // enemy state
  const stackTimers: Record<string, number[]> = {} // expiry times, oldest first
  const pending: { type: string; expiry: number }[] = []
  let heatExpiry = -Infinity, heatRampStart = 0, heatRampFrom = 0, heatEndStage = 0, heatChain = 0
  const heatStageAt = (t: number) => {
    if (frozen || heatExpiry === -Infinity) return 0
    const k = heatScale
    if (t < heatExpiry) return Math.min(4, heatRampFrom + Math.floor((t - heatRampStart) / (HEAT_UP_STEP * k) + 1e-9))
    return Math.max(0, heatEndStage - Math.floor((t - heatExpiry) / (HEAT_DOWN_STEP * k) + 1e-9))
  }
  let heatScale = 1
  const stacksNow = (t: number): Record<string, number> => {
    const out: Record<string, number> = {}
    if (frozen) return out
    for (const [type, timers] of Object.entries(stackTimers)) {
      while (timers.length && timers[0] <= t) timers.shift()
      if (!timers.length) continue
      out[type] = COUNTED.has(type) ? timers.length : 1
    }
    return out
  }
  const layerNow = (): FightLayer => (frozen ? startLayer : pools.overguard > 0 ? 'overguard' : pools.shield > 0 ? 'shield' : 'health')
  let firingNormal = false // cycle mode: the shot going off now is the normal form's
  const priceAt = (t: number, layer: FightLayer, head: boolean, normal = firingNormal) =>
    (normal && normalPricer ? normalPricer : pricer).price(layer, head, stacksNow(t), HEAT_STAGES[heatStageAt(t)], !frozen && pools.overguard > 0)

  let dealtTimes: number[] = [], dealtAmounts: number[] = []
  let directDealt = 0, dotDealt = 0
  const procMarks: ProcMark[] = []
  const hpLeft = () => pools.overguard + pools.shield + pools.health
  let killTime = Infinity
  // damage into the layers: what's left of a hit after a layer breaks gets priced again vs the next one
  const deal = (t: number, amountFor: (layer: FightLayer) => number, label: string, skipsShields: boolean, kind: 'hit' | 'tick' = 'hit'): boolean => {
    if (frozen) {
      const amount = amountFor(startLayer)
      dealtTimes.push(t); dealtAmounts.push(amount)
      return false
    }
    if (kind === 'tick' && setup.directOnly) return false
    let share = 1
    const count = (amount: number) => { if (kind === 'tick') dotDealt += amount; else directDealt += amount }
    while (share > 1e-12) {
      let layer = layerNow()
      if (layer === 'shield' && skipsShields) layer = 'health'
      const amount = amountFor(layer) * share
      if (amount <= 0) return false
      const left = pools[layer]
      if (amount < left) {
        pools[layer] = left - amount
        count(amount)
        say({ t, kind, text: label, damage: amount, layer })
        return false
      }
      pools[layer] = 0
      count(left)
      say({ t, kind, text: label, damage: left, layer })
      share *= 1 - left / amount
      if (layer === 'health') {
        killTime = t
        say({ t, kind: 'kill', text: 'killed' })
        return true
      }
      say({ t, kind: 'break', text: `${layer} broken`, layer })
    }
    return false
  }

  const queue = new Queue()
  let seq = 0
  const armorNow = (t: number) => priceAt(t, 'health', false).result.armor.after
  let minArmor = Infinity, armorZeroAt: number | null = null
  const samples = { overguard: new Float64Array(SAMPLES + 1), shield: new Float64Array(SAMPLES + 1), health: new Float64Array(SAMPLES + 1), armor: new Float64Array(SAMPLES + 1) }
  let nextSample = 0
  const sampleUpTo = (t: number) => {
    while (nextSample <= SAMPLES && nextSample * step <= t) {
      const at = nextSample * step
      const armor = frozen ? 0 : armorNow(at)
      samples.overguard[nextSample] = pools.overguard
      samples.shield[nextSample] = pools.shield
      samples.health[nextSample] = pools.health
      samples.armor[nextSample] = armor
      if (!frozen) {
        minArmor = Math.min(minArmor, armor)
        if (armor <= 0 && armorZeroAt === null) armorZeroAt = at
      }
      nextSample++
    }
  }

  // a DoT tick, priced vs the enemy as it is now. Toxin skips shields but not Overguard (Daniel's call), Overguard takes all of it
  const tick = (event: Timed): boolean => {
    const dotType = event.dot.split(' (')[0]
    const amountFor = (layer: FightLayer) => {
      const priced = priceAt(event.t, layer, event.head, event.normal)
      const dot = priced.dots.find((candidate) => candidate.label === event.dot)
      return dot ? (event.crit ? dot.crit : dot.normal) : 0
    }
    return deal(event.t, amountFor, `${event.dot} tick`, dotType === 'toxin', 'tick')
  }

  const base = priceAt(0, startLayer, false)
  const schedule = setup.cycle && normalPricer
    ? cycleSchedule(base.result.shotModel, normalPricer.price(startLayer, false, {}, 0, false).result.shotModel, setup.cycle.swapSeconds, setup.cycle.fillSeconds, cap).shots
    : shotTimes(base.result.shotModel, cap).map((t) => ({ t, normal: false }))
  const times = schedule.map((shot) => shot.t)
  const magazine = base.result.shotModel.magazineSize
  heatScale = base.result.statusDurationScale.heat ?? 1
  let shotsFired = 0

  const runQueueUntil = (t: number): boolean => {
    while (queue.peek() && queue.peek()!.t < t) {
      const event = queue.pop()!
      if (event.t >= cap) return false
      sampleUpTo(event.t)
      // Heat stacks all die together when the chain runs out (a later chain doesn't bring old stacks back)
      if (event.heatChain >= 0 && (event.heatChain !== heatChain || event.t > heatExpiry + 1e-9)) continue
      if (tick(event)) return true
      if (event.heatChain >= 0) queue.push({ ...event, t: event.t + 1, seq: seq++ })
      else if (event.left > 1) queue.push({ ...event, t: event.t + 1, left: event.left - 1, seq: seq++ })
    }
    return false
  }

  let dead = false
  for (const shot of schedule) {
    const time = shot.t
    if (runQueueUntil(time)) { dead = true; break }
    firingNormal = shot.normal
    sampleUpTo(time)
    shotsFired++
    // every pellet of this shot sees the enemy as it was when the shot went off; its own procs count from the next shot
    const body = priceAt(time, layerNow(), false)
    let headPrice: { layer: FightLayer; priced: Priced } | null = null
    const pellets = Math.floor(body.multishot) + (random() < body.multishot - Math.floor(body.multishot) ? 1 : 0)
    say({ t: time, kind: 'shot', text: `shot ${shotsFired}, ${pellets} pellet${pellets === 1 ? '' : 's'}` })
    for (let pellet = 0; pellet < pellets && !dead; pellet++) {
      const head = setup.headshotShare > 0 && (setup.headshotShare >= 1 || random() < setup.headshotShare)
      const layer = layerNow()
      const first = head ? (headPrice && headPrice.layer === layer ? headPrice.priced : (headPrice = { layer, priced: priceAt(time, layer, true) }).priced) : body
      const crit = random() < first.critUp
      const tier = first.critFloor + (crit ? 1 : 0)
      // the hit: Toxin's share goes around shields straight to health
      const hitOn = (layer: FightLayer, part: 'all' | 'nonToxin' | 'toxin') => {
        const priced = layer === first.layer ? first : priceAt(time, layer, head)
        const hit = crit ? priced.hit.crit : priced.hit.normal
        return part === 'all' ? hit : part === 'toxin' ? hit * priced.toxinShare : hit * (1 - priced.toxinShare)
      }
      const label = `${head ? 'head' : 'body'} ${tier === 0 ? 'no crit' : ['yellow', 'orange', 'red'][Math.min(2, tier - 1)] + (tier > 3 ? ` x${tier}` : '')}`
      if (!frozen && layerNow() === 'shield' && first.toxinShare > 0) {
        if (deal(time, (layer) => hitOn(layer, 'nonToxin'), label, false)) { dead = true; break }
        if (deal(time, (layer) => (layer === 'health' ? hitOn('health', 'toxin') : 0), `${label} (Toxin)`, true)) { dead = true; break }
      } else if (deal(time, (layer) => hitOn(layer, 'all'), label, false)) { dead = true; break }

      const procs = first.procFloor + (random() < first.procUp ? 1 : 0)
      for (let proc = 0; proc < procs; proc++) {
        let pick = random()
        let index = 0
        while (index < first.weights.length - 1 && pick >= first.weights[index]) pick -= first.weights[index++]
        const kind = first.kinds[index]
        if (!kind) continue
        if (!frozen) {
          const scale = first.result.statusDurationScale[kind.type] ?? 1
          pending.push({ type: kind.type, expiry: time + (BASE_DURATION[kind.type] ?? 6) * scale })
        }
        say({ t: time, kind: 'proc', text: kind.type })
        // Cascadia Empowered (wiki): "Creates an extra instance of damage when proccing a status effect", priced per proc by
        // damage.ts (750 x faction x vulnerability x the proc mix's armor/weakness), counted as status damage
        if (first.dots.some((candidate) => candidate.label === 'cascadia')) {
          const cascadiaOn = (layer: FightLayer) => priceAt(time, layer, head).dots.find((candidate) => candidate.label === 'cascadia')?.normal ?? 0
          if (deal(time, cascadiaOn, 'Cascadia Empowered', false, 'tick')) { dead = true; break }
        }
        if (log) procMarks.push({ t: time, type: kind.type, hp: hpLeft() })
        if (kind.dot < 0) continue
        const dot = first.dots[kind.dot]
        if (first.result.shotModel.instantDots) {
          if (deal(time, (layer) => { const p = priceAt(time, layer, head).dots[kind.dot]; return p ? (crit ? p.crit : p.normal) * p.ticks : 0 }, 'detonation', dot.type === 'toxin', 'tick')) { dead = true; break }
          continue
        }
        if (dot.refreshes) {
          // "a Heat proc both adds a stack and refreshes the duration of all currently active heat stacks on the target"
          if (time >= heatExpiry) { heatRampFrom = heatStageAt(time); heatRampStart = time; heatChain++ }
          heatExpiry = Math.max(heatExpiry, time + dot.ticks)
          if (!frozen) heatEndStage = Math.min(4, heatRampFrom + Math.floor((heatExpiry - heatRampStart) / (HEAT_UP_STEP * heatScale) + 1e-9))
          queue.push({ t: time + dot.firstTickAt, seq: seq++, dot: dot.label, crit, head, left: Infinity, heatChain, normal: firingNormal })
        } else {
          queue.push({ t: time + dot.firstTickAt, seq: seq++, dot: dot.label, crit, head, left: dot.ticks, heatChain: -1, normal: firingNormal })
        }
      }
    }
    if (dead) break
    // the shot's procs land now: Viral (wiki) "Attacks deal their initial damage before they apply Viral status effects",
    // and the same for Corrosive/Heat strips (the user's call: they count from the next hit on)
    for (const { type, expiry } of pending) {
      const timers = (stackTimers[type] ??= [])
      while (timers.length && timers[0] <= time) timers.shift()
      if (type === 'cold' && pools.overguard > 0 && timers.length >= OVERGUARD_COLD_CAP) continue
      if (timers.length >= MAX_STACKS) timers.shift()
      timers.push(expiry)
      timers.sort((a, b) => a - b)
    }
    pending.length = 0
  }
  if (!dead) dead = runQueueUntil(cap)
  sampleUpTo(cap)
  // after the kill the curves sit at 0
  for (let i = nextSample; i <= SAMPLES; i++) {
    samples.overguard[i] = pools.overguard; samples.shield[i] = pools.shield; samples.health[i] = pools.health
    samples.armor[i] = samples.armor[Math.max(0, nextSample - 1)]
  }
  const shotsToKill = Number.isFinite(killTime) ? times.filter((time) => time <= killTime).length : shotsFired
  const reloads = setup.cycle ? 0 : magazine && base.result.shotModel.reloadTime ? Math.floor(Math.max(0, shotsToKill - 1) / magazine) : 0
  return {
    killTime,
    shots: shotsToKill,
    reloads,
    armorZeroAt,
    minArmor: Number.isFinite(minArmor) ? minArmor : 0,
    samples,
    directDealt,
    dotDealt,
    procs: procMarks,
    model: base.result.shotModel,
    dealtBy: (seconds: number) => {
      let total = 0
      for (let i = 0; i < dealtTimes.length; i++) if (dealtTimes[i] < seconds) total += dealtAmounts[i]
      return total
    },
  }
}

export function simulateFight(setup: FightSetup, onProgress?: (done: number) => void): FightSummary {
  const pricer = makePricer(setup.input, Boolean(setup.frozen))
  const normalPricer = setup.cycle ? makePricer(setup.cycle.normalInput, Boolean(setup.frozen)) : undefined
  // a few pilot runs to see roughly when it dies, so the curves get their 240 samples over the fight and not over a 60 s cap
  // when the kill takes 1 s
  // the direct-only fights die later, so they set the grid
  const directSetup: FightSetup = { ...setup, directOnly: true }
  const pilot = Array.from({ length: Math.min(setup.runs, 20) }, (_, run) => runFight(directSetup, run, pricer, undefined, setup.seconds, normalPricer).killTime).sort((a, b) => a - b)
  const slowest = pilot[pilot.length - 1]
  const horizon = Number.isFinite(slowest) ? Math.min(setup.seconds, Math.max(0.5, slowest * 1.25)) : setup.seconds
  const results: RunResult[] = []
  const directResults: RunResult[] = []
  for (let run = 0; run < setup.runs; run++) {
    results.push(runFight(setup, run, pricer, undefined, horizon, normalPricer))
    directResults.push(runFight(directSetup, run, pricer, undefined, horizon, normalPricer))
    if (onProgress && run % 25 === 24) onProgress(run + 1)
  }
  const order = results.map((result, run) => ({ run, t: result.killTime })).sort((a, b) => a.t - b.t)
  const killTimes = order.map((entry) => entry.t)
  const medianRun = order[Math.floor(order.length / 2)].run
  const log: FightEvent[] = []
  const median = runFight(setup, medianRun, pricer, log, horizon, normalPricer)
  const medianDirect = directResults[medianRun]
  const totalHp = (result: RunResult) => Array.from(result.samples.health, (health, i) => health + result.samples.shield[i] + result.samples.overguard[i])
  const directKillTimes = directResults.map((result) => result.killTime).sort((a, b) => a - b)
  const share = (rs: RunResult[]) => { const dot = rs.reduce((t, r) => t + r.dotDealt, 0), all = rs.reduce((t, r) => t + r.dotDealt + r.directDealt, 0); return all > 0 ? dot / all : 0 }

  const band = (pick: (result: RunResult) => Float64Array): Band => {
    const out: Band = { p10: [], median: [], p90: [] }
    const column: number[] = new Array(results.length)
    for (let i = 0; i <= SAMPLES; i++) {
      results.forEach((result, run) => { column[run] = pick(result)[i] })
      column.sort((a, b) => a - b)
      out.p10.push(quantile(column, 0.1)); out.median.push(quantile(column, 0.5)); out.p90.push(quantile(column, 0.9))
    }
    return out
  }
  const killed = results.filter((result) => Number.isFinite(result.killTime))
  const armorZero = results.filter((result) => result.armorZeroAt !== null)
  const startArmor = makePricer(setup.input, Boolean(setup.frozen)).price('health', false, {}, 0, setup.pools.overguard > 0).result.armor.after
  return {
    runs: setup.runs,
    seconds: setup.seconds,
    pools: { ...setup.pools, armor: startArmor },
    killTimes,
    kills: killed.length,
    ttk: { p10: quantile(killTimes, 0.1), median: quantile(killTimes, 0.5), p90: quantile(killTimes, 0.9) },
    times: Array.from({ length: SAMPLES + 1 }, (_, i) => (i * horizon) / SAMPLES),
    curves: { overguard: band((r) => r.samples.overguard), shield: band((r) => r.samples.shield), health: band((r) => r.samples.health), armor: band((r) => r.samples.armor) },
    shotsToKill: medianOf(killed.map((result) => result.shots)),
    reloadsToKill: medianOf(killed.map((result) => result.reloads)),
    runsWithReload: killed.filter((result) => result.reloads > 0).length,
    armorZeroAt: medianOf(armorZero.map((result) => result.armorZeroAt!)),
    runsArmorZero: armorZero.length,
    minArmor: medianOf(results.map((result) => result.minArmor)) ?? 0,
    log,
    direct: {
      killTimes: directKillTimes,
      kills: directKillTimes.filter(Number.isFinite).length,
      ttk: { p10: quantile(directKillTimes, 0.1), median: quantile(directKillTimes, 0.5), p90: quantile(directKillTimes, 0.9) },
    },
    statusShare: share(results),
    reloads: setup.cycle && normalPricer
      ? cycleSchedule(median.model, normalPricer.price('health', false, {}, 0, false).result.shotModel, setup.cycle.swapSeconds, setup.cycle.fillSeconds, setup.seconds).windows
      : reloadWindows(median.model, setup.seconds, isIncarnonAttackName(setup.input.attack.name) ? 'refill' : 'reload'),
    race: { withStatus: totalHp(median), directOnly: totalHp(medianDirect), killAt: median.killTime, directKillAt: medianDirect.killTime, statusShare: share([median]), procs: median.procs },
    states: pricer.size,
  }
}

// reload windows on the shot model's clock: after a magazine's last shot comes one shot interval, then the reload
// (Felarx & co. reload shell by shell, reloadTime already has that in it). on an Incarnon form the "reload" is the whole
// refill: earning the charges back with the normal form plus switching out and in (damage.ts), so it's shaded as that
export function reloadWindows(model: ShotModel, seconds: number, kind: ShadeKind = 'reload'): Shade[] {
  if (!model.magazineSize || !model.reloadTime) return []
  const times = shotTimes(model, seconds)
  const windows: Shade[] = []
  for (let i = model.magazineSize - 1; i < times.length; i += model.magazineSize) {
    const start = times[i] + 1 / model.fireRate
    if (start < seconds) windows.push({ start, end: Math.min(seconds, start + model.reloadTime), kind })
  }
  return windows
}

// experimental cycle mode for an Incarnon form: fire the battery, drop straight back to the normal form with a full magazine
// (no switch animation when the battery runs out, Daniel's call; wiki Incarnon: "When Incarnon Form ends, the weapon's
// magazine will be refilled ... as if it were reloaded"), fire it for as long as the charges take to earn back (damage.ts's
// fill time), switch back in (the one switch that costs time), repeat
export function cycleSchedule(incarnon: ShotModel, normal: ShotModel, swapSeconds: number, fill: number, seconds: number) {
  const shots: { t: number; normal: boolean }[] = []
  const windows: Shade[] = []
  const battery = incarnon.magazineSize ?? 0
  if (!battery) return { shots: shotTimes(incarnon, seconds).map((t) => ({ t, normal: false })), windows }
  let cycleStart = 0
  while (cycleStart < seconds && shots.length < 200000) {
    const firstShot = cycleStart + (incarnon.firstShotAt ?? 0)
    for (let k = 0; k < battery; k++) {
      const t = firstShot + k / incarnon.fireRate
      if (t >= seconds) return { shots, windows }
      shots.push({ t, normal: false })
    }
    const normalStart = firstShot + battery / incarnon.fireRate
    const normalEnd = normalStart + fill
    if (normalStart < seconds) windows.push({ start: normalStart, end: Math.min(seconds, normalEnd), kind: 'normal' })
    for (const t of shotTimes(normal, fill)) if (normalStart + t < seconds) shots.push({ t: normalStart + t, normal: true })
    for (const reload of reloadWindows(normal, fill)) if (normalStart + reload.start < seconds) windows.push({ start: normalStart + reload.start, end: Math.min(seconds, normalStart + reload.end), kind: 'reload' })
    if (normalEnd < seconds) windows.push({ start: normalEnd, end: Math.min(seconds, normalEnd + swapSeconds), kind: 'switch' })
    cycleStart = normalEnd + swapSeconds
  }
  return { shots, windows }
}

// can this attack run the cycle mode? an Incarnon form with a battery, and the weapon's normal form to fall back on (same
// pick as damage.ts's refill: the first non-Incarnon attack that isn't merged or a heavy). switching in is
// INCARNON_SWAP_RELOADS x the base reload, like the refill estimate
export function incarnonCycle(input: CalcInput, result: CalcResult): IncarnonCycle | null {
  if (!isIncarnonAttackName(input.attack.name) || result.battery?.fillSeconds == null) return null
  const normal = input.weapon.attacks.find((candidate) => !isIncarnonAttackName(candidate.name) && !candidate.parts && !candidate.heavy)
  if (!normal) return null
  return { normalInput: { ...input, attack: normal }, swapSeconds: INCARNON_SWAP_RELOADS * (input.weapon.reloadTime ?? 0), fillSeconds: result.battery.fillSeconds }
}

// frozen-target damage by window, for the accuracy checks against expectedDamage / simulateDamage
export function frozenDamage(setup: Omit<FightSetup, 'frozen' | 'pools'>, windows: number[]): number[][] {
  const full: FightSetup = { ...setup, frozen: true, pools: { overguard: 0, shield: 0, health: Infinity }, seconds: Math.max(...windows) }
  const pricer = makePricer(full.input, true)
  const perWindow = windows.map(() => [] as number[])
  for (let run = 0; run < full.runs; run++) {
    const result = runFight(full, run, pricer)
    windows.forEach((window, w) => perWindow[w].push(result.dealtBy(window)))
  }
  return perWindow
}
