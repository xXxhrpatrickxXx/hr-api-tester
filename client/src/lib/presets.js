import { buildLegacyUrl, paramsFromUrl, parseParams } from './legacy.js'
import { DEFAULT_FIELD_MAP } from './products.js'

// Request templates per API. The endpoint is resolved client-side from BASES
// so the URL field shows the real value. The websiteUuid / API key vary per
// request, so fill them in before sending. Edit freely.
export const PRESETS = {
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
export const BASES = {
  recommendations: 'https://core.helloretail.com/serve/recoms',
  search: 'https://core.helloretail.com/serve/search',
  pages: 'https://core.helloretail.com/serve/pages',
  legacyRecoms: 'https://core.helloretail.com/api/v1/product-recommendation/getProductBoxes',
  legacySearch: 'https://core.helloretail.com/api/v1/search/partnerSearch',
}

// Build the literal endpoint URL for a preset from the base URLs. Legacy
// presets append their parameters (`body`); null if those don't parse.
export function resolveUrl(presetKey, pagesKey, bases, body) {
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

export const MAX_HISTORY = 100 // per solution; bounds the persisted store's size

// Each preset (solution) keeps its own keys, body, settings, and a history of
// past requests/responses so switching solutions never loses your work and you
// can flip between earlier and newer runs to compare.
export function blankSession(presetKey) {
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

// Fill in defaults for anything the saved store lacks (new presets/fields).
export function loadState(saved) {
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
