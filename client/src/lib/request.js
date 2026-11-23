import { parseParams } from './legacy.js'
import { PRESETS } from './presets.js'

// The API error in a response, or null if it succeeded. The serve endpoints
// fail with a non-2xx status and {message, code, success: false}; the legacy
// ones answer 200 with {error, errorCode}, so the status alone isn't enough.
export function responseError(resp) {
  if (!resp) return null
  const j = resp.json
  const obj = j && typeof j === 'object' && !Array.isArray(j) ? j : null
  const inBody = !!obj && (obj.success === false || typeof obj.error === 'string')
  if (resp.ok && !inBody) return null
  const message = obj?.message || obj?.error
  return {
    code: obj?.code || obj?.errorCode || null,
    message: typeof message === 'string' ? message : null,
    detail: j != null ? JSON.stringify(j, null, 2) : resp.text || '',
  }
}

export const sendsBody = (method, body) => method !== 'GET' && method !== 'HEAD' && !!body?.trim()

export const hasContentType = (headers) => Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')

// apiLogTag marks a request in Hello Retail's API log (find them with "only
// tagged"); it changes nothing about the response. Only HR's own endpoints know
// it, and appended by hand so legacy URLs stay readable (URL() re-encodes them).
export function withLogTag(url, tag) {
  if (!tag || /[?&]apiLogTag=/.test(url)) return url
  try {
    if (new URL(url).hostname !== 'core.helloretail.com') return url
  } catch {
    return url
  }
  return `${url}${url.includes('?') ? '&' : '?'}apiLogTag=${encodeURIComponent(tag)}`
}

// The request body for the previous (dir -1) or next (dir 1) page, or null
// when the body has no offset to move. Search / Pages page with
// products.{start,count}; legacy Search with product_{start,count}. Pages
// paging keeps the product scope, so it sends firstLoad: false.
export function pageRequest(presetKey, body, paging, dir) {
  if (!paging) return null
  const step = (count, start) => {
    const n = Number(count) || paging.shown
    return n > 0 ? Math.max(0, start + dir * n) : null
  }
  try {
    if (PRESETS[presetKey]?.legacy) {
      const p = parseParams(body)
      if (!('product_start' in p || 'product_count' in p)) return null
      const start = step(p.product_count, paging.start)
      return start == null ? null : JSON.stringify({ ...p, product_start: String(start) }, null, 2)
    }
    const b = JSON.parse(body)
    if (!b?.products || typeof b.products !== 'object') return null
    const start = step(b.products.count, paging.start)
    if (start == null) return null
    const next = { ...b, products: { ...b.products, start } }
    if (presetKey === 'pages' || 'firstLoad' in b) next.firstLoad = false
    return JSON.stringify(next, null, 2)
  } catch {
    return null
  }
}
