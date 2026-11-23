import { IDBFactory } from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// store.js keeps one open connection per module instance, so each test gets a
// fresh in-memory IndexedDB and a fresh copy of the module.
let store
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  vi.resetModules()
  store = await import('./store.js')
})

const entry = (id, ts, extra = {}) => ({ id, ts, method: 'POST', ...extra })
const state = (searchHistory, extra = {}) => ({
  preset: 'search',
  sessions: { search: { body: '{}', history: searchHistory, ...extra }, pages: { body: '', history: [] } },
})

describe('store', () => {
  it('has nothing to load before the first save', async () => {
    expect(await store.loadStore()).toBeNull()
  })

  it('round-trips state with history newest first', async () => {
    const save = store.createSaver(null)
    await save(state([entry('b', 1), entry('a', 2)], { tab: 'json' }))
    const loaded = await store.loadStore()
    expect(loaded.preset).toBe('search')
    expect(loaded.sessions.search.tab).toBe('json')
    expect(loaded.sessions.search.history.map((h) => h.id)).toEqual(['a', 'b'])
    // The preset tag used to group entries is not leaked back onto them.
    expect(loaded.sessions.search.history[0]).not.toHaveProperty('preset')
    expect(loaded.sessions.pages.history).toBeUndefined()
  })

  it('writes only new or changed entries, and deletes removed ones', async () => {
    const a = entry('a', 1)
    const b = entry('b', 2)
    const save = store.createSaver(null)
    await save(state([b, a]))

    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    const lockedB = { ...b, locked: true } // edits replace the entry object
    await save(state([lockedB, a], { body: '{"query":"typed"}' }))
    const entryPuts = put.mock.calls.filter(([v]) => v && 'id' in v).map(([v]) => v.id)
    expect(entryPuts).toEqual(['b'])
    put.mockRestore()

    await save(state([lockedB], { body: '{"query":"typed"}' }))
    const loaded = await store.loadStore()
    expect(loaded.sessions.search.history).toEqual([{ ...lockedB }])
    expect(loaded.sessions.search.body).toBe('{"query":"typed"}')
  })

  it('does not rewrite entries it was created from', async () => {
    const first = store.createSaver(null)
    await first(state([entry('a', 1)]))
    const loaded = await store.loadStore()

    const put = vi.spyOn(IDBObjectStore.prototype, 'put')
    await store.createSaver(loaded)(loaded)
    expect(put.mock.calls.filter(([v]) => v && 'id' in v)).toHaveLength(0)
    put.mockRestore()
  })
})
