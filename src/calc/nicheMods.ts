// mods the calc models at full strength that are hard to keep fully on in a real fight. I don't change their numbers
// (that's a judgement call per weapon), they just get a "Niche" tag with the catch on hover
const SPAM_TIP = 'The calc counts it the whole time.'

export function nicheNote(levelStats: string[][], rank = levelStats.length - 1): string | null {
  const text = (levelStats[rank] ?? levelStats[levelStats.length - 1] ?? []).join(' ').replace(/\\n/g, ' ')
  // Heavy Caliber, Magnum Force, Vicious Spread, Split Flights
  const accuracy = text.match(/-(\d+)% Accuracy/)
  if (accuracy && Number(accuracy[1]) >= 50) {
    return `-${accuracy[1]}% Accuracy. The calc assumes every pellet hits, so it's fine up close or on weapons with no spread (snipers, beams, ` +
      'AoE), but on an automatic at range a lot of shots will miss and the damage shown won\'t be real.'
  }
  // Spring-Loaded Chamber, Pressurized Magazine, Repeater Clip: "On Reload: +X% Fire Rate when Aiming for 9s"
  if (/On Reload:/.test(text) && /when Aiming/i.test(text)) {
    return 'Only on after a reload, only while aiming, and only for a few seconds. So the first magazine after you swap in is ' +
      `without it, and hip fire never gets it. ${SPAM_TIP}`
  }
  // Clip Delegation: the next magazine's bonus depends on the hits of the last one
  if (/On Reload:/.test(text)) return `Builds up over one magazine and pays off on the next, so it's off for the first magazine. ${SPAM_TIP}`
  return null
}
