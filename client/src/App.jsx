import { useEffect, useMemo, useState } from 'react'
import { extractResult, findArrayPaths, DEFAULT_FIELD_MAP } from './lib/products.js'

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
  // Legacy APIs are GET with query-string params (no JSON body). The URL is
  // prefilled with a param template to edit in place.
  legacyRecoms: {
    label: 'Recoms (legacy)',
    method: 'GET',
    baseKey: 'legacyRecoms',
    query: 'format=json&ids=&trackingUserId=&url=',
    body: '',
  },
  legacySearch: {
    label: 'Search (legacy)',
    method: 'GET',
    baseKey: 'legacySearch',
    query: 'format=json&key=&q=&product_count=24&product_start=0',
    body: '',
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

// Build the literal endpoint URL for a preset from the base URLs.
function resolveUrl(presetKey, pagesKey, bases) {
  const p = PRESETS[presetKey]
  if (!p || !p.baseKey || !bases) return ''
  const base = bases[p.baseKey] || ''
  if (!base) return ''
  if (p.needsKey) return `${base.replace(/\/+$/, '')}/${pagesKey || ''}`
  if (p.query) return `${base}?${p.query}`
  return base
}

const STORAGE_KEY = 'hr-api-tester:v3'
const MAX_HISTORY = 20 // per solution; bounds sessionStorage size

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
    history: [], // newest first; each entry is a request + its response
    viewId: null, // which history entry the results panel is showing
    error: null, // transient validation error (not a sent request)
  }
}

// Short label for a history entry, pulled from the request body when possible.
function entrySummary(entry) {
  try {
    const b = JSON.parse(entry.body || '{}')
    if (b.query) return `“${b.query}”`
    if (b.boxId) return `box ${b.boxId}`
    if (b.url) return b.url.replace(/^https?:\/\//, '')
  } catch {
    /* ignore unparseable body */
  }
  if (entry.pagesKey) return entry.pagesKey
  return entry.method
}

// Case-insensitive substring match against a value, recursing into nested
// objects/arrays so "any field" filtering also reaches nested data.
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
    const key = t.source ? t.source.index : '_none'
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.tiles.push(t)
    else groups.push({ key, source: t.source || null, tiles: [t] })
  }
  return groups
}

function loadState() {
  let saved = {}
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
  } catch {
    saved = {}
  }
  const sessions = {}
  for (const key of Object.keys(PRESETS)) {
    sessions[key] = { ...blankSession(key), ...(saved.sessions?.[key] || {}) }
  }
  return { preset: saved.preset || 'recommendations', sessions }
}

