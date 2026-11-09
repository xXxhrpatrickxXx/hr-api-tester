import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { extractResult, findArrayPaths, getPath, pageInfo, DEFAULT_FIELD_MAP } from './lib/products.js'
import { buildLegacyUrl, paramsFromUrl, parseParams } from './lib/legacy.js'
import { createSaver, loadStore } from './lib/store.js'

// Request templates per API. The endpoint is resolved client-side from BASES
// so the URL field shows the real value. The websiteUuid / API key vary per
// request, so fill them in before sending. Edit freely.
const PRESETS = {
  recommendations: {
    label: 'Recommendations',
    method: 'POST',
    baseKey: 'recommendations',
    body: JSON.stringify({ websiteUuid: '', boxId: '', context: {} }, null, 2),
  },
  search: {
    label: 'Search',
    method: 'POST',
    baseKey: 'search',
    body: JSON.stringify({ websiteUuid: '', query: '', size: 24 }, null, 2),
  },
  pages: {
    label: 'Pages',
    method: 'POST',
    baseKey: 'pages',
    needsKey: true, // a unique page key is appended to the endpoint
    body: JSON.stringify({ websiteUuid: '', url: '', size: 24 }, null, 2),
  },
  // Legacy APIs are GET with query-string params (no JSON body). The editor
  // holds the parameters as JSON (paste them from the API log) and the URL is
  // rebuilt from them as you type.
  legacyRecoms: {
    label: 'Recoms (legacy)',
    method: 'GET',
    baseKey: 'legacyRecoms',
    legacy: true,
    body: JSON.stringify({ ids: '', trackingUserId: '', url: '' }, null, 2),
  },
  legacySearch: {
    label: 'Search (legacy)',
    method: 'GET',
    baseKey: 'legacySearch',
    legacy: true,
    body: JSON.stringify({ key: '', q: '', product_count: '24', product_start: '0' }, null, 2),
  },
  custom: {
    label: 'Custom',
    method: 'GET',
    baseKey: null,
    body: '',
  },
}

// Public Hello Retail base URLs. Baked in so the app is fully static — the
// browser calls these directly (CORS is open), no server/proxy required.
const BASES = {
  recommendations: 'https://core.helloretail.com/serve/recoms',
  search: 'https://core.helloretail.com/serve/search',
  pages: 'https://core.helloretail.com/serve/pages',
  legacyRecoms: 'https://core.helloretail.com/api/v1/product-recommendation/getProductBoxes',
  legacySearch: 'https://core.helloretail.com/api/v1/search/partnerSearch',
}

// Build the literal endpoint URL for a preset from the base URLs. Legacy
// presets append their parameters (`body`); null if those don't parse.
function resolveUrl(presetKey, pagesKey, bases, body) {
  const p = PRESETS[presetKey]
  if (!p || !p.baseKey || !bases) return ''
  const base = bases[p.baseKey] || ''
  if (!base) return ''
  if (p.needsKey) return `${base.replace(/\/+$/, '')}/${pagesKey || ''}`
  if (p.legacy) {
    try {
      return buildLegacyUrl(base, parseParams(body))
    } catch {
      return null
    }
  }
  return base
}

// Pre-IndexedDB store; read once to migrate, then removed.
const STORAGE_KEY = 'hr-api-tester:v3'
const MAX_HISTORY = 100 // per solution; bounds the persisted store's size
const REQUEST_TIMEOUT_MS = 30000
const LOG_TAG_KEY = 'hr-api-tester:logTag'
const MATRIX_KEY = 'hr-api-tester:matrix'
const TABS = ['tiles', 'json', 'headers'] // results views

// Each preset (solution) keeps its own keys, body, settings, and a history of
// past requests/responses so switching solutions never loses your work and you
// can flip between earlier and newer runs to compare.
function blankSession(presetKey) {
  const p = PRESETS[presetKey]
  return {
    method: p.method,
    url: '', // resolved from server bases for non-custom presets
    pagesKey: '',
    body: p.body,
    headers: '{\n  "Content-Type": "application/json"\n}',
    productsPath: '',
    fieldMap: DEFAULT_FIELD_MAP,
    tileFields: '', // extra product fields shown on each tile, comma-separated
    history: [], // newest first; each entry is a request + its response
    viewId: null, // which history entry the results panel is showing
    tab: 'tiles', // results view (tiles / json / headers), kept across requests
    error: null, // transient validation error (not a sent request)
  }
}

// Short label for a history entry, pulled from the request body when possible.
// Computed once when the request is sent and stored on the entry (older
// entries fall back to computing it on read).
function entrySummary(entry) {
  if (entry.summary != null) return entry.summary
  return buildSummary(entry)
}

