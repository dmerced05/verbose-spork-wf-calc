// the 32-bit damage limit. damage isn't capped there: anything past it shows on screen as -2,147,483,648 (the float
// doesn't fit in an int, so it lands on the bottom value instead of wrapping), and the game log writes the real
// value under a "number too large" error. so I show both
export const INT_LIMIT = 2_147_483_647
export const INT_MIN = -2_147_483_648

// what the damage number on screen reads
export function onScreen(value: number): number {
  const rounded = Math.round(value)
  return rounded <= INT_LIMIT ? rounded : INT_MIN
}
