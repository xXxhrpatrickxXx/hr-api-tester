import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { boot } from './lib/boot.js'
import { stepColorMap, valueMatches } from './lib/display.js'
import { isFormatShortcut, replaceEditorText } from './lib/dom.js'
import { buildExport, buildSummary, mergeImport } from './lib/history.js'
import { paramsFromUrl, parseParams } from './lib/legacy.js'
import { BASES, MAX_HISTORY, PRESETS, resolveUrl } from './lib/presets.js'
import { DEFAULT_FIELD_MAP, extractResult, findArrayPaths, pageInfo } from './lib/products.js'
import { hasContentType, pageRequest, responseError, sendsBody, withLogTag } from './lib/request.js'
import { CopyButton } from './components/CopyButton.jsx'
import { ErrorCard } from './components/ErrorCard.jsx'
import { FormatButton } from './components/FormatButton.jsx'
import { HistoryPanel } from './components/HistoryPanel.jsx'
import { MatrixRain } from './components/MatrixRain.jsx'
import { PageInfo } from './components/PageInfo.jsx'
import { ThemeToggle } from './components/ThemeToggle.jsx'
import { TileGroups } from './components/Tiles.jsx'

const REQUEST_TIMEOUT_MS = 30000
const LOG_TAG_KEY = 'hr-api-tester:logTag'
const MATRIX_KEY = 'hr-api-tester:matrix'
const TABS = ['tiles', 'json', 'headers'] // results views

// Config-column sizing. PANEL_PAD is .panel's horizontal padding (14px each
// side), so panelWidth = editorWidth + PANEL_PAD keeps the editor un-clipped.
const PANEL_PAD = 28
// Below this the two columns don't fit, so panes are tabbed instead.
const MOBILE_QUERY = '(max-width: 820px)'
const MIN_LEFT = 280
const maxLeft = () => Math.min(1400, window.innerWidth - 320)

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

  // Apply `fn(session)` (returning the changed fields) to the active
  // solution's session.
  function updateSession(fn) {
    setSessions((s) => ({ ...s, [preset]: { ...s[preset], ...fn(s[preset]) } }))
  }
  // Entries are immutable: an edit replaces the entry object (store.js relies
  // on that to save only what changed).
  const mapEntry = (id, fn) => (sess) => ({
    history: (sess.history || []).map((h) => (h.id === id ? fn(h) : h)),
  })

  const toggleLock = (id) => updateSession(mapEntry(id, (h) => ({ ...h, locked: !h.locked })))
  const setNote = (id, note) => updateSession(mapEntry(id, (h) => ({ ...h, note })))

  function deleteEntry(id) {
    updateSession((sess) => {
      const history = (sess.history || []).filter((h) => h.id !== id)
      const viewId = sess.viewId === id ? (history[0]?.id ?? null) : sess.viewId
      return { history, viewId }
    })
  }

  // Clear all history except locked entries.
  function clearHistory() {
    updateSession((sess) => {
      const history = (sess.history || []).filter((h) => h.locked)
      const viewId = history.some((h) => h.id === sess.viewId)
        ? sess.viewId
        : (history[0]?.id ?? null)
      return { history, viewId, error: null }
    })
  }

  function exportHistory() {
    const data = buildExport(sessions)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
    a.download = `hr-api-tester-history-${data.exportedAt.slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  // Resolves to the message HistoryPanel shows.
  async function importHistory(file) {
    let data
    try {
      data = JSON.parse(await file.text())
    } catch {
      return { bad: true, text: `${file.name} is not valid JSON.` }
    }
    try {
      const { sessions: next, added } = mergeImport(sessions, data, MAX_HISTORY)
      setSessions(next)
      return { text: added ? `Imported ${added} entr${added === 1 ? 'y' : 'ies'}.` : 'Nothing new to import.' }
    } catch {
      return { bad: true, text: `${file.name} is not an API Tester history export.` }
    }
  }

  const history = cur.history || []
  const viewed = history.find((h) => h.id === cur.viewId) || history[0] || null

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
  // Search: how much AI synonym expansion contributed (suggestedProductStatus:
  // NO_SUGGESTED / MIXED / ONLY_SUGGESTED) and how many products it alone found.
  const aiStatus = payload?.products?.suggestedProductStatus
  const aiCount = useMemo(() => allTiles.filter((t) => t.suggested).length, [allTiles])

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

          <HistoryPanel
            history={history}
            viewedId={viewed?.id}
            onView={viewEntry}
            onNote={setNote}
            onToggleLock={toggleLock}
            onDelete={deleteEntry}
            onClear={clearHistory}
            onExport={exportHistory}
            onImport={importHistory}
          />
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
                    {aiCount ? ` · ${aiCount} AI match${aiCount === 1 ? '' : 'es'}` : ''}
                    {boxes.length > 1 ? ` · ${boxes.length} boxes` : ''}
                    {usedPath ? ` from "${usedPath}"` : ''}
                  </span>
                )}
                {aiStatus === 'ONLY_SUGGESTED' && !apiError && (
                  <span
                    className="badge ai"
                    title="suggestedProductStatus: ONLY_SUGGESTED — nothing matched the query directly; every product came from AI synonym expansion"
                  >
                    only AI matches
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
