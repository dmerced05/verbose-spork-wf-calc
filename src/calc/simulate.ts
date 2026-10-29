// damage over a stretch of time: shots on the fire rate, magazine + reload, and status procs ticking on their own
// clocks. two versions share one shot model:
//  - expectedDamage: the average, deterministic and fast (the optimizer calls it thousands of times per attack)
//  - simulateDamage: Monte Carlo, rolls crits and procs per pellet, so the UI can show a bad-luck / good-luck range
// DoT ticks only count if they land inside the window, so long Status Duration tails past the end of a fight
// don't count. Heat refreshes every Heat stack on a new Heat proc (wiki Heat_Damage), so stacks keep ticking
// as long as Heat procs keep coming

export interface DotModel {
  damageType: string
  procsPerPellet: number // expected procs of this type per pellet
  tick: { normal: number; crit: number; average: number } // per tick, by the crit tier of the hit that applied it
  ticks: number // ticks per proc (6, more with status duration). Blast = 1
  firstTickAt: number // seconds after the proc: 1 for Slash/Heat/Toxin, 0 for Electricity/Gas, 1.5 for Blast's fuse
  refreshes: boolean // Heat
}

export interface ShotModel {
  fireRate: number
  multishot: number
  magazineSize: number | null
  reloadTime: number | null
  hit: { normal: number; crit: number; average: number } // per pellet, "crit" = next crit tier up
  critChance: number
  dots: DotModel[]
  instantDots: boolean // Harmony heavies detonate their procs on the spot
}

// shot times from t = 0 until the window closes: a full magazine, then a reload, and so on
export function shotTimes(model: ShotModel, seconds: number): number[] {
  const times: number[] = []
  const interval = 1 / model.fireRate
  let time = 0
  let roundsLeft = model.magazineSize ?? Infinity
  while (time < seconds && times.length < 200000) {
    times.push(time)
    time += interval
    if (--roundsLeft <= 0 && model.reloadTime) {
      time += model.reloadTime
      roundsLeft = model.magazineSize!
    }
  }
  return times
}

// ticks of one proc applied at `start` that land before `windowEnd` and before `expiry`
function ticksInside(start: number, firstTickAt: number, ticks: number, windowEnd: number, expiry: number) {
  if (ticks <= 1) return start + firstTickAt < windowEnd ? 1 : 0 // Blast: one hit after the fuse
  // ticks at start + firstTickAt + k, k = 0, 1, ...
  const beforeWindow = Math.ceil(windowEnd - start - firstTickAt - 1e-9)
  const beforeExpiry = Math.floor(expiry - start - firstTickAt + 1e-9) + 1
  return Math.max(0, Math.min(ticks, beforeWindow, beforeExpiry))
}

// heat stacks die together when no new Heat proc lands within one duration of the last one
function heatExpiries(procTimes: number[], duration: number) {
  const expiries = new Array<number>(procTimes.length)
  let chainStart = 0
  for (let i = 1; i <= procTimes.length; i++) {
    if (i === procTimes.length || procTimes[i] - procTimes[i - 1] > duration) {
      for (let j = chainStart; j < i; j++) expiries[j] = procTimes[i - 1] + duration
      chainStart = i
    }
  }
  return expiries
}

export function expectedDamage(model: ShotModel, seconds: number): number {
  const times = shotTimes(model, seconds)
  const pelletsPerShot = model.multishot
  let total = times.length * model.hit.average * pelletsPerShot
  for (const dot of model.dots) {
    const perShot = dot.procsPerPellet * pelletsPerShot * dot.tick.average
    if (perShot <= 0) continue
    if (model.instantDots) {
      total += perShot * dot.ticks * times.length
      continue
    }
    // expected Heat procs come every 1 / (procs per shot x fire rate) seconds. if that's within one duration the
    // stacks keep refreshing, otherwise each proc runs its own 6 ticks
    const refreshes = dot.refreshes && 1 / (dot.procsPerPellet * pelletsPerShot * model.fireRate) <= dot.ticks
    const expiries = refreshes ? heatExpiries(times, dot.ticks) : null
    for (let i = 0; i < times.length; i++) {
      const expiry = expiries ? expiries[i] : times[i] + dot.firstTickAt + dot.ticks - 1
      total += perShot * ticksInside(times[i], dot.firstTickAt, expiries ? Infinity : dot.ticks, seconds, expiry)
    }
  }
  return total
}

// small seeded RNG (mulberry32) so the range doesn't jump around on every re-render
function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface DamageRange {
  expected: number
  low: number // 10th percentile
  median: number
  high: number // 90th percentile
}