function buildSummary(entry) {
  try {
    // Legacy entries saved before the parameters editor only have a URL.
    const b = entry.body ? JSON.parse(entry.body) : JSON.parse(paramsFromUrl(entry.url))
    if (b.query) return `“${b.query}”`
    if (b.q) return `“${b.q}”`
    if (b.boxId) return `box ${b.boxId}`
    if (b.ids) return `box ${b.ids}`
    if (b.url) return b.url.replace(/^https?:\/\//, '')
  } catch {
    /* ignore unparseable body */
  }
  if (entry.pagesKey) return entry.pagesKey
  return entry.method
}

// The API error in a response, or null if it succeeded. The serve endpoints
// fail with a non-2xx status and {message, code, success: false}; the legacy
// ones answer 200 with {error, errorCode}, so the status alone isn't enough.
function responseError(resp) {
  if (!resp) return null
  const j = resp.json
  const obj = j && typeof j === 'object' && !Array.isArray(j) ? j : null
  const inBody = !!obj && (obj.success === false || typeof obj.error === 'string')
  if (resp.ok && !inBody) return null
  const message = obj?.message || obj?.error
  return {
    code: obj?.code || obj?.errorCode || null,
    message: typeof message === 'string' ? message : null,
    detail: j != null ? JSON.stringify(j, null, 2) : resp.text || '',
  }
}

const sendsBody = (method, body) => method !== 'GET' && method !== 'HEAD' && !!body?.trim()
const hasContentType = (headers) => Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')

// apiLogTag marks a request in Hello Retail's API log (find them with "only
// tagged"); it changes nothing about the response. Only HR's own endpoints know
// it, and appended by hand so legacy URLs stay readable (URL() re-encodes them).
function withLogTag(url, tag) {
  if (!tag || /[?&]apiLogTag=/.test(url)) return url
  try {
    if (new URL(url).hostname !== 'core.helloretail.com') return url
  } catch {
    return url
  }
  return `${url}${url.includes('?') ? '&' : '?'}apiLogTag=${encodeURIComponent(tag)}`
}

// The request body for the previous (dir -1) or next (dir 1) page, or null
// when the body has no offset to move. Search / Pages page with
// products.{start,count}; legacy Search with product_{start,count}. Pages
// paging keeps the product scope, so it sends firstLoad: false.
function pageRequest(presetKey, body, paging, dir) {
  if (!paging) return null
  const step = (count, start) => {
    const n = Number(count) || paging.shown
    return n > 0 ? Math.max(0, start + dir * n) : null
  }
  try {
    if (PRESETS[presetKey]?.legacy) {
      const p = parseParams(body)
      if (!('product_start' in p || 'product_count' in p)) return null
      const start = step(p.product_count, paging.start)
      return start == null ? null : JSON.stringify({ ...p, product_start: String(start) }, null, 2)
    }
    const b = JSON.parse(body)
    if (!b?.products || typeof b.products !== 'object') return null
    const start = step(b.products.count, paging.start)
    if (start == null) return null
    const next = { ...b, products: { ...b.products, start } }
    if (presetKey === 'pages' || 'firstLoad' in b) next.firstLoad = false
    return JSON.stringify(next, null, 2)
  } catch {
    return null
  }
}

// Extra tile field values: objects as compact JSON, missing as a dash.
function fieldText(v) {
  if (v == null || v === '') return '—'
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

// Case-insensitive substring match against one field's value, recursing into
// nested objects/arrays. "Any field" uses the tile's precomputed haystack
// instead, so it doesn't re-walk every product on each keystroke.
function valueMatches(val, q) {
  if (val == null) return false
  if (typeof val === 'object') return Object.values(val).some((v) => valueMatches(v, q))
  return String(val).toLowerCase().includes(q)
}

// Palette for waterfall step grouping. Which color maps to which step doesn't
// matter (steps differ per recommendation config) — only that each is distinct.
const STEP_COLORS = [
  '#6ea8fe', '#2ea043', '#d29922', '#bf5af2', '#ff6b6b',
  '#3fb6c0', '#e06ec0', '#9aa84a', '#5a78ff', '#cf6679',
]

// Group an ordered tile list into contiguous runs by source step, so each
// step's products render together under one header.
function groupTilesByStep(tiles) {
  const groups = []
  for (const t of tiles) {
    // `step` covers banners too, which sit inside a step block without being
    // attributed to it; `source` alone would split a step around them.
    const step = t.step || t.source || null
    const key = step ? step.index : '_none'
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.tiles.push(t)
    else groups.push({ key, source: step, tiles: [t] })
  }
  return groups
}

// Config-column sizing. PANEL_PAD is .panel's horizontal padding (14px each
// side), so panelWidth = editorWidth + PANEL_PAD keeps the editor un-clipped.
const PANEL_PAD = 28
// Below this the two columns don't fit, so panes are tabbed instead.
const MOBILE_QUERY = '(max-width: 820px)'
const MIN_LEFT = 280
const maxLeft = () => Math.min(1400, window.innerWidth - 320)

// Fill in defaults for anything the saved store lacks (new presets/fields).
function loadState(saved) {
  const sessions = {}
  for (const key of Object.keys(PRESETS)) {
    sessions[key] = { ...blankSession(key), ...(saved.sessions?.[key] || {}) }
    // Legacy sessions saved before the parameters editor kept their params in
    // the URL only; lift them into the editor.
    if (PRESETS[key].legacy && !sessions[key].body.trim() && sessions[key].url) {
      sessions[key].body = paramsFromUrl(sessions[key].url)
    }
  }
  return { preset: saved.preset || 'recommendations', sessions }
}

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
function boot() {
  bootPromise ??= (async () => {
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

export default function App() {
  const [loaded, setLoaded] = useState(null)
  useEffect(() => {
    let cancelled = false
    boot().then((l) => !cancelled && setLoaded(l))
    return () => {
      cancelled = true
    }
  }, [])
  return loaded && <Tester initial={loaded.initial} save={loaded.save} />
}

function Tester({ initial, save }) {
  const [preset, setPreset] = useState(initial.preset)
  const [sessions, setSessions] = useState(initial.sessions)
  const cur = sessions[preset]

  const [loading, setLoading] = useState(false)
  // Each solution remembers its own results view, so sending or stepping
  // through history stays on JSON (say) instead of jumping back to tiles.
  const tab = TABS.includes(cur.tab) ? cur.tab : 'tiles'
  const setTab = (t) => patch({ tab: t })

  // On narrow screens the side-by-side columns don't fit, so the request and
  // results panes become tabs and only one is shown at a time.
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  const [mobilePane, setMobilePane] = useState('request')
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Width of the config column, draggable via the gutter. Persisted across
  // sessions (a layout preference, not per-request data).
  const [leftWidth, setLeftWidth] = useState(() => {
    const w = Number(localStorage.getItem('hr-api-tester:leftWidth'))
    return w >= MIN_LEFT && w <= 1400 ? w : 420
  })
  useEffect(() => {
    localStorage.setItem('hr-api-tester:leftWidth', String(leftWidth))
  }, [leftWidth])

  // Height of the JSON body editor, set by dragging its resize handle and
  // persisted. Its *width* is not stored: the editor always fills the config
  // column, so it follows the column as that is resized.
  const [bodyHeight, setBodyHeight] = useState(() => {
    const h = Number(localStorage.getItem('hr-api-tester:bodyHeight'))
    return h >= 90 && h <= 4000 ? h : 260
  })
  useEffect(() => {
    localStorage.setItem('hr-api-tester:bodyHeight', String(bodyHeight))
    // Width used to be pinned separately; drop any value left from then.
    localStorage.removeItem('hr-api-tester:bodyWidth')
  }, [bodyHeight])

  // In-flight request, so it can be cancelled (or timed out).
  const abortRef = useRef(null)

  // Matrix mode: green-on-black look with digital rain behind the panels.
  // index.html applies the saved choice before first paint.
  const [matrix, setMatrix] = useState(() => document.documentElement.dataset.matrix === 'on')
  useEffect(() => {
    if (matrix) document.documentElement.dataset.matrix = 'on'
    else delete document.documentElement.dataset.matrix
    try {
      if (matrix) localStorage.setItem(MATRIX_KEY, 'on')
      else localStorage.removeItem(MATRIX_KEY)
    } catch {}
  }, [matrix])

  // API log tag, added to every request to Hello Retail. Shared by all
  // solutions and kept across sessions, like the layout preferences.
  const [logTag, setLogTag] = useState(() => {
    try {
      return localStorage.getItem(LOG_TAG_KEY) || ''
    } catch {
      return ''
    }
  })
  useEffect(() => {
    try {
      if (logTag) localStorage.setItem(LOG_TAG_KEY, logTag)
      else localStorage.removeItem(LOG_TAG_KEY)
    } catch {}
  }, [logTag])

  // Dragging the editor's corner sideways widens the config column instead of
  // the editor itself: the column grows to fit, then the editor snaps back to
  // filling it. Capped at the column's own maximum.
  const bodyRef = useRef(null)
  useEffect(() => {
    const el = bodyRef.current
    if (isMobile || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!el.style.width) return // already filling the column
      const max = maxLeft()
      const needed = Math.min(el.offsetWidth + PANEL_PAD, max)
      setLeftWidth((w) => (needed > w ? needed : w))
      if (el.offsetWidth + PANEL_PAD >= max) {
        // At the cap, stop the editor overflowing: the resize handle writes the
        // inline width directly, so clear it and let the column bound it.
        el.style.width = ''
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isMobile])

  function startResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = leftWidth
    const onMove = (ev) => {
      setLeftWidth(Math.min(Math.max(startW + ev.clientX - startX, MIN_LEFT), maxLeft()))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // Patch the active preset's session.
  function patch(changes) {
    setSessions((s) => ({ ...s, [preset]: { ...s[preset], ...changes } }))
  }

  // Keep the URL field showing the real resolved endpoint. Pages tracks the
  // page key live; other presets are populated once (legacy ones then follow
  // their parameters via setBody). Custom is left alone.
  useEffect(() => {
    if (preset === 'custom') return
    if (PRESETS[preset].needsKey) {
      patch({ url: resolveUrl(preset, cur.pagesKey, BASES) })
    } else if (!cur.url) {
      patch({ url: resolveUrl(preset, cur.pagesKey, BASES, cur.body) ?? '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, cur.pagesKey])

  const isLegacy = !!PRESETS[preset]?.legacy

  // Legacy: editing the parameters rebuilds the URL. While they don't parse
  // (e.g. mid-paste) the URL is left as it was.
  function setBody(body) {
    if (!isLegacy) return patch({ body })
    const url = resolveUrl(preset, cur.pagesKey, BASES, body)
    patch(url == null ? { body } : { body, url })
  }

  // ...and editing the URL by hand writes its parameters back to the editor,
  // so the two never disagree about what will be sent.
  function setUrl(url) {
    if (!isLegacy || !url.includes('?')) return patch({ url })
    patch({ url, body: paramsFromUrl(url) })
  }

  const paramsError = useMemo(() => {
    if (!isLegacy) return null
    try {
      parseParams(cur.body)
      return null
    } catch (e) {
      return e.message
    }
  }, [isLegacy, cur.body])

  // Persist each solution's data so it survives switching solutions, reloads,
  // and relaunching the app (IndexedDB = kept until explicitly cleared).
  // Debounced: this fires on every keystroke.
  const stateRef = useRef({ preset, sessions })
  // Assigned in an effect, not during render: renders can be discarded or
  // repeated, so they must stay free of side effects.
  useEffect(() => {
    stateRef.current = { preset, sessions }
  }, [preset, sessions])

  // Set when the store no longer fits, so it isn't a silent failure.
  const [storageFull, setStorageFull] = useState(false)
  const persist = useCallback(async () => {
    try {
      await save(stateRef.current)
      setStorageFull(false)
    } catch {
      // Out of quota (history holds full responses). Keep running, but say so.
      setStorageFull(true)
    }
  }, [save])

  useEffect(() => {
    const t = setTimeout(persist, 400)
    return () => clearTimeout(t)
  }, [preset, sessions, persist])

  // Flush immediately if the tab closes mid-debounce, so the last edits survive.
  useEffect(() => {
    window.addEventListener('pagehide', persist)
    return () => window.removeEventListener('pagehide', persist)
  }, [persist])

  // Legacy parameters may be pasted as a query string or URL; formatting turns
  // them into JSON like the rest.
  function formatBody() {
    let body
    try {
      body = JSON.stringify(isLegacy ? parseParams(cur.body) : JSON.parse(cur.body), null, 2)
    } catch (e) {
      patch({ error: `${isLegacy ? 'Parameters are' : 'Body is'} not valid: ${e.message}` })
      return
    }
    patch({ error: null })
    // Goes through the editor's onChange (setBody), which also rebuilds the
    // legacy URL.
    if (!replaceEditorText(bodyRef.current, body)) setBody(body)
  }

  const headersRef = useRef(null)
  function formatHeaders() {
    if (!cur.headers.trim()) return
    let headers
    try {
      headers = JSON.stringify(JSON.parse(cur.headers), null, 2)
    } catch (e) {
      patch({ error: `Headers are not valid JSON: ${e.message}` })
      return
    }
    patch({ error: null })
    if (!replaceEditorText(headersRef.current, headers)) patch({ headers })
  }

  // `over` replaces fields of the form for this send (paging sends the next
  // page's body before the state update has landed).
  async function send(over = {}) {
    const req = { ...cur, ...over }
    setLoading(true)
    patch({ error: null })
    let parsedHeaders = {}
    try {
      parsedHeaders = req.headers.trim() ? JSON.parse(req.headers) : {}
    } catch (e) {
      setLoading(false)
      patch({ error: `Headers are not valid JSON: ${e.message}` })
      return
    }
    const sentUrl = withLogTag(req.url, logTag.trim())
    // Snapshot the request now; the response (or transport error) is attached
    // once it returns. The whole thing becomes an immutable history entry.
    const ts = Date.now()
    const snapshot = {
      id: `${ts}-${Math.random().toString(36).slice(2, 7)}`,
      ts,
      method: req.method,
      url: req.url,
      sentUrl, // url plus apiLogTag, as actually fetched
      pagesKey: req.pagesKey,
      body: req.body,
      headers: req.headers,
      locked: false, // locked entries survive "clear all"
    }
    snapshot.summary = buildSummary(snapshot)
    let entry
    const started = performance.now()
    const controller = new AbortController()
    abortRef.current = controller
    const timeout = setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS)
    try {
      const init = { method: req.method, headers: { ...parsedHeaders }, signal: controller.signal }
      if (sendsBody(req.method, req.body)) {
        init.body = req.body
        if (!hasContentType(init.headers)) init.headers['Content-Type'] = 'application/json'
      }
      const r = await fetch(sentUrl, init)
      const text = await r.text()
      let json = null
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
      const data = {
        ok: r.ok,
        status: r.status,
        statusText: r.statusText,
        durationMs: Math.round(performance.now() - started),
        requestUrl: sentUrl,
        headers: Object.fromEntries(r.headers.entries()),
        json,
        text: json == null ? text : undefined,
      }
      entry = { ...snapshot, resp: data, error: null }
    } catch (e) {
      const aborted = controller.signal.aborted
      const reason =
        aborted && controller.signal.reason === 'timeout'
          ? `Timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
          : aborted
            ? 'Cancelled'
            : `${e.message || e} (network/CORS error)`
      entry = { ...snapshot, resp: null, error: reason }
    } finally {
      clearTimeout(timeout)
      abortRef.current = null
    }
    // Prepend to this solution's history and view the new entry.
    setSessions((s) => {
      const sess = s[preset]
      const history = [entry, ...(sess.history || [])].slice(0, MAX_HISTORY)
      return { ...s, [preset]: { ...sess, history, viewId: entry.id, error: null } }
    })
    setLoading(false)
    if (isMobile) setMobilePane('results')
  }

  // Ctrl+Enter (Cmd+Enter on macOS) sends from anywhere, editors included.
  const sendKeyRef = useRef(null)
  useEffect(() => {
    sendKeyRef.current = () => !loading && cur.url && send()
  })
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      e.preventDefault()
      sendKeyRef.current?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Load a past request back into the form and show its response.
  function viewEntry(id) {
    const e = (cur.history || []).find((h) => h.id === id)
    if (!e) return
    patch({
      viewId: id,
      method: e.method,
      url: e.url,
      pagesKey: e.pagesKey,
      // Legacy entries from before the parameters editor only have a URL.
      body: !e.body && isLegacy ? paramsFromUrl(e.url) : e.body,
      headers: e.headers,
      error: null,
    })
  }

  function toggleLock(id) {
    setSessions((s) => {
      const sess = s[preset]
      const history = (sess.history || []).map((h) =>
        h.id === id ? { ...h, locked: !h.locked } : h,
      )
      return { ...s, [preset]: { ...sess, history } }
    })
  }

  function deleteEntry(id) {
    setSessions((s) => {
      const sess = s[preset]
      const history = (sess.history || []).filter((h) => h.id !== id)
      const viewId = sess.viewId === id ? (history[0]?.id ?? null) : sess.viewId
      return { ...s, [preset]: { ...sess, history, viewId } }
    })
  }

  // Clear all history except locked entries.
  function clearHistory() {
    setSessions((s) => {
      const sess = s[preset]
      const history = (sess.history || []).filter((h) => h.locked)
      const viewId = history.some((h) => h.id === sess.viewId)
        ? sess.viewId
        : (history[0]?.id ?? null)
      return { ...s, [preset]: { ...sess, history, viewId, error: null } }
    })
  }

  // A short label of your own on an entry (e.g. "before boost change"), shown
  // in place of the summary. Empty removes it.
  function editNote(id) {
    const e = (cur.history || []).find((h) => h.id === id)
    if (!e) return
    const input = window.prompt('Note for this request (empty to remove):', e.note || '')
    if (input === null) return
    const note = input.trim() || undefined
    setSessions((s) => {
      const sess = s[preset]
      const history = (sess.history || []).map((h) => (h.id === id ? { ...h, note } : h))
      return { ...s, [preset]: { ...sess, history } }
    })
  }

  // Export / import every solution's history as a JSON file. Saved history is
  // per site address (the hosted app, :5173 and :8787 each have their own), so
  // this is how it moves between them, or gets backed up.
  const importRef = useRef(null)
  const [histMsg, setHistMsg] = useState(null)
  useEffect(() => {
    if (!histMsg) return
    const t = setTimeout(() => setHistMsg(null), 5000)
    return () => clearTimeout(t)
  }, [histMsg])

  function exportHistory() {
    const data = {
      app: 'hr-api-tester',
      version: 1,
      exportedAt: new Date().toISOString(),
      history: Object.fromEntries(Object.entries(sessions).map(([k, s]) => [k, s.history || []])),
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
    a.download = `hr-api-tester-history-${data.exportedAt.slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  // Merges by entry id: entries already here are skipped, so importing the
  // same file twice is harmless. Each solution still keeps its newest
  // MAX_HISTORY.
  async function importHistory(file) {
    let data
    try {
      data = JSON.parse(await file.text())
    } catch {
      setHistMsg({ bad: true, text: `${file.name} is not valid JSON.` })
      return
    }
    if (data?.app !== 'hr-api-tester' || !data.history || typeof data.history !== 'object') {
      setHistMsg({ bad: true, text: `${file.name} is not an API Tester history export.` })
      return
    }
    const next = { ...sessions }
    let added = 0
    for (const [key, entries] of Object.entries(data.history)) {
      if (!next[key] || !Array.isArray(entries)) continue
      const have = new Set((next[key].history || []).map((h) => h.id))
      const fresh = entries.filter((e) => e?.id && e.ts && !have.has(e.id))
      if (!fresh.length) continue
      added += fresh.length
      const history = [...(next[key].history || []), ...fresh]
        .sort((a, b) => b.ts - a.ts)
        .slice(0, MAX_HISTORY)
      next[key] = { ...next[key], history }
    }
    setSessions(next)
    setHistMsg({ text: added ? `Imported ${added} entr${added === 1 ? 'y' : 'ies'}.` : 'Nothing new to import.' })
  }

  const history = cur.history || []
  const viewed = history.find((h) => h.id === cur.viewId) || history[0] || null

  // Search over the history list: note, summary, URL, body and status.
  const [histQuery, setHistQuery] = useState('')
  const shownHistory = useMemo(() => {
    const q = histQuery.trim().toLowerCase()
    if (!q) return history
    return history.filter((h) =>
      [h.note, entrySummary(h), h.url, h.body, h.resp?.status].some(
        (v) => v != null && String(v).toLowerCase().includes(q),
      ),
    )
  }, [history, histQuery])

  // Arrow keys step through history while a row has focus; focus follows.
  function onHistKey(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const list = shownHistory
    const i = list.findIndex((h) => h.id === viewed?.id)
    const j = Math.min(list.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))
    const next = list[j]
    if (!next) return
    if (next.id !== viewed?.id) viewEntry(next.id)
    e.currentTarget.querySelector(`[data-id="${next.id}"]`)?.focus()
  }
  const resp = viewed?.resp || null
  const apiError = useMemo(() => responseError(resp), [resp])

  const payload = resp?.json
  // Products come back as one or more "boxes" (recoms can request several at
  // once — each responses[] entry is its own box with its own step waterfall).
  const { boxes, usedPath } = useMemo(
    () => extractResult(payload, cur.productsPath, cur.fieldMap),
    [payload, cur.productsPath, cur.fieldMap],
  )
  // Search / Pages: which slice of the full result set this response is.
  const paging = useMemo(() => pageInfo(payload), [payload])
  const allTiles = useMemo(() => boxes.flatMap((b) => b.tiles), [boxes])
  const anySteps = useMemo(() => boxes.some((b) => b.steps.length > 0), [boxes])
  const stepColors = useMemo(() => stepColorMap(boxes), [boxes])

  // Previous / next page: rewrite the request's offset and send it.
  const canPage = useMemo(
    () => pageRequest(preset, cur.body, paging, 1) != null,
    [preset, cur.body, paging],
  )
  function goPage(dir) {
    const body = pageRequest(preset, cur.body, paging, dir)
    if (body == null || loading) return
    const url = isLegacy ? (resolveUrl(preset, cur.pagesKey, BASES, body) ?? cur.url) : cur.url
    patch({ body, url })
    send({ body, url })
  }

  // Extra product fields shown on every tile (dot paths allowed).
  const extraFields = useMemo(
    () =>
      (cur.tileFields || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [cur.tileFields],
  )

  // Only walked when the Tile mapping panel is actually open.
  const [mappingOpen, setMappingOpen] = useState(false)
  const arrayPaths = useMemo(
    () => (mappingOpen && payload ? findArrayPaths(payload) : []),
    [mappingOpen, payload],
  )

  // Group products by their countAfterSource waterfall step (Recommendations).
  const [groupBySource, setGroupBySource] = useState(true)

  // Real-time results filter. Empty field = match any value in any field.
  const [filterText, setFilterText] = useState('')
  const [filterField, setFilterField] = useState('')

  // Field names present on the current products, for the field selector.
  const filterFields = useMemo(() => {
    const set = new Set()
    for (const t of allTiles) {
      if (t.raw && typeof t.raw === 'object') {
        for (const k of Object.keys(t.raw)) set.add(k)
      }
    }
    return Array.from(set)
  }, [allTiles])

  // Filter each box's tiles independently, keeping box structure.
  const filteredBoxes = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    if (!q) return boxes
    const match = (t) =>
      filterField ? valueMatches(t.raw?.[filterField], q) : t.search.includes(q)
    return boxes.map((b) => ({ ...b, tiles: b.tiles.filter(match) }))
  }, [boxes, filterText, filterField])

  const totalTiles = allTiles.length
  const shownTiles = filteredBoxes.reduce((n, b) => n + b.tiles.length, 0)
  // Retail media banners share the result array with products (Pages), so
  // call them out separately — the split is the point when testing placement.
  const bannerCount = useMemo(() => allTiles.filter((t) => t.isBanner).length, [allTiles])
  const sponsoredCount = useMemo(
    () => allTiles.filter((t) => !t.isBanner && t.campaignId).length,
    [allTiles],
  )

  return (
    <div className="app">
      {matrix && <MatrixRain />}
      <header className="topbar">
        <h1>Hello Retail · API Tester</h1>
        <span className="hint">calls core.helloretail.com directly</span>
        <div className="topbar-actions">
          <button
            className={matrix ? 'chip sm active' : 'chip sm'}
            onClick={() => setMatrix((m) => !m)}
            title={matrix ? 'Leave the Matrix' : 'Enter the Matrix'}
          >
            {matrix ? '◉ Matrix' : '○ Matrix'}
          </button>
          {/* Hidden while Matrix mode overrides the theme anyway. */}
          {!matrix && <ThemeToggle />}
        </div>
      </header>

      {isMobile && (
        <div className="mobiletabs">
          {[
            ['request', 'Request'],
            ['results', 'Results'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={mobilePane === key ? 'chip active' : 'chip'}
              onClick={() => setMobilePane(key)}
            >
              {label}
              {key === 'results' && resp ? ` · ${totalTiles}` : ''}
            </button>
          ))}
        </div>
      )}

      <div className="layout">
        {/* ---- Request panel ---- */}
        <section
          className="panel request"
          hidden={isMobile && mobilePane !== 'request'}
          // Mobile panes are full width; the draggable width is desktop-only.
          style={isMobile ? undefined : { width: leftWidth, flex: '0 0 auto' }}
        >
          {storageFull && (
            <div className="error">
              Out of browser storage — history is no longer being saved. Remove some
              history entries (or “clear all”) to free space.
            </div>
          )}

          <div className="row tabs">
            {Object.entries(PRESETS).map(([key, p]) => (
              <button
                key={key}
                className={preset === key ? 'chip active' : 'chip'}
                onClick={() => setPreset(key)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="row">
            <select value={cur.method} onChange={(e) => patch({ method: e.target.value })} className="method">
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              className="url"
              value={cur.url}
              placeholder="https://api.helloretail.com/..."
              onChange={(e) => setUrl(e.target.value)}
            />
            {loading ? (
              <button className="send cancel" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            ) : (
              <button
                className="send"
                onClick={() => send()}
                disabled={!cur.url}
                title="Send (Ctrl+Enter)"
              >
                Send
              </button>
            )}
          </div>

          <div className="row logtag">
            <label
              className="lbl"
              htmlFor="logtag"
              title="Added as ?apiLogTag=… to requests to core.helloretail.com. Find them in the API log with “only tagged” (logging must be on for the website). Doesn't change the response."
            >
              API log tag
            </label>
            <input
              id="logtag"
              className="url"
              value={logTag}
              placeholder="optional, e.g. pl-test"
              onChange={(e) => setLogTag(e.target.value)}
            />
          </div>

          {PRESETS[preset]?.needsKey && (
            <>
              <label className="lbl">Page key (appended to the Pages endpoint)</label>
              <input
                className="url"
                value={cur.pagesKey}
                placeholder="Pages key here"
                onChange={(e) => patch({ pagesKey: e.target.value })}
              />
            </>
          )}

          <div className="edhead">
            <label className="lbl">
              {isLegacy ? 'Parameters (JSON from the API log, or a query string)' : 'Body (JSON)'}
            </label>
            <FormatButton onClick={formatBody} />
          </div>
          {isLegacy && (
            <div className={paramsError ? 'hint bad' : 'hint'}>
              {paramsError
                ? `Can't read parameters (${paramsError}) — URL not updated.`
                : 'Added to the URL as you type (format=json is added automatically).'}
            </div>
          )}
          <textarea
            ref={bodyRef}
            className="code"
            value={cur.body}
            spellCheck={false}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => isFormatShortcut(e) && (e.preventDefault(), formatBody())}
            style={{ height: bodyHeight }}
            onMouseUp={(e) => {
              // Keep the dragged height; drop any dragged width so the editor
              // goes back to filling the column (which grew to match it).
              const el = e.currentTarget
              el.style.width = ''
              if (el.offsetHeight !== bodyHeight) setBodyHeight(el.offsetHeight)
            }}
          />

          <details>
            <summary>Headers</summary>
            <div className="edhead">
              <label className="lbl">Headers (JSON)</label>
              <FormatButton onClick={formatHeaders} />
            </div>
            <textarea
              ref={headersRef}
              className="code"
              value={cur.headers}
              spellCheck={false}
              onChange={(e) => patch({ headers: e.target.value })}
              onKeyDown={(e) => isFormatShortcut(e) && (e.preventDefault(), formatHeaders())}
              rows={4}
            />
          </details>

          <details onToggle={(e) => setMappingOpen(e.currentTarget.open)}>
            <summary>Tile mapping</summary>
            <label className="lbl">Products array path (blank = auto-detect)</label>
            <input
              className="url"
              value={cur.productsPath}
              placeholder="e.g. response.products"
              onChange={(e) => patch({ productsPath: e.target.value })}
            />
            {arrayPaths.length > 0 && (
              <div className="paths">
                {arrayPaths.slice(0, 6).map((p) => (
                  <button key={p.path} className="chip sm" onClick={() => patch({ productsPath: p.path })}>
                    {p.path || '(root)'} · {p.length}
                  </button>
                ))}
              </div>
            )}
            {Object.keys(DEFAULT_FIELD_MAP).map((f) => (
              <div className="row" key={f}>
                <span className="fname">{f}</span>
                <input
                  className="url"
                  value={cur.fieldMap[f] || ''}
                  onChange={(e) => patch({ fieldMap: { ...cur.fieldMap, [f]: e.target.value } })}
                />
              </div>
            ))}
            <label className="lbl">Extra fields on tiles (comma-separated, dot paths ok)</label>
            <input
              className="url"
              value={cur.tileFields || ''}
              placeholder="e.g. inStock, brand, extraData.color"
              onChange={(e) => patch({ tileFields: e.target.value })}
            />
          </details>

          <div className="hist">
            <div className="hist-head">
              <span className="lbl">
                History · {histQuery.trim() ? `${shownHistory.length} / ` : ''}
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
                onClick={exportHistory}
                title="Download every solution's history as JSON (includes request bodies — keys and all)"
              >
                export
              </button>
              {history.length > 0 && (
                <button className="link" onClick={clearHistory}>clear all</button>
              )}
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = '' // so the same file can be picked again
                  if (f) importHistory(f)
                }}
              />
            </div>
            {histMsg && <div className={histMsg.bad ? 'hint bad' : 'hint'}>{histMsg.text}</div>}
            {history.length > 0 && (
              <input
                className="url hist-search"
                placeholder="Search history… (note, query, URL, body, status)"
                value={histQuery}
                onChange={(e) => setHistQuery(e.target.value)}
              />
            )}
            {history.length > 0 && shownHistory.length === 0 && (
              <div className="hint">No history matches “{histQuery}”.</div>
            )}
            <ul className="hist-list" onKeyDown={onHistKey}>
              {shownHistory.map((h) => (
                <li key={h.id} className={viewed?.id === h.id ? 'hist-row active' : 'hist-row'}>
                  <button
                    className="hist-main"
                    data-id={h.id}
                    onClick={() => viewEntry(h.id)}
                    title={`${h.method} ${h.sentUrl || h.url}${h.note ? `\n${entrySummary(h)}` : ''}\n↑/↓ to step through history`}
                  >
                    <span
                      className={h.resp?.ok && !responseError(h.resp) ? 'sdot ok' : 'sdot bad'}
                    />
                    <span className="hist-status">{h.resp?.status ?? 'ERR'}</span>
                    <span className={h.note ? 'hist-sum note' : 'hist-sum'}>
                      {h.note || entrySummary(h)}
                    </span>
                    <span className="hist-time">{new Date(h.ts).toLocaleTimeString()}</span>
                  </button>
                  <button
                    className="hist-act"
                    onClick={() => editNote(h.id)}
                    title={h.note ? `Note: ${h.note} — edit` : 'Add a note'}
                  >
                    ✎
                  </button>
                  <button
                    className={h.locked ? 'hist-act on' : 'hist-act'}
                    onClick={() => toggleLock(h.id)}
                    title={h.locked ? 'Locked — unlock' : 'Lock (keep on “clear all”)'}
                  >
                    {h.locked ? '🔒' : '🔓'}
                  </button>
                  <button
                    className="hist-act"
                    onClick={() => deleteEntry(h.id)}
                    title="Remove this entry"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---- Drag handle to resize the config column ---- */}
        <div className="gutter" onMouseDown={startResize} title="Drag to resize" />

        {/* ---- Results panel ---- */}
        <section className="panel results" hidden={isMobile && mobilePane !== 'results'}>
          <div className="row statusbar">
            {resp && (
              <>
                <span className={resp.ok && !apiError ? 'badge ok' : 'badge bad'}>
                  {`${resp.status} ${resp.statusText}`.trim()}
                  {resp.ok && apiError ? ' · error in body' : ''}
                </span>
                <span className="hint">{resp.durationMs} ms</span>
                {usedPath !== undefined && payload && !apiError && (
                  <span className="hint">
                    {filterText.trim() ? `${shownTiles} / ${totalTiles}` : totalTiles} tiles
                    {bannerCount ? ` · ${bannerCount} banner${bannerCount > 1 ? 's' : ''}` : ''}
                    {sponsoredCount ? ` · ${sponsoredCount} sponsored` : ''}
                    {boxes.length > 1 ? ` · ${boxes.length} boxes` : ''}
                    {usedPath ? ` from "${usedPath}"` : ''}
                  </span>
                )}
              </>
            )}
            <div className="spacer" />
            {TABS.map((t) => (
              <button
                key={t}
                className={tab === t ? 'chip active' : 'chip'}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="results-body">
          {cur.error && <div className="error">{cur.error}</div>}

          {/* Failed requests: the error replaces the products, so it can be
              read without switching to the json tab. */}
          {viewed?.error && <ErrorCard title="Request failed" message={viewed.error} />}
          {tab === 'tiles' && apiError && (
            <ErrorCard
              title={`Request failed · HTTP ${resp.status}`}
              code={apiError.code}
              message={apiError.message}
              detail={apiError.detail}
            />
          )}

          {!resp && !viewed?.error && !cur.error && (
            <div className="empty">Send a request to see results.</div>
          )}

          {tab === 'tiles' && resp && !apiError && (
            <>
              {paging && (
                <PageInfo
                  {...paging}
                  onPage={canPage ? goPage : null}
                  busy={loading}
                />
              )}
              {totalTiles > 0 && (
                <div className="row filterbar">
                  <input
                    className="url"
                    placeholder="Filter products… e.g. Zion"
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                  />
                  <select
                    className="method"
                    value={filterField}
                    onChange={(e) => setFilterField(e.target.value)}
                    title="Field to filter on"
                  >
                    <option value="">Any field</option>
                    {filterFields.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                  {filterText && (
                    <button className="link" onClick={() => setFilterText('')}>clear</button>
                  )}
                  {anySteps && (
                    <label className="grouptoggle" title="Group products by countAfterSource step">
                      <input
                        type="checkbox"
                        checked={groupBySource}
                        onChange={(e) => setGroupBySource(e.target.checked)}
                      />
                      group by step
                    </label>
                  )}
                </div>
              )}

              {totalTiles === 0 && (
                <div className="empty">
                  No products found. Open “Tile mapping” to set the array path / fields.
                </div>
              )}
              {totalTiles > 0 && shownTiles === 0 && (
                <div className="empty">
                  No products match “{filterText}”{filterField ? ` in ${filterField}` : ''}.
                </div>
              )}

              {filteredBoxes.map((box, bi) =>
                box.tiles.length === 0 ? null : box.key ? (
                  // Multiple recommendation boxes: label each one.
                  <div className="box" key={box.key}>
                    <div className="boxhead">
                      Box: {box.key} · {box.tiles.length}
                    </div>
                    <TileGroups
                      tiles={box.tiles}
                      steps={box.steps}
                      grouped={groupBySource}
                      colors={stepColors}
                      extra={extraFields}
                    />
                  </div>
                ) : (
                  <TileGroups
                    key={bi}
                    tiles={box.tiles}
                    steps={box.steps}
                    grouped={groupBySource}
                    colors={stepColors}
                    extra={extraFields}
                  />
                ),
              )}
            </>
          )}

          {/* The copy button sits on the view it copies. */}
          {tab === 'json' && resp && (
            <div className="codewrap">
              <pre className="code view">{JSON.stringify(resp.json ?? resp.text, null, 2)}</pre>
              <CopyButton
                className="copyfloat"
                icon
                label="copy JSON"
                title="Copy the full JSON response"
                text={() =>
                  resp.json != null ? JSON.stringify(resp.json, null, 2) : (resp.text ?? '')
                }
              />
            </div>
          )}

          {tab === 'headers' && resp && (
            <div className="codewrap">
              <pre className="code view">{JSON.stringify(resp.headers, null, 2)}</pre>
              <CopyButton
                className="copyfloat"
                icon
                label="copy headers"
                title="Copy the response headers"
                text={() => JSON.stringify(resp.headers ?? {}, null, 2)}
              />
            </div>
          )}
          </div>
        </section>
      </div>
    </div>
  )
}

// Thousands grouped with a narrow no-break space (1 240), so the separator
// reads as whitespace but never wraps mid-number.
const groupDigits = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

// "Showing 51–60 of 206 results" for a Search / Pages response; `start` is the
// 0-based offset, so the first product shown is start + 1. Nothing when the
// response has no products (the "No products found" notice covers that).
// `onPage(dir)` sends the previous/next page; null when the request can't be
// paged (no offset in its body).
function PageInfo({ start, shown, total, onPage, busy }) {
  if (shown === 0) return null
  const first = start + 1
  const last = start + shown
  return (
    <div className="pageinfo">
      <span>
        Showing <b>{groupDigits(first)}{last > first ? `–${groupDigits(last)}` : ''}</b> of{' '}
        <b>{groupDigits(total)}</b> result{total === 1 ? '' : 's'}
      </span>
      {onPage && (
        <span className="pager">
          <button className="chip sm" disabled={busy || start <= 0} onClick={() => onPage(-1)}>
            ‹ prev
          </button>
          <button className="chip sm" disabled={busy || last >= total} onClick={() => onPage(1)}>
            next ›
          </button>
        </span>
      )}
    </div>
  )
}

// Assign palette colors by step identity across the whole response, so the same
// step keeps its color in every box. (Colouring per box by position meant e.g.
// ALTERNATIVES was green in one box and blue in another.)
function stepColorMap(boxes) {
  const map = {}
  let n = 0
  for (const b of boxes) {
    for (const s of b.steps) {
      const key = stepKey(s)
      if (!(key in map)) map[key] = STEP_COLORS[n++ % STEP_COLORS.length]
    }
  }
  return map
}

const stepKey = (s) => `${s.index}|${s.source}`

// Render a box's tiles: grouped by countAfterSource step (bordered/colored) when
// step data exists and grouping is on, otherwise a plain grid.
function TileGroups({ tiles, steps, grouped, colors, extra }) {
  if (grouped && steps.length > 0) {
    return (
      <div className="stepgroups">
        {groupTilesByStep(tiles).map((g, gi) => {
          const color = g.source ? colors[stepKey(g.source)] : 'var(--border)'
          return (
            <div key={`${g.key}-${gi}`} className="stepgroup" style={{ borderColor: color }}>
              <div className="stephead" style={{ background: color }}>
                {(() => {
                  const banners = g.tiles.filter((t) => t.isBanner).length
                  const products = g.tiles.length - banners
                  // Banners aren't part of countAfterSource, so keep them out
                  // of the step's product count rather than inflating it.
                  const extra = banners ? ` +${banners} banner${banners > 1 ? 's' : ''}` : ''
                  return g.source
                    ? `Step ${g.source.index}: ${g.source.source} · ${g.source.ms}ms · ${products}${extra}`
                    : `Unattributed · ${products}${extra}`
                })()}
              </div>
              <div className="stepbody">
                {g.tiles.map((t, i) => (
                  <Tile key={t.id ?? `${gi}-${i}`} t={t} extra={extra} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <div className="grid">
      {tiles.map((t, i) => (
        <Tile key={t.id ?? i} t={t} extra={extra} />
      ))}
    </div>
  )
}

// Clipboard write. navigator.clipboard needs a secure context (https or
// localhost, both of which we have), but fall back to the old selection trick
// rather than failing outright.
function FormatButton({ onClick }) {
  return (
    <button className="chip sm fmt" onClick={onClick} title="Format JSON (Shift+Alt+F in the editor)">
      Format <kbd>Shift+Alt+F</kbd>
    </button>
  )
}

// Shift+Alt+F, as in VS Code. Matched on the physical key so it also works on
// macOS, where Option+F types a character instead of "f".
function isFormatShortcut(e) {
  return e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyF'
}

// Replace a textarea's whole text as if typed, so Ctrl+Z undoes the format and
// React's onChange fires as usual. Returns false where execCommand is
// unsupported; the caller then sets the state directly (no undo step).
function replaceEditorText(el, text) {
  if (!el || el.value === text) return Boolean(el)
  const { scrollTop } = el
  el.focus()
  el.select()
  const ok = document.execCommand('insertText', false, text)
  if (ok) {
    el.setSelectionRange(0, 0)
    el.scrollTop = Math.min(scrollTop, el.scrollHeight)
  }
  return ok
}

function writeClipboard(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    ok ? resolve() : reject(new Error('copy rejected'))
  })
}

function ErrorCard({ title, code, message, detail }) {
  return (
    <div className="errcard">
      <div className="errcard-head">
        <span className="errcard-title">{title}</span>
        {code && <span className="errcard-code">{code}</span>}
        <div className="spacer" />
        {detail && <CopyButton label="copy error" title="Copy the error response" text={detail} />}
      </div>
      <div className="errcard-msg">{message || 'No error message in the response.'}</div>
      {detail && <pre className="code view sm">{detail}</pre>}
    </div>
  )
}

// Theme choice: 'auto' follows the OS (dark when it states no preference),
// 'light' / 'dark' pin it. index.html applies it before first paint; this keeps
// <html data-theme> in sync afterwards, including OS changes while on auto.
const THEME_KEY = 'hr-api-tester:theme'
const THEME_NEXT = { auto: 'light', light: 'dark', dark: 'auto' }
const THEME_LABEL = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' }

function ThemeToggle() {
  const [mode, setMode] = useState(() => {
    try {
      const t = localStorage.getItem(THEME_KEY)
      return t === 'light' || t === 'dark' ? t : 'auto'
    } catch {
      return 'auto'
    }
  })
  useEffect(() => {
    try {
      if (mode === 'auto') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, mode)
    } catch {}
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const theme = mode === 'auto' ? (mq.matches ? 'light' : 'dark') : mode
      document.documentElement.dataset.theme = theme
    }
    apply()
    if (mode !== 'auto') return
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [mode])
  return (
    <button
      className="chip sm theme"
      onClick={() => setMode(THEME_NEXT[mode])}
      title={`Theme: ${mode}${mode === 'auto' ? ' (follows system)' : ''}. Click to switch.`}
    >
      {THEME_LABEL[mode]}
    </button>
  )
}

// The falling-code background of Matrix mode: columns of half-width katakana
// and digits dropping down a full-screen canvas, each frame drawn over a
// translucent black so older glyphs fade into trails. Throttled to ~20 fps,
// paused while the tab is hidden, and a single still frame when the system
// asks for reduced motion.
const RAIN_GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:.=*+-<>¦'
const RAIN_SIZE = 16 // px per glyph cell
const RAIN_FPS = 20

function MatrixRain() {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let drops = []
    let frame = 0
    let last = 0

    function resize() {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)
      const rows = Math.ceil(window.innerHeight / RAIN_SIZE)
      // Start each column at a random height so the rain doesn't begin as
      // one flat line.
      drops = Array.from({ length: Math.ceil(window.innerWidth / RAIN_SIZE) }, () =>
        Math.floor(Math.random() * -rows),
      )
      if (still) for (let i = 0; i < 40; i++) draw()
    }

    function draw() {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)'
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)
      ctx.font = `${RAIN_SIZE}px ui-monospace, monospace`
      const rows = window.innerHeight / RAIN_SIZE
      drops.forEach((y, i) => {
        const ch = RAIN_GLYPHS[Math.floor(Math.random() * RAIN_GLYPHS.length)]
        // The leading glyph is near-white; the trail behind it is green.
        ctx.fillStyle = Math.random() < 0.1 ? '#d6ffe0' : '#00ff41'
        ctx.fillText(ch, i * RAIN_SIZE, y * RAIN_SIZE)
        drops[i] = y > rows && Math.random() > 0.975 ? 0 : y + 1
      })
    }

    function loop(t) {
      frame = requestAnimationFrame(loop)
      if (document.hidden || t - last < 1000 / RAIN_FPS) return
      last = t
      draw()
    }

    resize()
    window.addEventListener('resize', resize)
    if (!still) frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={ref} className="matrix-rain" aria-hidden="true" />
}

// `text` is a function so a large response is only serialized on click, not on
// every render. `icon` adds a clipboard (✓ once copied) before the label.
function CopyButton({ text, className = 'chip', label = 'copy', title = 'Copy to clipboard', icon }) {
  const [state, setState] = useState('idle') // idle | ok | err
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy() {
    try {
      await writeClipboard(typeof text === 'function' ? text() : String(text ?? ''))
      setState('ok')
    } catch {
      setState('err')
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1400)
  }
  return (
    <button className={className} onClick={copy} title={title} data-state={state}>
      {icon && (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          {state === 'ok' ? (
            <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <g fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
              <path d="M10.5 5.5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
            </g>
          )}
        </svg>
      )}
      {state === 'ok' ? 'copied' : state === 'err' ? 'failed' : label}
    </button>
  )
}

// Memoized: any App state change (typing, filtering, resizing) re-renders the
// whole tree, and a response can hold hundreds of tiles. Tile props are stable
// object refs, so this skips nearly all of that reconciliation.
const Tile = memo(function Tile({ t, extra }) {
  const [open, setOpen] = useState(false)
  // `fields` often omits title (and banners have none), so fall back to the
  // banner's alt text, then the product number, before giving up.
  const label =
    t.title ||
    t.banner?.altText ||
    (t.isBanner ? 'Retail media banner' : t.id ? String(t.id) : '(untitled)')
  return (
    <div className={t.isBanner ? 'tile banner' : t.campaignId ? 'tile sponsored' : 'tile'}>
      <div className="thumb">
        {/* Position in the response, so filtered views still show the original
            ordering (e.g. #1, #5, #18, #72). */}
        {t.pos != null && (
          <span className="pos" title={`Position #${t.pos} in the response`}>#{t.pos}</span>
        )}
        {t.isBanner ? (
          <span className="btag" title={`Retail media campaign ${t.campaignId || '(unknown)'}`}>
            banner
          </span>
        ) : t.campaignId ? (
          <span className="stag" title={`Retail media campaign ${t.campaignId}`}>sponsored</span>
        ) : null}
        {t.image ? (
          <img src={t.image} alt={t.banner?.altText || t.title || ''} loading="lazy" />
        ) : (
          <div className="noimg">{t.isBanner ? 'no banner image' : 'no image'}</div>
        )}
      </div>
      <div className="meta">
        <div className="title" title={label}>{label}</div>
        {t.isBanner ? (
          <div className="bmeta">
            {t.banner
              ? `${t.banner.placement} · ${t.banner.width}×${t.banner.height}`
              : 'no artwork'}
            {t.campaignId ? ` · ${t.campaignId}` : ''}
          </div>
        ) : (
          <div className="prices">
            {t.price != null && <span className="price">{String(t.price)}</span>}
            {t.oldPrice != null && <span className="old">{String(t.oldPrice)}</span>}
          </div>
        )}
        {!t.isBanner && extra?.length > 0 && (
          <div className="xfields">
            {extra.map((f) => {
              const v = fieldText(getPath(t.raw, f))
              return (
                <div className="xf" key={f} title={`${f}: ${v}`}>
                  <span className="xk">{f}</span>
                  <span className="xv">{v}</span>
                </div>
              )
            })}
          </div>
        )}
        <div className="row">
          {t.url && (
            <a className="link" href={t.url} target="_blank" rel="noreferrer">open</a>
          )}
          <button className="link" onClick={() => setOpen((v) => !v)}>
            {open ? 'hide' : 'raw'}
          </button>
          {open && (
            <CopyButton
              className="link"
              label="copy"
              title="Copy this item's JSON"
              text={() => JSON.stringify(t.raw, null, 2)}
            />
          )}
        </div>
        {open && <pre className="code view sm">{JSON.stringify(t.raw, null, 2)}</pre>}
      </div>
    </div>
  )
})
