// weapons that reload one shell at a time (wiki Reload_Speed lists them). total reload =
// (start + end delay + per shell x magazine) / (1 + reload speed), so a bigger magazine means a longer reload.
// numbers from each weapon's wiki page, they add up to the data's reload time at base magazine
export const SHELL_BY_SHELL_RELOAD: Record<string, { delay: number; perShell: number }> = {
  Felarx: { delay: 0.8 + 0.5, perShell: 0.4 }, // 6 shells -> 3.7s
  Strun: { delay: 0.5 + 0.25, perShell: 0.5 }, // 6 -> 3.75s
  'Mk1-Strun': { delay: 0.5 + 0.25, perShell: 0.5 }, // 6 -> 3.75s
  'Strun Prime': { delay: 0.6, perShell: 0.4 }, // 10 -> 4.6s
  'Strun Wraith': { delay: 0.25 + 0.25, perShell: 0.45 }, // 10 -> 5s
  Corinth: { delay: 1.2, perShell: 0.22 }, // 5 -> 2.3s (Corinth Prime reloads the whole magazine)
  Zarr: { delay: 0.75, perShell: 0.5 }, // 3 -> 2.25s
}