// one pass covers several windows (3 / 10 / 30 s), each run's shots and procs are scored against every window
export function simulateDamage(model: ShotModel, windows: number[], requestedRuns?: number, seed = 12345): DamageRange[] {
  const random = rng(seed)
  const longest = Math.max(...windows)
  const times = shotTimes(model, longest)
  // keep it to ~400k pellet rolls so the UI stays snappy on high fire rate / multishot builds (60-300 runs)
  const runs = requestedRuns ?? Math.max(60, Math.min(300, Math.ceil(400000 / Math.max(1, times.length * model.multishot))))
  const critFloor = Math.floor(model.critChance)
  const critUpChance = model.critChance - critFloor // chance a pellet rolls the next tier up
  // Gotva/Devouring Attrition style bonuses only exist in the average, so rescale the tiers to keep the mean right
  const tierMean = (1 - critUpChance) * model.hit.normal + critUpChance * model.hit.crit
  const hitScale = tierMean > 0 ? model.hit.average / tierMean : 1
  const procsPerPellet = model.dots.reduce((total, dot) => total + dot.procsPerPellet, 0)
  const procFloor = Math.floor(procsPerPellet)
  const procUpChance = procsPerPellet - procFloor
  const weights = model.dots.map((dot) => dot.procsPerPellet / (procsPerPellet || 1))
  const tickScale = model.dots.map((dot) => {
    const mean = (1 - critUpChance) * dot.tick.normal + critUpChance * dot.tick.crit
    return mean > 0 ? dot.tick.average / mean : 1
  })
  const pelletFloor = Math.floor(model.multishot)
  const pelletUpChance = model.multishot - pelletFloor

  const results = windows.map(() => [] as number[])
  const totals = new Array<number>(windows.length)
  for (let run = 0; run < runs; run++) {
    totals.fill(0)
    // heat procs get settled at the end, since a later proc can extend earlier stacks
    const heat: { time: number; tick: number; dot: DotModel }[] = []
    for (const time of times) {
      const pellets = pelletFloor + (random() < pelletUpChance ? 1 : 0)
      for (let pellet = 0; pellet < pellets; pellet++) {
        const crit = random() < critUpChance
        const direct = (crit ? model.hit.crit : model.hit.normal) * hitScale
        for (let w = 0; w < windows.length; w++) if (time < windows[w]) totals[w] += direct
        const procs = procFloor + (random() < procUpChance ? 1 : 0)
        for (let proc = 0; proc < procs; proc++) {
          // pick the proc's damage type by its share
          let pick = random()
          let index = 0
          while (index < weights.length - 1 && pick >= weights[index]) pick -= weights[index++]
          const dot = model.dots[index]
          const tick = (crit ? dot.tick.crit : dot.tick.normal) * tickScale[index]
          if (dot.refreshes && !model.instantDots) {
            heat.push({ time, tick, dot })
            continue
          }
          for (let w = 0; w < windows.length; w++) {
            if (time >= windows[w]) continue
            totals[w] += model.instantDots
              ? tick * dot.ticks
              : tick * ticksInside(time, dot.firstTickAt, dot.ticks, windows[w], time + dot.firstTickAt + dot.ticks - 1)
          }
        }
      }
    }
    if (heat.length) {
      const expiries = heatExpiries(heat.map((proc) => proc.time), heat[0].dot.ticks)
      heat.forEach((proc, i) => {
        for (let w = 0; w < windows.length; w++) totals[w] += proc.tick * ticksInside(proc.time, proc.dot.firstTickAt, Infinity, windows[w], expiries[i])
      })
    }
    totals.forEach((total, w) => results[w].push(total))
  }
  return results.map((values) => {
    values.sort((a, b) => a - b)
    const at = (quantile: number) => values[Math.min(values.length - 1, Math.floor(quantile * values.length))]
    return { expected: values.reduce((a, b) => a + b, 0) / values.length, low: at(0.1), median: at(0.5), high: at(0.9) }
  })
}

// how long until `amount` damage is dealt (expected), for time-to-kill. damage only goes up with time, so binary search
export function timeToDeal(model: ShotModel, amount: number, maxSeconds = 600): number {
  if (amount <= 0) return 0
  if (expectedDamage(model, maxSeconds) < amount) return Infinity
  let low = 0
  let high = maxSeconds
  for (let step = 0; step < 40 && high - low > 0.01; step++) {
    const middle = (low + high) / 2
    if (expectedDamage(model, middle) >= amount) high = middle
    else low = middle
  }
  return high
}
