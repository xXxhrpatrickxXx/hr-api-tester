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

// Keys that mark an array as the Hello Retail product list, so auto-detection
// can pick it out regardless of where it sits in the response
// (responses[].products / products.results / products.result).
const PRODUCT_KEYS = ['title', 'imgUrl', 'productNumber', 'price', 'oldPrice', 'url']

function looksLikeProduct(item) {
  return item && typeof item === 'object' && PRODUCT_KEYS.some((k) => k in item)
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

export function extractTiles(response, productsPath, fieldMap) {
  if (!response) return { tiles: [], usedPath: '' }
  let usedPath = productsPath
  let arr = productsPath ? getPath(response, productsPath) : undefined
  if (!Array.isArray(arr)) {
    const candidates = findArrayPaths(response)
    // Prefer the array whose items look like HR products; fall back to the
    // longest array of objects.
    const product = candidates.find((c) => {
      const a = getPath(response, c.path)
      return Array.isArray(a) && a.some(looksLikeProduct)
    })
    const chosen = product || candidates[0]
    if (chosen) {
      usedPath = chosen.path
      arr = getPath(response, chosen.path)
    }
  }
  if (!Array.isArray(arr)) return { tiles: [], usedPath: '' }
  return {
    tiles: arr.filter((x) => x && typeof x === 'object').map((x) => toTile(x, fieldMap)),
    usedPath,
  }
}
