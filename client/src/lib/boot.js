import { loadState } from './presets.js'
import { createSaver, loadStore } from './store.js'

// Pre-IndexedDB store; read once to migrate, then removed.
const STORAGE_KEY = 'hr-api-tester:v3'

function readLocalStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
  } catch {
    return {}
  }
}

// Loads the saved store (async: IndexedDB), migrating the old localStorage one
// on first run. Memoised so it runs once even if the loader mounts twice.
let bootPromise = null

export function boot() {
  bootPromise ??= (async () => {
    // The body editor's width used to be stored; it now always fills the
    // column, so drop any value left from then.
    try {
      localStorage.removeItem('hr-api-tester:bodyWidth')
    } catch {
      /* storage unavailable */
    }
    let initial
    let save
    try {
      const stored = await loadStore()
      initial = loadState(stored || readLocalStore())
      if (stored) {
        save = createSaver(initial)
      } else {
        save = createSaver(null)
        await save(initial)
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // No IndexedDB (e.g. some private modes): keep using localStorage.
      initial ??= loadState(readLocalStore())
      save = async (state) => localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    }
    return { initial, save }
  })()
  return bootPromise
}
