// Utilities for pulling a list of "products" out of an arbitrary API response
// and mapping each one onto the fields a tile needs.

// Read a dot/bracket path like "data.products" or "results[0].items" from obj.
export function getPath(obj, path) {
  if (!path) return obj
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let cur = obj
  for (const p of parts) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}

// Walk the response and return candidate paths that hold an array of objects,
// best (longest array of object-like items) first. Used for auto-detection.
export function findArrayPaths(obj, maxDepth = 6) {
  const found = []
  const visit = (node, path, depth) => {
    if (depth > maxDepth || node == null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      const objs = node.filter((x) => x && typeof x === 'object')
      if (objs.length) found.push({ path, length: node.length })
      node.slice(0, 1).forEach((child, i) => visit(child, `${path}[${i}]`, depth + 1))
      return
    }
    for (const [k, v] of Object.entries(node)) {
      visit(v, path ? `${path}.${k}` : k, depth + 1)
    }
  }
  visit(obj, '', 0)
  return found.sort((a, b) => b.length - a.length)
}

// First non-empty value among several candidate keys (case-insensitive,
// supports nested dot paths too).
function pick(item, keys) {
  for (const key of keys) {
    const v = key.includes('.') ? getPath(item, key) : item[key]
    if (v != null && v !== '') return v
  }
  return undefined
}

// Hello Retail returns these exact field names on product objects across
// Recommendations, Search, and Pages (they're the fields we request). The UI
// still lets you override for non-standard responses.
export const DEFAULT_FIELD_MAP = {
  title: 'title',
  image: 'imgUrl',
  price: 'price',
  oldPrice: 'oldPrice',
  url: 'url',
  id: 'productNumber',
}

// Keys that mark an array item as a Hello Retail product.
const PRODUCT_KEYS = ['title', 'imgUrl', 'productNumber', 'price', 'oldPrice', 'url']

function looksLikeProduct(item) {
  return item && typeof item === 'object' && PRODUCT_KEYS.some((k) => k in item)
}

// The array holding products always sits under one of these keys across all HR
// APIs: responses[].products, products.results, products.result,
// result[boxId].result (legacy recoms), results (legacy search).
const PRODUCT_ARRAY_KEYS = ['products', 'results', 'result']
// Arrays under these keys are never products (facets/sort options) — a filters
// array can be longer than the product list and otherwise get mis-detected.
const NON_PRODUCT_ARRAY_KEYS = ['filters', 'sorting', 'facets']

// Last object key in a path, ignoring a trailing array index.
// "products.results" -> "results", "responses[0].products" -> "products".
function lastKey(path) {
  const noIndex = path.replace(/\[\d+\]$/, '')
  const dot = noIndex.lastIndexOf('.')
  return dot === -1 ? noIndex : noIndex.slice(dot + 1)
}

function splitKeys(spec) {
  return (spec || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function toTile(item, fieldMap = DEFAULT_FIELD_MAP) {
  return {
    id: pick(item, splitKeys(fieldMap.id)),
    title: pick(item, splitKeys(fieldMap.title)),
    image: pick(item, splitKeys(fieldMap.image)),
    price: pick(item, splitKeys(fieldMap.price)),
    oldPrice: pick(item, splitKeys(fieldMap.oldPrice)),
    url: pick(item, splitKeys(fieldMap.url)),
    raw: item,
  }
}

// The object that directly contains the array at `path` (i.e. its parent), so
// we can read siblings like Recommendations' `countAfterSource`.
function parentOf(obj, path) {
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  parts.pop()
  let cur = obj
  for (const p of parts) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}

// Parse a Recommendations `countAfterSource` string into ordered steps. Format:
//   "0. FIXED (0ms): 0; 1. RECENTLY_CREATED (36ms): 0; 3. RECENTLY_CREATED (3ms): 2; …"
// where each ": N" is the number of products that step contributed (per step,
// not cumulative). Steps that contributed 0 products are dropped.
export function parseCountAfterSource(str) {
  if (typeof str !== 'string' || !str.trim()) return []
  return str
    .split(';')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const m = seg.match(/^(\d+)\.\s*(.+?)\s*\((\d+)ms\)\s*:\s*(\d+)$/)
      if (!m) return null
      return { index: Number(m[1]), source: m[2], ms: Number(m[3]), count: Number(m[4]) }
    })
    .filter(Boolean)
}

export function extractTiles(response, productsPath, fieldMap) {
  if (!response) return { tiles: [], usedPath: '', steps: [] }
  let usedPath = productsPath
  let arr = productsPath ? getPath(response, productsPath) : undefined
  if (!Array.isArray(arr)) {
    // Candidates are arrays of objects, longest first. Never treat filters/
    // sorting as products, even when longer than the product list.
    const candidates = findArrayPaths(response).filter(
      (c) => !NON_PRODUCT_ARRAY_KEYS.includes(lastKey(c.path)),
    )
    const productLike = (c) => {
      const a = getPath(response, c.path)
      return Array.isArray(a) && a.some(looksLikeProduct)
    }
    const inProductKey = (c) => PRODUCT_ARRAY_KEYS.includes(lastKey(c.path))
    // Prefer a known product container that also looks like products, then any
    // known product container, then anything product-like, then longest.
    const chosen =
      candidates.find((c) => inProductKey(c) && productLike(c)) ||
      candidates.find(inProductKey) ||
      candidates.find(productLike) ||
      candidates[0]
    if (chosen) {
      usedPath = chosen.path
      arr = getPath(response, chosen.path)
    }
  }
  if (!Array.isArray(arr)) return { tiles: [], usedPath: '', steps: [] }

  const tiles = arr.filter((x) => x && typeof x === 'object').map((x) => toTile(x, fieldMap))

  // Recommendations: attribute each product to the waterfall step that found
  // it, by walking the per-step counts in order. Steps live on the parent of
  // the products array (e.g. responses[0].countAfterSource).
  const steps = parseCountAfterSource(parentOf(response, usedPath)?.countAfterSource)
  assignSteps(tiles, steps)

  return { tiles, usedPath, steps }
}

// Tag each tile with the waterfall step that produced it (in order, per count).
function assignSteps(tiles, steps) {
  if (!steps.length) return
  let i = 0
  for (const step of steps) {
    for (let n = 0; n < step.count && i < tiles.length; n++, i++) {
      tiles[i].source = step
    }
  }
}

// Extract products grouped into "boxes". Recommendations can request several
// boxes at once, returning responses[] where each entry is its own box with its
// own products + countAfterSource — each becomes a box. Everything else is a
// single box. Returns { boxes: [{ key, tiles, steps }], usedPath }.
export function extractResult(response, productsPath, fieldMap) {
  if (!response) return { boxes: [], usedPath: '' }

  // Multi-box recoms: only when auto-detecting (no manual path override).
  if (
    !productsPath &&
    Array.isArray(response.responses) &&
    response.responses.some((r) => r && Array.isArray(r.products))
  ) {
    const boxes = response.responses
      .filter((r) => r && Array.isArray(r.products))
      .map((r, i) => {
        const tiles = r.products
          .filter((x) => x && typeof x === 'object')
          .map((x) => toTile(x, fieldMap))
        const steps = parseCountAfterSource(r.countAfterSource)
        assignSteps(tiles, steps)
        return { key: r.key || r.trackingKey || `Box ${i + 1}`, tiles, steps }
      })
    return { boxes, usedPath: 'responses[].products' }
  }

  const { tiles, usedPath, steps } = extractTiles(response, productsPath, fieldMap)
  return { boxes: [{ key: null, tiles, steps }], usedPath }
}
