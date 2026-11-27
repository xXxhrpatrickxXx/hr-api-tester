import { useEffect, useMemo, useRef, useState } from 'react'
import { entrySummary, matchesHistory } from '../lib/history.js'
import { responseError } from '../lib/request.js'

// The active solution's request history: search, import / export, and one row
// per entry (view, note, lock, remove). Entries themselves are changed by the
// parent through the on* callbacks.
//
// onImport(file) resolves to the message to show ({ text, bad? }).
export function HistoryPanel({
  history,
  viewedId,
  onView,
  onNote,
  onToggleLock,
  onDelete,
  onClear,
  onExport,
  onImport,
}) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? history.filter((h) => matchesHistory(h, q)) : history
  }, [history, query])

  const importRef = useRef(null)
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 5000)
    return () => clearTimeout(t)
  }, [msg])

  // A short label of your own on an entry (e.g. "before boost change"), shown
  // in place of the summary. Edited in place: the row turns into an input.
  const [editingId, setEditingId] = useState(null)
  const saveNoteRef = useRef(null) // saves the note being edited

  // Arrow keys step through the (filtered) list while a row has focus; focus
  // follows. Not while typing a note.
  function onKeyDown(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    if (e.target.tagName === 'INPUT') return
    e.preventDefault()
    const i = shown.findIndex((h) => h.id === viewedId)
    const j = Math.min(shown.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))
    const next = shown[j]
    if (!next) return
    if (next.id !== viewedId) onView(next.id)
    e.currentTarget.querySelector(`[data-id="${next.id}"]`)?.focus()
  }

  return (
    <div className="hist">
      <div className="hist-head">
        <span className="lbl">
          History · {query.trim() ? `${shown.length} / ` : ''}
          {history.length}
        </span>
        <div className="spacer" />
        <button
          className="link"
          onClick={() => importRef.current?.click()}
          title="Add entries from an exported history file"
        >
          import
        </button>
        <button
          className="link"
          onClick={onExport}
          title="Download every solution's history as JSON. Credential headers (Authorization, *key*, *token* …) are redacted; request bodies are kept as-is."
        >
          export
        </button>
        {history.length > 0 && (
          <button className="link" onClick={onClear}>clear all</button>
        )}
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = '' // so the same file can be picked again
            if (f) setMsg(await onImport(f))
          }}
        />
      </div>
      {msg && <div className={msg.bad ? 'hint bad' : 'hint'}>{msg.text}</div>}
      {history.length > 0 && (
        <input
          className="url hist-search"
          placeholder="Search history… (note, query, URL, body, status)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {history.length > 0 && shown.length === 0 && (
        <div className="hint">No history matches “{query}”.</div>
      )}
      <ul className="hist-list" onKeyDown={onKeyDown}>
        {shown.map((h) => (
          <li key={h.id} className={viewedId === h.id ? 'hist-row active' : 'hist-row'}>
            {editingId === h.id ? (
              <NoteInput
                initial={h.note || ''}
                placeholder={entrySummary(h)}
                saveRef={saveNoteRef}
                onDone={(note) => {
                  setEditingId(null)
                  if (note !== undefined) onNote(h.id, note.trim() || undefined)
                }}
              />
            ) : (
            <button
              className="hist-main"
              data-id={h.id}
              onClick={() => onView(h.id)}
              title={`${h.method} ${h.sentUrl || h.url}${h.note ? `\n${entrySummary(h)}` : ''}\n↑/↓ to step through history`}
            >
              <span className={h.resp?.ok && !responseError(h.resp) ? 'sdot ok' : 'sdot bad'} />
              <span className="hist-status">{h.resp?.status ?? 'ERR'}</span>
              <span className={h.note ? 'hist-sum note' : 'hist-sum'}>
                {h.note || entrySummary(h)}
              </span>
              <span className="hist-time">{new Date(h.ts).toLocaleTimeString()}</span>
            </button>
            )}
            <button
              className="hist-act"
              onClick={() => (editingId === h.id ? saveNoteRef.current?.() : setEditingId(h.id))}
              // While editing, this saves: keep the input from blurring first.
              onMouseDown={(e) => editingId === h.id && e.preventDefault()}
              title={editingId === h.id ? 'Save the note' : h.note ? `Note: ${h.note} — edit` : 'Add a note'}
            >
              ✎
            </button>
            <button
              className={h.locked ? 'hist-act on' : 'hist-act'}
              onClick={() => onToggleLock(h.id)}
              title={h.locked ? 'Locked — unlock' : 'Lock (keep on “clear all”)'}
            >
              {h.locked ? '🔒' : '🔓'}
            </button>
            <button className="hist-act" onClick={() => onDelete(h.id)} title="Remove this entry">
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Note editor shown in place of a history row. Enter or leaving the field
// saves; Escape cancels. `onDone(note)` gets the text, or undefined on cancel.
function NoteInput({ initial, placeholder, saveRef, onDone }) {
  const [value, setValue] = useState(initial)
  // Enter, then the blur as the input goes away, must not save twice.
  const done = useRef(false)
  const finish = (note) => {
    if (done.current) return
    done.current = true
    onDone(note)
  }
  useEffect(() => {
    saveRef.current = () => finish(value)
    return () => {
      saveRef.current = null
    }
  })
  return (
    <input
      className="url hist-note"
      autoFocus
      value={value}
      placeholder={placeholder}
      aria-label="Note for this request (empty to remove)"
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value)
        else if (e.key === 'Escape') finish(undefined)
      }}
    />
  )
}
