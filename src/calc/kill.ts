// shots / time to kill vs a scaled enemy. this works off average damage (crits averaged in), so a lucky
// or unlucky string of crits will land on either side of it.
import type { CalcResult } from './damage'

export interface KillEstimate {
  shieldDamagePerShot: number
  healthDamagePerShot: number
  shotsToStripShields: number
  shotsToKill: number // Infinity if this build can't get through
  directTimeToKill: number // seconds, first shot at t = 0, reloads included
  sustainedTimeToKill: number // seconds, sustained direct + DoT DPS, ignores the DoT ramp-up
  oneShot: boolean
}

// I don't carry overflow damage from shields into health, so shots to kill is a little pessimistic
export function estimateKill(health: number, shield: number, vsHealth: CalcResult, vsShield: CalcResult): KillEstimate {
  // toxin skips shields, so while shields are up it still chips health
  const toxinPerShot = (vsHealth.damageTypes.find((row) => row.damageType === 'toxin')?.vsTarget ?? 0) * vsHealth.multishot
  const shieldDamagePerShot =
    vsShield.damageTypes.filter((row) => row.damageType !== 'toxin').reduce((total, row) => total + row.vsTarget, 0) * vsShield.multishot
  const healthDamagePerShot = vsHealth.averageShot

  let shotsToStripShields = 0
  let shotsToKill: number
  if (shield > 0 && shieldDamagePerShot <= 0) {
    shotsToKill = toxinPerShot > 0 ? Math.ceil(health / toxinPerShot) : Infinity
  } else {
    shotsToStripShields = shield > 0 ? Math.ceil(shield / shieldDamagePerShot) : 0
    const healthLeft = health - toxinPerShot * shotsToStripShields
    if (healthLeft <= 0) shotsToKill = Math.ceil(health / toxinPerShot)
    else shotsToKill = healthDamagePerShot > 0 ? shotsToStripShields + Math.ceil(healthLeft / healthDamagePerShot) : Infinity
  }

  const fireRate = vsHealth.fireRate
  // reloads: every full magazine adds a reload before the next shot
  const reloadsBefore = (shots: number) =>
    vsHealth.magazineSize && vsHealth.reloadTime ? Math.floor((shots - 1) / vsHealth.magazineSize) * vsHealth.reloadTime : 0
  const shieldDps = (shieldDamagePerShot * fireRate + vsShield.dotDps) * vsShield.uptime
  const sustainedTimeToKill =
    (shield > 0 ? (shieldDps > 0 ? shield / shieldDps : Infinity) : 0) + (vsHealth.sustainedDps > 0 ? health / vsHealth.sustainedDps : Infinity)

  return {
    shieldDamagePerShot,
    healthDamagePerShot,
    shotsToStripShields,
    shotsToKill,
    directTimeToKill: Number.isFinite(shotsToKill) ? Math.max(0, shotsToKill - 1) / fireRate + reloadsBefore(shotsToKill) : Infinity,
    sustainedTimeToKill,
    oneShot: shotsToKill === 1,
  }
}
