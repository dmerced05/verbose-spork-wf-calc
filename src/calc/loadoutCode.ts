// loadout codes: the whole calculator setup (weapon side and Warframe side) as one string to copy and paste back.
// it's the setup as JSON, deflated, then base64url so it's only letters, numbers, - and _. the "VS1." prefix is the format
// version, so if the shape ever changes an old code can still be read (or turned down cleanly) instead of half-loading
const PREFIX = 'VS1.'

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const output = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(output).arrayBuffer())
}

const toBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromBase64Url = (text: string) => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export async function encodeLoadout(setup: unknown): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(setup)), new CompressionStream('deflate-raw'))
  return PREFIX + toBase64Url(packed)
}

// throws on anything that isn't a code this version can read, with a message that says why
export async function decodeLoadout(code: string): Promise<unknown> {
  const trimmed = code.trim().replace(/\s+/g, '') // pasting out of chat apps can wrap it
  if (!trimmed.startsWith(PREFIX)) throw new Error("That isn't a loadout code (they start with VS1.)")
  try {
    const unpacked = await pipe(fromBase64Url(trimmed.slice(PREFIX.length)), new DecompressionStream('deflate-raw'))
    return JSON.parse(new TextDecoder().decode(unpacked))
  } catch {
    throw new Error('That loadout code is cut off or garbled')
  }
}