export default function App() {
  const initial = loadState()
  const [preset, setPreset] = useState(initial.preset)
  const [sessions, setSessions] = useState(initial.sessions)
  const cur = sessions[preset]

  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('tiles')

  // Width of the config column, draggable via the gutter. Persisted across
  // sessions (a layout preference, not per-request data).
  const [leftWidth, setLeftWidth] = useState(() => {
    const w = Number(localStorage.getItem('hr-api-tester:leftWidth'))
    return w >= 280 && w <= 900 ? w : 420
  })
  useEffect(() => {
    localStorage.setItem('hr-api-tester:leftWidth', String(leftWidth))
  }, [leftWidth])

  function startResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = leftWidth
    const onMove = (ev) => {
      const max = Math.min(900, window.innerWidth - 320)
      setLeftWidth(Math.min(Math.max(startW + ev.clientX - startX, 280), max))
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
  // page key live; other presets are populated once (so edited legacy query
  // params aren't clobbered when switching solutions). Custom is left alone.
  useEffect(() => {
    if (preset === 'custom') return
    if (PRESETS[preset].needsKey) {
      patch({ url: resolveUrl(preset, cur.pagesKey, BASES) })
    } else if (!cur.url) {
      patch({ url: resolveUrl(preset, cur.pagesKey, BASES) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, cur.pagesKey])

  // Persist each solution's data so it survives switching solutions, reloads,
  // and relaunching the app (localStorage = kept until explicitly cleared).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ preset, sessions }))
    } catch {
      // localStorage may reject very large responses — ignore.
    }
  }, [preset, sessions])

  function formatBody() {
    try {
      patch({ body: JSON.stringify(JSON.parse(cur.body), null, 2), error: null })
    } catch (e) {
      patch({ error: `Body is not valid JSON: ${e.message}` })
    }
  }

  async function send() {
    setLoading(true)
    patch({ error: null })
    let parsedHeaders = {}
    try {
      parsedHeaders = cur.headers.trim() ? JSON.parse(cur.headers) : {}
    } catch (e) {
      setLoading(false)
      patch({ error: `Headers are not valid JSON: ${e.message}` })
      return
    }
    // Snapshot the request now; the response (or transport error) is attached
    // once it returns. The whole thing becomes an immutable history entry.
    const ts = Date.now()
    const snapshot = {
      id: `${ts}-${Math.random().toString(36).slice(2, 7)}`,
      ts,
      method: cur.method,
      url: cur.url,
      pagesKey: cur.pagesKey,
      body: cur.body,
      headers: cur.headers,
      locked: false, // locked entries survive "clear all"
    }
    let entry
    const started = performance.now()
    try {
      const init = { method: cur.method, headers: { ...parsedHeaders } }
      if (cur.method !== 'GET' && cur.method !== 'HEAD' && cur.body && cur.body.trim() !== '') {
        init.body = cur.body
        if (!Object.keys(init.headers).some((h) => h.toLowerCase() === 'content-type')) {
          init.headers['Content-Type'] = 'application/json'
        }
      }
      const r = await fetch(cur.url, init)
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
        requestUrl: cur.url,
        headers: Object.fromEntries(r.headers.entries()),
        json,
        text: json == null ? text : undefined,
      }
      entry = { ...snapshot, resp: data, error: null }
    } catch (e) {
      // A thrown fetch is usually a network/CORS failure (no HTTP response).
      entry = { ...snapshot, resp: null, error: `${e.message || e} (network/CORS error)` }
    }
    // Prepend to this solution's history and view the new entry.
    setSessions((s) => {
      const sess = s[preset]
      const history = [entry, ...(sess.history || [])].slice(0, MAX_HISTORY)
      return { ...s, [preset]: { ...sess, history, viewId: entry.id, error: null } }
    })
    setTab('tiles')
    setLoading(false)
  }

  // Load a past request back into the form and show its response.
  function viewEntry(id) {
    const e = (cur.history || []).find((h) => h.id === id)
    if (!e) return
    patch({
      viewId: id,
      method: e.method,
      url: e.url,
      pagesKey: e.pagesKey,
      body: e.body,
      headers: e.headers,
      error: null,
    })
    setTab('tiles')
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

  const history = cur.history || []
  const viewed = history.find((h) => h.id === cur.viewId) || history[0] || null
  const resp = viewed?.resp || null
  const displayError = cur.error || viewed?.error || null

  const payload = resp?.json
  // Products come back as one or more "boxes" (recoms can request several at
  // once — each responses[] entry is its own box with its own step waterfall).
  const { boxes, usedPath } = useMemo(
    () => extractResult(payload, cur.productsPath, cur.fieldMap),
    [payload, cur.productsPath, cur.fieldMap],
  )
  const arrayPaths = useMemo(() => (payload ? findArrayPaths(payload) : []), [payload])

  const allTiles = useMemo(() => boxes.flatMap((b) => b.tiles), [boxes])
  const anySteps = boxes.some((b) => b.steps.length > 0)

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
    const match = (t) => (filterField ? valueMatches(t.raw?.[filterField], q) : valueMatches(t.raw, q))
    return boxes.map((b) => ({ ...b, tiles: b.tiles.filter(match) }))
  }, [boxes, filterText, filterField])

  const totalTiles = allTiles.length
  const shownTiles = filteredBoxes.reduce((n, b) => n + b.tiles.length, 0)

  return (
    <div className="app">
      <header className="topbar">
        <h1>Hello Retail · API Tester</h1>
        <span className="hint">calls core.helloretail.com directly</span>
      </header>

      <div className="layout">
        {/* ---- Request panel ---- */}
        <section className="panel request" style={{ width: leftWidth, flex: '0 0 auto' }}>
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
              onChange={(e) => patch({ url: e.target.value })}
            />
            <button className="send" onClick={send} disabled={loading || !cur.url}>
              {loading ? '…' : 'Send'}
            </button>
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

          <label className="lbl">
            Body (JSON) <button className="link" onClick={formatBody}>format</button>
          </label>
          <textarea
            className="code"
            value={cur.body}
            spellCheck={false}
            onChange={(e) => patch({ body: e.target.value })}
            rows={12}
          />

          <details>
            <summary>Headers</summary>
            <textarea
              className="code"
              value={cur.headers}
              spellCheck={false}
              onChange={(e) => patch({ headers: e.target.value })}
              rows={4}
            />
          </details>

          <details>
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
          </details>

          {history.length > 0 && (
            <div className="hist">
              <div className="hist-head">
                <span className="lbl">History · {history.length}</span>
                <button className="link" onClick={clearHistory}>clear all</button>
              </div>
              <ul className="hist-list">
                {history.map((h) => (
                  <li key={h.id} className={viewed?.id === h.id ? 'hist-row active' : 'hist-row'}>
                    <button
                      className="hist-main"
                      onClick={() => viewEntry(h.id)}
                      title={`${h.method} ${h.url}`}
                    >
                      <span className={h.resp?.ok ? 'sdot ok' : 'sdot bad'} />
                      <span className="hist-status">{h.resp?.status ?? 'ERR'}</span>
                      <span className="hist-sum">{entrySummary(h)}</span>
                      <span className="hist-time">{new Date(h.ts).toLocaleTimeString()}</span>
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
          )}
        </section>

        {/* ---- Drag handle to resize the config column ---- */}
        <div className="gutter" onMouseDown={startResize} title="Drag to resize" />

        {/* ---- Results panel ---- */}
        <section className="panel results">
          <div className="row statusbar">
            {resp && (
              <>
                <span className={resp.ok ? 'badge ok' : 'badge bad'}>
                  {resp.status} {resp.statusText}
                </span>
                <span className="hint">{resp.durationMs} ms</span>
                {usedPath !== undefined && payload && (
                  <span className="hint">
                    {filterText.trim() ? `${shownTiles} / ${totalTiles}` : totalTiles} tiles
                    {boxes.length > 1 ? ` · ${boxes.length} boxes` : ''}
                    {usedPath ? ` from "${usedPath}"` : ''}
                  </span>
                )}
              </>
            )}
            <div className="spacer" />
            {['tiles', 'json', 'headers'].map((t) => (
              <button
                key={t}
                className={tab === t ? 'chip active' : 'chip'}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          {displayError && <div className="error">{displayError}</div>}

          {!resp && !displayError && <div className="empty">Send a request to see results.</div>}

          {tab === 'tiles' && resp && (
            <>
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
                    <TileGroups tiles={box.tiles} steps={box.steps} grouped={groupBySource} />
                  </div>
                ) : (
                  <TileGroups key={bi} tiles={box.tiles} steps={box.steps} grouped={groupBySource} />
                ),
              )}
            </>
          )}

          {tab === 'json' && resp && (
            <pre className="code view">{JSON.stringify(resp.json ?? resp.text, null, 2)}</pre>
          )}

          {tab === 'headers' && resp && (
            <pre className="code view">{JSON.stringify(resp.headers, null, 2)}</pre>
          )}
        </section>
      </div>
    </div>
  )
}

// Assign each step a stable color from the palette (steps vary per config).
function stepColorMap(steps) {
  const map = {}
  steps.forEach((s, i) => { map[s.index] = STEP_COLORS[i % STEP_COLORS.length] })
  return map
}

// Render a box's tiles: grouped by countAfterSource step (bordered/colored) when
// step data exists and grouping is on, otherwise a plain grid.
function TileGroups({ tiles, steps, grouped }) {
  if (grouped && steps.length > 0) {
    const colors = stepColorMap(steps)
    return (
      <div className="stepgroups">
        {groupTilesByStep(tiles).map((g, gi) => {
          const color = g.source ? colors[g.source.index] : 'var(--border)'
          return (
            <div key={`${g.key}-${gi}`} className="stepgroup" style={{ borderColor: color }}>
              <div className="stephead" style={{ background: color }}>
                {g.source
                  ? `Step ${g.source.index}: ${g.source.source} · ${g.source.ms}ms · ${g.tiles.length}`
                  : `Unattributed · ${g.tiles.length}`}
              </div>
              <div className="stepbody">
                {g.tiles.map((t, i) => (
                  <Tile key={t.id ?? `${gi}-${i}`} t={t} />
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
        <Tile key={t.id ?? i} t={t} />
      ))}
    </div>
  )
}

function Tile({ t }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="tile">
      <div className="thumb">
        {t.image ? (
          <img src={t.image} alt={t.title || ''} loading="lazy" />
        ) : (
          <div className="noimg">no image</div>
        )}
      </div>
      <div className="meta">
        <div className="title" title={t.title}>{t.title || '(untitled)'}</div>
        <div className="prices">
          {t.price != null && <span className="price">{String(t.price)}</span>}
          {t.oldPrice != null && <span className="old">{String(t.oldPrice)}</span>}
        </div>
        <div className="row">
          {t.url && (
            <a className="link" href={t.url} target="_blank" rel="noreferrer">open</a>
          )}
          <button className="link" onClick={() => setOpen((v) => !v)}>
            {open ? 'hide' : 'raw'}
          </button>
        </div>
        {open && <pre className="code view sm">{JSON.stringify(t.raw, null, 2)}</pre>}
      </div>
    </div>
  )
}
