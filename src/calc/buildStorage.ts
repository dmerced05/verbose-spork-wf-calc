// local build storage: the last 10 builds (recorded on their own) and a saved list, as loadout codes in localStorage. it's
// per browser and best-effort: Safari wipes script-writable storage after 7 days of use without a visit, and clearing site
// data deletes it, so every build also has a link (?b=<code>) that lives wherever you keep it. every repo on one
// username.github.io shares this storage, hence the vs- prefix. functions take the store so the tests can hand in a fake one

export interface BuildLabel { weapon: string; attack: string; frame: string | null }
export interface RecentBuild { code: string; label: BuildLabel; at: number }
export interface SavedBuild { id: string; name: string; code: string; label: BuildLabel; savedAt: number }
type Store = Pick<Storage, 'getItem' | 'setItem'>

export const RECENT_KEY = 'vs-recent-builds'
export const SAVED_KEY = 'vs-saved-builds'
export const RECENT_LIMIT = 10

// localStorage itself can throw (Safari private windows, storage turned off), so this can come back null
export function browserStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

// a missing, corrupt or wrong-shaped value reads as an empty list
function readList<T>(store: Store | null, key: string, valid: (item: unknown) => item is T): T[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(valid) : []
  } catch {
    return []
  }
}
// a full quota or a blocked store just means it isn't kept; returns whether it was
function writeList(store: Store | null, key: string, list: unknown[]): boolean {
  try {
    store?.setItem(key, JSON.stringify(list))
    return Boolean(store)
  } catch {
    return false
  }
}

const isLabel = (value: unknown): value is BuildLabel =>
  typeof value === 'object' && value !== null && typeof (value as BuildLabel).weapon === 'string' && typeof (value as BuildLabel).attack === 'string'
const isRecent = (value: unknown): value is RecentBuild =>
  typeof value === 'object' && value !== null && typeof (value as RecentBuild).code === 'string' && isLabel((value as RecentBuild).label) && typeof (value as RecentBuild).at === 'number'
const isSaved = (value: unknown): value is SavedBuild => {
  const entry = value as SavedBuild
  return typeof value === 'object' && value !== null && typeof entry.id === 'string' && typeof entry.name === 'string' &&
    typeof entry.code === 'string' && typeof entry.savedAt === 'number' && isLabel(entry.label)
}

export const readRecent = (store: Store | null) => readList(store, RECENT_KEY, isRecent)
export const readSaved = (store: Store | null) => readList(store, SAVED_KEY, isSaved)

// newest first, one entry per code: adding a build that's already there moves it to the top
export function addRecent(store: Store | null, code: string, label: BuildLabel, now = Date.now()): RecentBuild[] {
  const next = [{ code, label, at: now }, ...readRecent(store).filter((entry) => entry.code !== code)].slice(0, RECENT_LIMIT)
  writeList(store, RECENT_KEY, next)
  return next
}

export function addSaved(store: Store | null, name: string, code: string, label: BuildLabel, now = Date.now()): SavedBuild[] {
  const entry: SavedBuild = { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: name.trim() || label.weapon, code, label, savedAt: now }
  const next = [entry, ...readSaved(store)]
  writeList(store, SAVED_KEY, next)
  return next
}
export function renameSaved(store: Store | null, id: string, name: string): SavedBuild[] {
  const next = readSaved(store).map((entry) => (entry.id === id && name.trim() ? { ...entry, name: name.trim() } : entry))
  writeList(store, SAVED_KEY, next)
  return next
}
export function deleteSaved(store: Store | null, id: string): SavedBuild[] {
  const next = readSaved(store).filter((entry) => entry.id !== id)
  writeList(store, SAVED_KEY, next)
  return next
}

// ---- build links: the site URL + ?b=<code>, opening on the Calculator tab. the query, not the hash, so tabs still route ----
export const BUILD_PARAM = 'b'
export function buildLink(code: string, href = window.location.href): string {
  const url = new URL(href)
  url.search = ''
  url.searchParams.set(BUILD_PARAM, code)
  url.hash = 'calculator'
  return url.toString()
}
export const codeFromUrl = (href = window.location.href): string | null => new URL(href).searchParams.get(BUILD_PARAM)

// keep the address bar on the current build (or drop it), without adding history entries
export function setUrlCode(code: string | null) {
  const url = new URL(window.location.href)
  if (code) url.searchParams.set(BUILD_PARAM, code)
  else url.searchParams.delete(BUILD_PARAM)
  if (url.toString() !== window.location.href) window.history.replaceState(window.history.state, '', url)
}

// ask once, on the first save, for storage the browser won't clear on its own. Safari may say no, which is fine
export function askPersistentOnce(store: Store | null) {
  try {
    if (store?.getItem('vs-persist-asked')) return
    store?.setItem('vs-persist-asked', '1')
    void navigator.storage?.persist?.()
  } catch {
    // nothing to do
  }
}
