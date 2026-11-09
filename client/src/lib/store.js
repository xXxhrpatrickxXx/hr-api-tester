// Persistence in IndexedDB. History holds full API responses, which outgrow
// localStorage's ~5 MB quota quickly; IndexedDB allows far more.
//
// Two object stores:
//   state   — one record ('app'): the preset + each session minus its history
//   entries — one record per history entry, tagged with its preset
// Entries are immutable (edits replace the object), so saving only writes the
// entries whose object changed since the last save — typing in the form never
// rewrites the (large) history.

const DB_NAME = 'hr-api-tester'
const STATE_KEY = 'app'

let dbPromise = null
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('state')
        req.result.createObjectStore('entries', { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error)
  })

// Returns { preset, sessions } with each session's history attached (newest
// first), or null when nothing has been saved yet.
export async function loadStore() {
  const db = await openDb()
  const tx = db.transaction(['state', 'entries'], 'readonly')
  const stateReq = tx.objectStore('state').get(STATE_KEY)
  const entriesReq = tx.objectStore('entries').getAll()
  await done(tx)
  const state = stateReq.result
  if (!state) return null
  const sessions = { ...state.sessions }
  for (const { preset, ...entry } of entriesReq.result.sort((a, b) => b.ts - a.ts)) {
    if (!sessions[preset]) continue
    sessions[preset] = { ...sessions[preset], history: [...(sessions[preset].history || []), entry] }
  }
  return { preset: state.preset, sessions }
}

// Creates a saver that remembers what it last wrote, so each call only writes
// new/changed entries and deletes removed ones. Pass `saved` (the state just
// loaded) so the first save doesn't rewrite everything.
export function createSaver(saved) {
  let written = new Map()
  for (const sess of Object.values(saved?.sessions || {})) {
    for (const e of sess.history || []) written.set(e.id, e)
  }

  return async function save({ preset, sessions }) {
    const current = new Map()
    const light = {}
    for (const [key, sess] of Object.entries(sessions)) {
      const { history, ...rest } = sess
      light[key] = rest
      for (const e of history || []) current.set(e.id, { key, e })
    }
    const prev = written
    written = new Map([...current].map(([id, { e }]) => [id, e]))
    try {
      const db = await openDb()
      const tx = db.transaction(['state', 'entries'], 'readwrite')
      tx.objectStore('state').put({ preset, sessions: light }, STATE_KEY)
      const entries = tx.objectStore('entries')
      for (const [id, { key, e }] of current) {
        if (prev.get(id) !== e) entries.put({ ...e, preset: key })
      }
      for (const id of prev.keys()) if (!current.has(id)) entries.delete(id)
      await done(tx)
    } catch (err) {
      // Unknown what landed; rewrite everything next time.
      written = new Map()
      throw err
    }
  }
}
