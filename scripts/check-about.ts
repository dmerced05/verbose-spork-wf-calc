// is every About page write-up still describing the code it cites? (src/about/sync.ts has the why)
//   npx tsx scripts/check-about.ts           list out-of-date write-ups and unresolved {{constants}}, exit 1 if any
//   npx tsx scripts/check-about.ts --stamp   after rereading and fixing them: record the current code as checked
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ALGORITHMS } from '../src/about/algorithms'
import { fillPlaceholders, sourcesHash } from '../src/about/sync'

const ROOT = new URL('../', import.meta.url)
const VERIFIED = new URL('src/about/verified.json', ROOT)
const read = (file: string) => (existsSync(new URL(file, ROOT)) ? readFileSync(new URL(file, ROOT), 'utf8') : null)
const verified: Record<string, string> = existsSync(VERIFIED) ? JSON.parse(readFileSync(VERIFIED, 'utf8')) : {}

const current: Record<string, string> = {}
const problems: string[] = []
// the page only has the files its import.meta.glob lists, so a cited file outside it would always show as missing there
const globs = [...(readFileSync(new URL('src/components/About.tsx', ROOT), 'utf8').match(/import\.meta\.glob\(\[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1])
const inGlob = (file: string) => globs.some((glob) => new RegExp(`^${glob.slice(1).replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`).test(file))
for (const algorithm of ALGORITHMS) {
  const { hash, missing } = sourcesHash(algorithm.sources, read)
  current[algorithm.id] = hash
  const unlisted = [...new Set(algorithm.sources.map((source) => source.file))].filter((file) => !inGlob(file))
  if (unlisted.length) problems.push(`${algorithm.title}: cites files the About page doesn't load, add them to its import.meta.glob (${unlisted.join(', ')})`)
  if (missing.length) problems.push(`${algorithm.title}: cites code that's gone (${missing.join(', ')})`)
  const unresolved: string[] = []
  const texts = [algorithm.summary, algorithm.complexity, ...algorithm.steps, ...algorithm.equations.flatMap((equation) => [equation.tex, equation.note ?? '', equation.complexity ?? ''])]
  for (const text of texts) fillPlaceholders(text, read, unresolved)
  if (unresolved.length) problems.push(`${algorithm.title}: constants not found (${unresolved.join(', ')})`)
  if (!process.argv.includes('--stamp') && verified[algorithm.id] !== hash) problems.push(`${algorithm.title}: its code changed since the write-up was checked (${algorithm.sources.map((source) => source.symbol ? `${source.file}#${source.symbol}` : source.file).join(', ')})`)
}

if (process.argv.includes('--stamp')) {
  if (problems.length) {
    for (const problem of problems) console.log(`  ${problem}`)
    throw new Error('fix the citations above before stamping')
  }
  writeFileSync(VERIFIED, `${JSON.stringify(current, null, 1)}\n`)
  console.log(`stamped ${ALGORITHMS.length} About write-ups as matching the code`)
} else if (problems.length) {
  console.log('About page write-ups out of date (reread the code, update src/about/algorithms.ts, then npm run about:stamp):')
  for (const problem of problems) console.log(`  ${problem}`)
  process.exit(1)
} else console.log(`About page: all ${ALGORITHMS.length} write-ups match the code`)
