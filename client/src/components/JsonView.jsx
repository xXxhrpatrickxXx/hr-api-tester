import { useDeferredValue, useMemo, useState } from 'react'
import { children, isContainer, primitiveText, searchJson, splitMatches, summary } from '../lib/jsonTree.js'
import { CopyButton } from './CopyButton.jsx'

// Levels open when a response is first shown (the top level is always open).
const OPEN_DEPTH = 2
// Children rendered per container before "show more", so a 500-product array
// doesn't mount thousands of rows at once.
const CHUNK = 100
const NONE = new Set()

// The response body as a collapsible tree with search, or as the plain text it
// was sent as (`text`, when it isn't JSON). "raw" shows the formatted JSON.
// `defaultOpen`: paths also open at first (the products array, so its items
// show without digging for them).
export function JsonView({
  value,
  text,
  defaultOpen = NONE,
  copyLabel = 'copy JSON',
  copyTitle = 'Copy the full JSON response',
}) {
  const isJson = text === undefined
  // Stringified once per response, not on every render (typing elsewhere in
  // the app re-renders this, and a search response can be megabytes).
  const raw = useMemo(() => (isJson ? JSON.stringify(value, null, 2) : (text ?? '')), [isJson, value, text])
  const [view, setView] = useState('tree') // tree | raw
  const [query, setQuery] = useState('')
  const [onlyMatches, setOnlyMatches] = useState(true)
  // Expand / collapse all: remounts the tree with a new default depth, after
  // which `defaultOpen` no longer applies.
  const [layout, setLayout] = useState({ depth: OPEN_DEPTH, gen: 0, defaults: true })

  // Deferred, so typing stays responsive while a large tree re-filters.
  const q = useDeferredValue(query.trim())
  const search = useMemo(() => searchJson(isJson ? value : null, q), [isJson, value, q])

  const tree = isJson && isContainer(value) && view === 'tree'
  const ctx = {
    depth: layout.depth,
    defaultOpen: layout.defaults ? defaultOpen : NONE,
    q,
    search,
    only: onlyMatches && !!q,
  }

  return (
    <div className="jsonview">
      <div className="jtools">
        {tree && (
          <>
            <input
              className="url"
              placeholder="Search keys and values…"
              aria-label="Search the JSON"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            />
            {q && (
              <span className="hint" aria-live="polite">
                {search.count} match{search.count === 1 ? '' : 'es'}
              </span>
            )}
            <label className="grouptoggle" title="Hide everything that doesn't lead to a match">
              <input
                type="checkbox"
                checked={onlyMatches}
                onChange={(e) => setOnlyMatches(e.target.checked)}
              />
              matches only
            </label>
            <button className="link" onClick={() => setLayout((l) => ({ depth: Infinity, gen: l.gen + 1, defaults: false }))}>
              expand all
            </button>
            <button className="link" onClick={() => setLayout((l) => ({ depth: 1, gen: l.gen + 1, defaults: false }))}>
              collapse all
            </button>
          </>
        )}
        <div className="spacer" />
        {isJson && isContainer(value) && (
          <button
            className={view === 'raw' ? 'chip sm active' : 'chip sm'}
            onClick={() => setView((v) => (v === 'raw' ? 'tree' : 'raw'))}
            title="Show the formatted JSON text"
          >
            raw
          </button>
        )}
        <CopyButton className="chip sm" label={copyLabel} title={copyTitle} text={() => raw} />
      </div>
      {tree ? (
        <div className="code view jtree" key={layout.gen}>
          {ctx.only && search.count === 0 ? (
            <div className="hint">Nothing matches “{q}”.</div>
          ) : (
            <JsonChildren value={value} path="" depth={0} ctx={ctx} />
          )}
        </div>
      ) : (
        <pre className="code view">{raw}</pre>
      )}
    </div>
  )
}

