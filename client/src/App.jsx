import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { boot } from './lib/boot.js'
import { RESULT_TABS } from './lib/display.js'
import { isFormatShortcut, replaceEditorText } from './lib/dom.js'
import { buildExport, mergeImport } from './lib/history.js'
import { paramsFromUrl, parseParams } from './lib/legacy.js'
import { BASES, MAX_HISTORY, PRESETS, resolveUrl, withResolvedUrls } from './lib/presets.js'
import { pageRequest } from './lib/request.js'
import { parseHeaders, snapshotRequest } from './lib/send.js'
import { storedNumber } from './lib/storage.js'
import { useColumnResize } from './hooks/useColumnResize.js'
import { useMediaQuery } from './hooks/useMediaQuery.js'
import { useRequests } from './hooks/useRequests.js'
import { useResult } from './hooks/useResult.js'
import { useStoredState } from './hooks/useStoredState.js'
import { FormatButton } from './components/FormatButton.jsx'
import { HistoryPanel } from './components/HistoryPanel.jsx'
import { MatrixRain } from './components/MatrixRain.jsx'
import { ResultsPanel } from './components/ResultsPanel.jsx'
import { ThemeToggle } from './components/ThemeToggle.jsx'
import { TileMapping } from './components/TileMapping.jsx'

