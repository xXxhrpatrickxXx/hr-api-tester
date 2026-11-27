import { useMemo, useState } from 'react'
import { RESULT_TABS, stepColorMap, valueMatches } from '../lib/display.js'
import { productOpenPaths } from '../lib/jsonTree.js'
import { ErrorCard } from './ErrorCard.jsx'
import { JsonView } from './JsonView.jsx'
import { PageInfo } from './PageInfo.jsx'
import { TileGroups } from './Tiles.jsx'

// The viewed history entry's response: status bar, then its products as tiles,
// its JSON, or its headers.
//
// `entry` is the history entry shown (null before the first send), `result`
// what useResult read from its response, `error` the session's validation
// error, `onPage(dir)` sends the previous / next page (null when the request
// can't be paged).
export function ResultsPanel({ entry, result, error, tab, onTab, tileFields, onPage, busy, hidden }) {
  const resp = entry?.resp || null
  const { payload, apiError, boxes, usedPath, paging, allTiles } = result

  // Group products by their countAfterSource waterfall step (Recommendations).
  const [groupBySource, setGroupBySource] = useState(true)

  // Real-time results filter. Empty field = match any value in any field.
  const [filterText, setFilterText] = useState('')
  const [filterField, setFilterField] = useState('')

  // Extra product fields shown on every tile (dot paths allowed).
  const extraFields = useMemo(
    () =>
      (tileFields || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [tileFields],
  )

  const anySteps = useMemo(() => boxes.some((b) => b.steps.length > 0), [boxes])
  const stepColors = useMemo(() => stepColorMap(boxes), [boxes])

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
    const match = (t) => (filterField ? valueMatches(t.raw?.[filterField], q) : t.search.includes(q))
    return boxes.map((b) => ({ ...b, tiles: b.tiles.filter(match) }))
  }, [boxes, filterText, filterField])

  const totalTiles = allTiles.length
  const shownTiles = filteredBoxes.reduce((n, b) => n + b.tiles.length, 0)
  // Retail media banners share the result array with products (Pages), so
  // call them out separately — the split is the point when testing placement.
  const bannerCount = useMemo(() => allTiles.filter((t) => t.isBanner).length, [allTiles])
  const sponsoredCount = useMemo(() => allTiles.filter((t) => !t.isBanner && t.campaignId).length, [allTiles])
  // Search: how much AI synonym expansion contributed (suggestedProductStatus:
  // NO_SUGGESTED / MIXED / ONLY_SUGGESTED) and how many products it alone found.
  const aiStatus = payload?.products?.suggestedProductStatus
  const aiCount = useMemo(() => allTiles.filter((t) => t.suggested).length, [allTiles])

  // The JSON tree opens the products array(s) from the start.
  const jsonOpen = useMemo(() => productOpenPaths(payload, usedPath), [payload, usedPath])

  const tileProps = { grouped: groupBySource, colors: stepColors, extra: extraFields }

  return (
    <section className="panel results" hidden={hidden}>
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
        {RESULT_TABS.map((t) => (
          <button key={t} className={tab === t ? 'chip active' : 'chip'} onClick={() => onTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className="results-body">
        {error && <div className="error">{error}</div>}

        {/* Failed requests: the error replaces the products, so it can be
            read without switching to the json tab. */}
        {entry?.error && <ErrorCard title="Request failed" message={entry.error} />}
        {tab === 'tiles' && apiError && (
          <ErrorCard
            title={`Request failed · HTTP ${resp.status}`}
            code={apiError.code}
            message={apiError.message}
            detail={apiError.detail}
          />
        )}

        {!resp && !entry?.error && !error && <div className="empty">Send a request to see results.</div>}

        {tab === 'tiles' && resp && !apiError && (
          <>
            {paging && <PageInfo {...paging} onPage={onPage} busy={busy} />}
            {totalTiles > 0 && (
              <div className="row filterbar">
                <input
                  className="url"
                  placeholder="Filter products… e.g. Zion"
                  aria-label="Filter products"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                />
                <select
                  className="method"
                  value={filterField}
                  onChange={(e) => setFilterField(e.target.value)}
                  title="Field to filter on"
                  aria-label="Field to filter on"
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
              <div className="empty">No products found. Open “Tile mapping” to set the array path / fields.</div>
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
                  <TileGroups tiles={box.tiles} steps={box.steps} {...tileProps} />
                </div>
              ) : (
                <TileGroups key={bi} tiles={box.tiles} steps={box.steps} {...tileProps} />
              ),
            )}
          </>
        )}

        {/* Not keyed by entry: the search (and what's open) carries over while
            stepping through history, to compare the same spot across runs. */}
        {tab === 'json' && resp && (
          <JsonView
            value={resp.json}
            text={resp.json == null ? (resp.text ?? '') : undefined}
            defaultOpen={jsonOpen}
          />
        )}

        {tab === 'headers' && resp && (
          <JsonView
            value={resp.headers ?? {}}
            copyLabel="copy headers"
            copyTitle="Copy the response headers"
          />
        )}
      </div>
    </section>
  )
}
