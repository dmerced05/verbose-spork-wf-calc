// checks the export's weapon numbers against the wiki's weapon modules (scripts/wiki-weapons.json, from pull-wiki-data.py).
// prints every attack whose damage, crit, status or fire rate is off by more than 2%. merged attacks ("A + B") and the
// Heavy Attack I build myself aren't on the wiki, so they're skipped. run with: node scripts/compare-wiki-data.mjs
import { readFileSync } from 'node:fs'

const wiki = JSON.parse(readFileSync(new URL('./wiki-weapons.json', import.meta.url), 'utf8')).weapons
const ours = JSON.parse(readFileSync(new URL('../src/data/weapons.json', import.meta.url), 'utf8'))
const off = (a, b) => Math.abs(a - b) > 0.02 * Math.max(Math.abs(b), 1e-9)
const total = (damage) => Object.values(damage).reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)

const notOnWiki = []
const mismatches = []
let checked = 0
for (const weapon of ours) {
  const wikiWeapon = wiki[weapon.name]
  if (!wikiWeapon) { notOnWiki.push(weapon.name); continue }
  for (const attack of weapon.attacks) {
    const row = wikiWeapon.attacks.find((candidate) => candidate.name === attack.name)
    if (!row) continue
    checked++
    const pairs = [['damage', total(attack.damage), total(row.damage)], ['crit chance', attack.critChance, row.critChance],
      ['crit multiplier', attack.critMultiplier, row.critMultiplier], ['status chance', attack.statusChance, row.statusChance], ['fire rate', attack.fireRate, row.fireRate]]
    for (const [stat, mine, theirs] of pairs) {
      if (typeof theirs === 'number' && off(mine, theirs)) mismatches.push(`${weapon.name} / ${attack.name}: ${stat} ${+mine.toFixed(4)} here, ${+theirs.toFixed(4)} on the wiki`)
    }
  }
}
console.log(`${checked} attacks checked, ${mismatches.length} differ, ${notOnWiki.length} weapons not on the wiki (${notOnWiki.join(', ')})`)
for (const line of mismatches) console.log(`  ${line}`)