const LOG_TAG_KEY = 'hr-api-tester:logTag'
const MATRIX_KEY = 'hr-api-tester:matrix'
const BODY_HEIGHT_KEY = 'hr-api-tester:bodyHeight'
// Below this the two columns don't fit, so panes are tabbed instead.
const MOBILE_QUERY = '(max-width: 820px)'

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
  const [sessions, setSessions] = useState(() => withResolvedUrls(initial.sessions))
  const cur = sessions[preset]
  const isLegacy = !!PRESETS[preset]?.legacy

  // Each solution remembers its own results view, so sending or stepping
  // through history stays on JSON (say) instead of jumping back to tiles.
  const tab = RESULT_TABS.includes(cur.tab) ? cur.tab : 'tiles'

  // On narrow screens the side-by-side columns don't fit, so the request and
  // results panes become tabs and only one is shown at a time.
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [mobilePane, setMobilePane] = useState('request')

  // The body editor: its height is set by dragging its resize handle and
  // persisted. Its *width* is not stored: the editor always fills the config
  // column, and dragging it wider widens the column (useColumnResize).
  const bodyRef = useRef(null)
  const headersRef = useRef(null)
  const [bodyHeight, setBodyHeight] = useStoredState(BODY_HEIGHT_KEY, (raw) =>
    storedNumber(raw, 90, 4000, 260),
  )
  const { width: leftWidth, gutterProps } = useColumnResize(bodyRef, isMobile)

  const { inFlight, run, cancel } = useRequests()
  const loading = !!inFlight[preset]

  // Matrix mode: green-on-black look with digital rain behind the panels.
  // index.html applies the saved choice before first paint.
  const [matrix, setMatrix] = useStoredState(
    MATRIX_KEY,
    (raw) => raw === 'on',
    (on) => (on ? 'on' : null),
  )
  useEffect(() => {
    if (matrix) document.documentElement.dataset.matrix = 'on'
    else delete document.documentElement.dataset.matrix
  }, [matrix])

  // API log tag, added to every request to Hello Retail. Shared by all
  // solutions and kept across sessions, like the layout preferences.
  const [logTag, setLogTag] = useStoredState(
    LOG_TAG_KEY,
    (raw) => raw || '',
    (tag) => tag || null,
  )

  // Apply `fn(session)` (returning the changed fields) to a solution's
  // session; the active one unless `key` says otherwise.
  function updateSession(fn, key = preset) {
    setSessions((s) => ({ ...s, [key]: { ...s[key], ...fn(s[key]) } }))
  }
  const patch = (changes) => updateSession(() => changes)

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

  // Pages: the URL follows the page key.
  const setPagesKey = (pagesKey) => patch({ pagesKey, url: resolveUrl(preset, pagesKey, BASES) })

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

  // Flush immediately when the tab is hidden or closed mid-debounce, so the
  // last edits survive. `visibilitychange` comes first and is the reliable one
  // on mobile, where a backgrounded tab may be killed without `pagehide`.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && persist()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', persist)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', persist)
    }
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
    // The solution this request belongs to, even if another is selected
    // before it returns.
    const key = preset
    let headers
    try {
      headers = parseHeaders(req.headers)
    } catch (e) {
      patch({ error: `Headers are not valid JSON: ${e.message}` })
      return
    }
    patch({ error: null })
    const entry = await run(key, snapshotRequest(req, logTag), headers)
    // Prepend to this solution's history and view the new entry.
    updateSession(
      (sess) => ({
        history: [entry, ...(sess.history || [])].slice(0, MAX_HISTORY),
        viewId: entry.id,
        error: null,
      }),
      key,
    )
    // Only jump to results if this solution is still the one on screen.
    if (isMobile && stateRef.current.preset === key) setMobilePane('results')
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

  // ---- History ----

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
      const viewId = history.some((h) => h.id === sess.viewId) ? sess.viewId : (history[0]?.id ?? null)
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

  // ---- Results ----

  const history = cur.history || []
  const viewed = history.find((h) => h.id === cur.viewId) || history[0] || null
  const result = useResult(viewed?.resp || null, cur.productsPath, cur.fieldMap)

  // Previous / next page: rewrite the request's offset and send it.
  const canPage = useMemo(
    () => pageRequest(preset, cur.body, result.paging, 1) != null,
    [preset, cur.body, result.paging],
  )
  function goPage(dir) {
    const body = pageRequest(preset, cur.body, result.paging, dir)
    if (body == null || loading) return
    const url = isLegacy ? (resolveUrl(preset, cur.pagesKey, BASES, body) ?? cur.url) : cur.url
    patch({ body, url })
    send({ body, url })
  }

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
              {key === 'results' && viewed?.resp ? ` · ${result.allTiles.length}` : ''}
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
              Out of browser storage — history is no longer being saved. Remove some history entries
              (or “clear all”) to free space.
            </div>
          )}

          <div className="row tabs">
            {Object.entries(PRESETS).map(([key, p]) => (
              <button
                key={key}
                className={preset === key ? 'chip active' : 'chip'}
                aria-pressed={preset === key}
                onClick={() => setPreset(key)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="row">
            <select
              value={cur.method}
              onChange={(e) => patch({ method: e.target.value })}
              className="method"
              aria-label="HTTP method"
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              className="url"
              value={cur.url}
              placeholder="https://api.helloretail.com/..."
              aria-label="Request URL"
              onChange={(e) => setUrl(e.target.value)}
            />
            {loading ? (
              <button className="send cancel" onClick={() => cancel(preset)}>
                Cancel
              </button>
            ) : (
              <button className="send" onClick={() => send()} disabled={!cur.url} title="Send (Ctrl+Enter)">
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
              <label className="lbl" htmlFor="pages-key">Page key (appended to the Pages endpoint)</label>
              <input
                id="pages-key"
                className="url"
                value={cur.pagesKey}
                placeholder="Pages key here"
                onChange={(e) => setPagesKey(e.target.value)}
              />
            </>
          )}

          <div className="edhead">
            <label className="lbl" htmlFor="body-editor">
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
            id="body-editor"
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
              <label className="lbl" htmlFor="headers-editor">Headers (JSON)</label>
              <FormatButton onClick={formatHeaders} />
            </div>
            <textarea
              id="headers-editor"
              ref={headersRef}
              className="code"
              value={cur.headers}
              spellCheck={false}
              onChange={(e) => patch({ headers: e.target.value })}
              onKeyDown={(e) => isFormatShortcut(e) && (e.preventDefault(), formatHeaders())}
              rows={4}
            />
          </details>

          <TileMapping
            productsPath={cur.productsPath}
            fieldMap={cur.fieldMap}
            tileFields={cur.tileFields}
            payload={result.payload}
            onPatch={patch}
          />

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
        <div className="gutter" {...gutterProps} />

        <ResultsPanel
          entry={viewed}
          result={result}
          error={cur.error}
          tab={tab}
          onTab={(t) => patch({ tab: t })}
          tileFields={cur.tileFields}
          onPage={canPage ? goPage : null}
          busy={loading}
          hidden={isMobile && mobilePane !== 'results'}
        />
      </div>
    </div>
  )
}
