// which attacks only fire in the Incarnon form. nearly all of them say so in their name; Laetum's Auto Radial Attack
// (the burst every Incarnon form shot sets off) is the one that doesn't, so it's listed. everything that asks "is this
// the Incarnon form" (charges, no Ammo Efficiency, [Normal only] / [Incarnon only] perks, boards, analysis) goes through here
const FORM_ONLY = /incarnon|^Auto Radial Attack$/i
export const isIncarnonAttackName = (name: string) => FORM_ONLY.test(name)
