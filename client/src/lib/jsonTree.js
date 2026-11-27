// Helpers for the collapsible JSON view: node paths, search, and the one-line
// summary shown on a collapsed node.

const PLAIN_KEY = /^(?:[A-Za-z_$][\w$]*|\d+)$/

// Path of a child node, in the dot/bracket form the Tile mapping fields read
// ("products.results[0].title"); keys that aren't plain names are quoted.
// The root's path is ''.
export function childPath(parent, key, isIndex) {
  if (isIndex) return `${parent}[${key}]`
  if (!PLAIN_KEY.test(key)) return `${parent}[${JSON.stringify(key)}]`
  return parent ? `${parent}.${key}` : key
}

export const isContainer = (v) => v !== null && typeof v === 'object'

// The children of an object / array as [key, value, path] triples.
export function children(value, path) {
  if (Array.isArray(value)) return value.map((v, i) => [i, v, childPath(path, i, true)])
  return Object.entries(value).map(([k, v]) => [k, v, childPath(path, k, false)])
}

// "{5}" / "[24]": what a collapsed node holds.
export function summary(value) {
  return Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value).length}}`
}

// A primitive as it appears in JSON.
export const primitiveText = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v))

// Every node whose key or (primitive) value contains `q` (case-insensitive).
// `hits` holds their paths; `open` the paths of every container on the way to
// a hit, which the view expands so each hit is visible.
export function searchJson(value, q) {
  const hits = new Set()
  const open = new Set()
  const needle = q.trim().toLowerCase()
  if (!needle) return { hits, open, count: 0 }
  const visit = (node, path, key, ancestors) => {
    let hit = key != null && String(key).toLowerCase().includes(needle)
    if (isContainer(node)) {
      const trail = [...ancestors, path]
      for (const [k, v, p] of children(node, path)) visit(v, p, k, trail)
    } else if (primitiveText(node).toLowerCase().includes(needle)) {
      hit = true
    }
    if (hit) {
      hits.add(path)
      for (const a of ancestors) open.add(a)
    }
  }
  visit(value, '', null, [])
  return { hits, open, count: hits.size }
}

// Split `text` around case-insensitive matches of `q`, for highlighting:
// [{ text, match }].
export function splitMatches(text, q) {
  const needle = q.trim().toLowerCase()
  if (!needle) return [{ text, match: false }]
  const parts = []
  const lower = text.toLowerCase()
  let i = 0
  for (let j = lower.indexOf(needle); j !== -1; j = lower.indexOf(needle, i)) {
    if (j > i) parts.push({ text: text.slice(i, j), match: false })
    parts.push({ text: text.slice(j, j + needle.length), match: true })
    i = j + needle.length
  }
  if (i < text.length) parts.push({ text: text.slice(i), match: false })
  return parts
}

// Split a dot/bracket path ("responses[0].products") into [key, isIndex]
// segments.
function segments(path) {
  return [...path.matchAll(/\[(\d+)\]|([^.[\]]+)/g)].map((m) =>
    m[1] != null ? [Number(m[1]), true] : [m[2], false],
  )
}

// Paths the tree opens by default so the products show straight away: each
// products array plus every container on the way to it. `usedPath` is where
// the products were found (extractResult), including its multi-box forms:
//   Search:   products.results     Pages: products.result
//   Recoms:   responses[].products (one per box)
//   Legacy recoms: result[boxId].result (one per box)
export function productOpenPaths(response, usedPath) {
  const open = new Set()
  if (!isContainer(response) || !usedPath) return open
  let targets
  if (usedPath === 'responses[].products') {
    targets = (Array.isArray(response.responses) ? response.responses : [])
      .map((r, i) => (Array.isArray(r?.products) ? [['responses', false], [i, true], ['products', false]] : null))
      .filter(Boolean)
  } else if (usedPath === 'result[boxId].result') {
    targets = Object.entries(isContainer(response.result) ? response.result : {})
      .filter(([, b]) => Array.isArray(b?.result))
      .map(([id]) => [['result', false], [id, false], ['result', false]])
  } else {
    targets = [segments(usedPath)]
  }
  for (const segs of targets) {
    let p = ''
    for (const [k, isIndex] of segs) {
      p = childPath(p, k, isIndex)
      open.add(p)
    }
  }
  return open
}
