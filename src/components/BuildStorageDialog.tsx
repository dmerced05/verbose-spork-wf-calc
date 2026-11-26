// local build storage: a floating box with the current build, the last 10 builds and the saved list. every build can be
// loaded, saved and copied as a link. it all lives in this browser (see buildStorage.ts), so the box says so up top
import { useEffect, useRef, useState } from 'react'
import { addRecent, addSaved, askPersistentOnce, browserStore, buildLink, deleteSaved, readRecent, readSaved, renameSaved, type BuildLabel, type RecentBuild, type SavedBuild } from '../calc/buildStorage'

interface Props {
  current: { code: string; label: BuildLabel } | null // null while the current build is still being packed
  recentVersion: number // bumps when the Calculator records a recent build, so an open box refreshes
  onLoad: (code: string) => Promise<string | null> // applies the build; an error message if it couldn't
  onCopy: (text: string, what: string) => Promise<boolean> // the Calculator's clipboard (Safari promise write); false = blocked
  onClose: () => void
}

const labelText = (label: BuildLabel) => `${label.weapon} (${label.attack})${label.frame ? ` · ${label.frame}` : ''}`
const defaultName = (label: BuildLabel) => `${label.weapon}${label.frame ? ` + ${label.frame}` : ''}`
function ago(time: number) {
  const seconds = Math.max(0, (Date.now() - time) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86400)} d ago`
}
const date = (time: number) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export function BuildStorageDialog({ current, recentVersion, onLoad, onCopy, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const store = browserStore()
  const [recent, setRecent] = useState<RecentBuild[]>(() => readRecent(store))
  const [saved, setSaved] = useState<SavedBuild[]>(() => readSaved(store))
  const [naming, setNaming] = useState<{ code: string; label: BuildLabel; name: string } | null>(null) // the inline name box
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<{ text: string; ok: boolean } | null>(null) // the page behind a modal box can't be reached, so the fallback box lives here

  useEffect(() => { ref.current?.showModal() }, [])
  useEffect(() => { setRecent(readRecent(store)) }, [recentVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (code: string) => {
    const problem = await onLoad(code)
    if (problem) setError(problem)
    else ref.current?.close()
  }
  const startSave = (code: string, label: BuildLabel) => setNaming({ code, label, name: defaultName(label) })
  const finishSave = () => {
    if (!naming) return
    setSaved(addSaved(store, naming.name, naming.code, naming.label))
    askPersistentOnce(store)
    setNaming(null)
  }
  // copying a link counts as using the build, so it goes to the top of Recent with its own label
  const copyLink = (code: string, label: BuildLabel) => {
    const link = buildLink(code)
    void onCopy(link, 'Link').then((ok) => setCopied({ text: link, ok }))
    setRecent(addRecent(store, code, label))
  }

  // the inline name box, under whichever row asked for it
  const nameBox = (code: string) => naming?.code === code && (
    <form className="build-name" onSubmit={(event) => { event.preventDefault(); finishSave() }}>
      <input autoFocus aria-label="Build name" value={naming.name} onChange={(event) => setNaming({ ...naming, name: event.target.value })} onFocus={(event) => event.target.select()} />
      <button type="submit">Save</button>
      <button type="button" className="link-button" onClick={() => setNaming(null)}>cancel</button>
    </form>
  )

  return (
    <dialog ref={ref} className="fight-dialog build-dialog" onClose={onClose} aria-labelledby="build-storage-title">
      <div className="fight-head">
        <h2 id="build-storage-title">Local build storage</h2>
        <button className="link-button" onClick={() => ref.current?.close()} aria-label="Close local build storage">Close</button>
      </div>
      <p className="build-warning">Saved in this browser only. Safari clears it after 7 days without a visit; clearing site data deletes it. Copy a link to keep a build anywhere.</p>
      {!store && <p className="error">This browser isn't letting the site store anything (private window?), so nothing here will be kept.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {copied && (copied.ok
        ? <p className="muted" role="status">Link copied ({copied.text.length} characters)</p>
        : <label className="build-copy-fallback">Your browser blocked the clipboard, copy the link from here
          <input readOnly autoFocus value={copied.text} onFocus={(event) => event.target.select()} onClick={(event) => event.currentTarget.select()} />
        </label>)}

      <h3>Current build</h3>
      {current ? (
        <div className="build-row">
          <span className="build-label">{labelText(current.label)}</span>
          <span className="build-actions">
            <button onClick={() => startSave(current.code, current.label)}>Save current build</button>
            <button onClick={() => copyLink(current.code, current.label)}>Copy link</button>
          </span>
          {nameBox(current.code)}
        </div>
      ) : <p className="muted">Packing the current build…</p>}

      <h3>Recent <span className="muted-inline">({recent.length} of 10)</span></h3>
      {recent.length === 0 && <p className="muted">Builds you load, copy or settle on (10 s without changes) show up here.</p>}
      {recent.map((entry) => (
        <div key={entry.code} className="build-row">
          <span className="build-label">{labelText(entry.label)} <span className="muted-inline">· {ago(entry.at)}</span></span>
          <span className="build-actions">
            <button onClick={() => load(entry.code)}>Load</button>
            <button onClick={() => startSave(entry.code, entry.label)}>Save to list</button>
            <button onClick={() => copyLink(entry.code, entry.label)}>Copy link</button>
          </span>
          {current?.code !== entry.code && nameBox(entry.code)}
        </div>
      ))}

      <h3>Saved <span className="muted-inline">({saved.length})</span></h3>
      {saved.length === 0 && <p className="muted">Nothing saved yet.</p>}
      {saved.map((entry) => (
        <div key={entry.id} className="build-row">
          {renaming?.id === entry.id ? (
            <form className="build-name" onSubmit={(event) => { event.preventDefault(); setSaved(renameSaved(store, entry.id, renaming.name)); setRenaming(null) }}>
              <input autoFocus aria-label="New name" value={renaming.name} onChange={(event) => setRenaming({ id: entry.id, name: event.target.value })} />
              <button type="submit">Rename</button>
              <button type="button" className="link-button" onClick={() => setRenaming(null)}>cancel</button>
            </form>
          ) : (
            <span className="build-label"><b>{entry.name}</b> <span className="muted-inline">· {labelText(entry.label)} · {date(entry.savedAt)}</span></span>
          )}
          <span className="build-actions">
            <button onClick={() => load(entry.code)}>Load</button>
            <button onClick={() => copyLink(entry.code, entry.label)}>Copy link</button>
            <button onClick={() => setRenaming({ id: entry.id, name: entry.name })}>Rename</button>
            {confirmDelete === entry.id ? (
              <>
                <button className="danger" onClick={() => { setSaved(deleteSaved(store, entry.id)); setConfirmDelete(null) }}>Delete for good</button>
                <button className="link-button" onClick={() => setConfirmDelete(null)}>keep</button>
              </>
            ) : <button onClick={() => setConfirmDelete(entry.id)}>Delete</button>}
          </span>
        </div>
      ))}
    </dialog>
  )
}
