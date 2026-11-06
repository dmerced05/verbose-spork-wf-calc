// keeps the About page honest: every algorithm there names the code it describes (a file, or one function / const in it),
// and its write-up is stamped with a hash of that code (src/about/verified.json). change the code and the hash stops
// matching: the page flags the write-up as out of date and `npm run check` fails until it's reread and restamped
// (`npm run about:stamp`). numbers in the write-ups ({{file#NAME}}) are read straight out of the source, so a changed
// constant shows up without anyone touching the text. pure functions, the page and scripts/check-about.ts both use them

export interface SourceRef { file: string; symbol?: string }

// comment-only lines and whitespace don't count, same idea as the leaderboard fingerprint: rewording a comment isn't a code change
export function normalize(code: string): string {
  return code.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('//')).join('\n').replace(/\s+/g, ' ')
}

// one function / const out of a file: from its declaration to the brace that closes it (or the end of the line for a
// one-line const). null if it's gone, which counts as out of date too
export function extractSymbol(code: string, symbol: string): string | null {
  const start = code.search(new RegExp(`(?:function\\*?|const|let|class|interface|type)\\s+${symbol}\\b`))
  if (start < 0) return null
  // walk brackets until a line break at depth 0 that doesn't continue the statement (a line ending in `=`, `=>`, `,`...)
  let depth = 0
  for (let index = start; index < code.length; index++) {
    const char = code[index]
    if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char)) depth--
    else if (char === '\n' && depth <= 0 && !/(=>|[=(,:?+\-*/|&])\s*$/.test(code.slice(start, index))) return code.slice(start, index)
  }
  return code.slice(start)
}

// FNV-1a, 32 bit, as hex. not cryptographic, it only has to notice edits
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// one hash over everything an algorithm cites. read = file path -> its text (null if the file is missing)
export function sourcesHash(sources: SourceRef[], read: (file: string) => string | null): { hash: string; missing: string[] } {
  const missing: string[] = []
  const parts = sources.map(({ file, symbol }) => {
    const code = read(file)
    const part = code === null ? null : symbol ? extractSymbol(code, symbol) : code
    if (part === null) missing.push(symbol ? `${file}#${symbol}` : file)
    return normalize(part ?? '')
  })
  return { hash: fnv1a(parts.join('\n\u0000\n')), missing }
}

// {{src/optimizer/optimize.ts#BEAM_WIDTH}} -> the constant's value as written in the code ("8"). an unresolved one is left
// as "?" and reported, so a renamed constant can't silently show a stale number
export const PLACEHOLDER = /\{\{([^#}]+)#([A-Za-z_$][\w$]*)\}\}/g
export function readConstant(code: string | null, name: string): string | null {
  if (!code) return null
  const match = code.match(new RegExp(`(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*([^\\n;]+)`))
  if (!match) return null
  return match[1].replace(/\s*\/\/.*$/, '').replace(/\bas const\b/, '').trim()
}
export function fillPlaceholders(text: string, read: (file: string) => string | null, unresolved?: string[]): string {
  return text.replace(PLACEHOLDER, (_, file: string, name: string) => {
    const value = readConstant(read(file), name)
    if (value === null) unresolved?.push(`${file}#${name}`)
    return value ?? '?'
  })
}