// `inHit`: inside a node that matched itself, so "matches only" shows all of
// it rather than just its own matches. `force`: an ancestor's "expand all" /
// "collapse all" ('expand' | 'collapse'), which overrides the default depth.
function JsonChildren({ value, path, depth, ctx, inHit = false, force = null }) {
  const [limit, setLimit] = useState(CHUNK)
  let list = children(value, path)
  if (ctx.only && !inHit) list = list.filter(([, , p]) => ctx.search.hits.has(p) || ctx.search.open.has(p))
  const shown = list.slice(0, limit)
  const rest = list.length - shown.length
  return (
    <div>
      {shown.map(([k, v, p]) => (
        <JsonNode
          key={p}
          name={k}
          isIndex={Array.isArray(value)}
          value={v}
          path={p}
          depth={depth}
          ctx={ctx}
          inHit={inHit}
          force={force}
        />
      ))}
      {rest > 0 && (
        <button
          className="link jmore"
          style={{ paddingLeft: indent(depth) }}
          onClick={() => setLimit((n) => n + CHUNK)}
        >
          show {Math.min(rest, CHUNK)} more ({rest} not shown)
        </button>
      )}
    </div>
  )
}

const indent = (depth) => `${depth * 16 + 4}px`

function JsonNode({ name, isIndex, value, path, depth, ctx, inHit, force }) {
  const container = isContainer(value)
  const hasNested = useMemo(() => container && Object.values(value).some(isContainer), [container, value])
  // A manual open/close sticks to the search it was made under, so clearing
  // the search brings back the tree as you had it, and a new search opens the
  // way to its own matches.
  const [manual, setManual] = useState(null) // { open, q }
  // This node's own "expand all" / "collapse all" of everything under it. A
  // new `gen` remounts the children, dropping their own open/close choices.
  const [sub, setSub] = useState({ gen: 0, mode: null })
  const auto =
    ctx.search.open.has(path) ||
    (force ? force === 'expand' : ctx.defaultOpen.has(path) || depth + 1 < ctx.depth)
  const open = container && (manual && manual.q === ctx.q ? manual.open : auto)

  // Applies to everything under this node, and opens the node itself either
  // way: "collapse all" leaves its children showing, each one closed.
  function setSubtree(mode) {
    setManual({ open: true, q: ctx.q })
    setSub((s) => ({ gen: s.gen + 1, mode }))
  }
  // Alt+click on the arrow opens / closes the whole subtree, as in browser
  // dev tools.
  function onToggle(e) {
    if (!e.altKey) return setManual({ open: !open, q: ctx.q })
    if (!open) return setSubtree('expand')
    setSub((s) => ({ gen: s.gen + 1, mode: 'collapse' }))
    setManual({ open: false, q: ctx.q })
  }
  const hit = ctx.q && ctx.search.hits.has(path)

  const keyText = String(name)
  const label = hit ? <Highlight text={keyText} q={ctx.q} /> : keyText
  return (
    <div>
      <div className={hit ? 'jrow hit' : 'jrow'} style={{ paddingLeft: indent(depth) }} title={path}>
        {container ? (
          <button
            className="jtoggle"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${path}`}
            title={`${open ? 'Collapse' : 'Expand'} (Alt+click: everything inside too)`}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="jtoggle" aria-hidden="true" />
        )}
        <span className={isIndex ? 'jkey idx' : 'jkey'}>{label}</span>
        <span className="jpunct">: </span>
        {container ? (
          <span className="jsum">{summary(value)}</span>
        ) : (
          <JsonValue value={value} q={hit ? ctx.q : ''} />
        )}
        <span className="jacts">
          {/* Only where there is something deeper to open: on a node of plain
              values these would just duplicate the arrow. */}
          {hasNested && (
            <>
              <button className="jact" onClick={() => setSubtree('expand')} title={`Expand everything in ${path}`}>
                expand all
              </button>
              <button
                className="jact"
                onClick={() => setSubtree('collapse')}
                title={`Show ${path} with everything in it collapsed`}
              >
                collapse all
              </button>
            </>
          )}
          <CopyButton className="jact" label="path" title={`Copy the path: ${path}`} text={path} />
        </span>
      </div>
      {open && (
        <JsonChildren
          key={sub.gen}
          value={value}
          path={path}
          depth={depth + 1}
          ctx={ctx}
          inHit={inHit || !!hit}
          force={sub.mode ?? force}
        />
      )}
    </div>
  )
}

function JsonValue({ value, q }) {
  const type = value === null ? 'null' : typeof value
  const text = primitiveText(value)
  return <span className={`jval ${type}`}>{q ? <Highlight text={text} q={q} /> : text}</span>
}

function Highlight({ text, q }) {
  return splitMatches(text, q).map((part, i) =>
    part.match ? <mark key={i}>{part.text}</mark> : part.text,
  )
}
