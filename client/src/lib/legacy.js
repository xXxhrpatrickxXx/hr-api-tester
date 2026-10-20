// The legacy APIs (getProductBoxes / partnerSearch) are GET requests with their
// parameters in the query string. The API log shows those parameters as a JSON
// object, so these helpers convert between the two: paste the logged
// parameters, get the request URL (and back again when the URL is edited).

// Encode a parameter object as a query string, jQuery.param style (matches
// the log's "Body"): arrays become `key[]=v`, nested objects `key[sub]=v`,
// everything else is stringified.
export function toQuery(params) {
  const parts = []
  const add = (key, val) => {
    if (Array.isArray(val)) {
      val.forEach((v, i) => add(`${key}[${v !== null && typeof v === 'object' ? i : ''}]`, v))
    } else if (val !== null && typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) add(`${key}[${k}]`, v)
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val ?? '')}`)
    }
  }
  for (const [k, v] of Object.entries(params)) add(k, v)
  return parts.join('&')
}

// Decode a query string into a parameter object. Repeated `key[]` entries
// collect into an array; other keys are kept as-is.
export function fromQuery(qs) {
  const out = {}
  for (const [key, val] of new URLSearchParams(qs.replace(/^\?/, ''))) {
    if (key.endsWith('[]')) {
      const k = key.slice(0, -2)
      if (!Array.isArray(out[k])) out[k] = []
      out[k].push(val)
    } else {
      out[key] = val
    }
  }
  return out
}

// Read pasted parameters: the JSON object from the API log, its "Body" (a
// query string), or a full request URL. Throws with a readable message.
export function parseParams(text) {
  const s = (text || '').trim()
  if (!s) return {}
  if (s.startsWith('{')) {
    const obj = JSON.parse(s)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error('expected a JSON object')
    }
    return obj
  }
  if (/^https?:\/\//i.test(s)) {
    const q = s.indexOf('?')
    return q === -1 ? {} : fromQuery(s.slice(q + 1))
  }
  if (!s.includes('=')) throw new Error('expected a JSON object or a query string')
  return fromQuery(s)
}

// Parameters from a request URL, minus the default format=json (it is added
// back when the URL is built), as pretty JSON for the parameters editor.
export function paramsFromUrl(url) {
  const q = (url || '').indexOf('?')
  const params = q === -1 ? {} : fromQuery(url.slice(q + 1))
  if (params.format === 'json') delete params.format
  return JSON.stringify(params, null, 2)
}

// The request URL: base endpoint + format=json + the parameters.
export function buildLegacyUrl(base, params) {
  const { format = 'json', ...rest } = params
  return `${base}?${toQuery({ format, ...rest })}`
}
