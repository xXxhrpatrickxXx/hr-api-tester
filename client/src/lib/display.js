// Results views, in tab order.
export const RESULT_TABS = ['tiles', 'json', 'headers']

// Extra tile field values: objects as compact JSON, missing as a dash.
export function fieldText(v) {
  if (v == null || v === '') return '—'
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

// Case-insensitive substring match against one field's value, recursing into
// nested objects/arrays. "Any field" uses the tile's precomputed haystack
// instead, so it doesn't re-walk every product on each keystroke.
export function valueMatches(val, q) {
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
export function groupTilesByStep(tiles) {
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

// Assign palette colors by step identity across the whole response, so the same
// step keeps its color in every box. (Colouring per box by position meant e.g.
// ALTERNATIVES was green in one box and blue in another.)
export function stepColorMap(boxes) {
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

export const stepKey = (s) => `${s.index}|${s.source}`
