import { paramsFromUrl } from './legacy.js'

// Short label for a history entry, pulled from the request body when possible.
// Computed once when the request is sent and stored on the entry (older
// entries fall back to computing it on read).
export function entrySummary(entry) {
  if (entry.summary != null) return entry.summary
  return buildSummary(entry)
}

export function buildSummary(entry) {
  try {
    // Legacy entries saved before the parameters editor only have a URL.
    const b = entry.body ? JSON.parse(entry.body) : JSON.parse(paramsFromUrl(entry.url))
    if (b.query) return `“${b.query}”`
    if (b.q) return `“${b.q}”`
    if (b.boxId) return `box ${b.boxId}`
    if (b.ids) return `box ${b.ids}`
    if (b.url) return b.url.replace(/^https?:\/\//, '')
  } catch {
    /* ignore unparseable body */
  }
  if (entry.pagesKey) return entry.pagesKey
  return entry.method
}

// History search: note, summary, URL, body and status, case-insensitive.
// `q` is already trimmed and lowercased.
export function matchesHistory(entry, q) {
  return [entry.note, entrySummary(entry), entry.url, entry.body, entry.resp?.status].some(
    (v) => v != null && String(v).toLowerCase().includes(q),
  )
}

// Export / import of every solution's history as one JSON file. Saved history
// is per site address (the hosted app, :5173 and :8787 each have their own),
// so this is how it moves between them, or gets backed up.
// Credential-looking request headers (Authorization, X-Api-Key, tokens,
// cookies …) have their values replaced, so an export can be shared without
// leaking keys. Request bodies are kept as they are.
export function buildExport(sessions, now = new Date()) {
  return {
    app: 'hr-api-tester',
    version: 1,
    exportedAt: now.toISOString(),
    history: Object.fromEntries(
      Object.entries(sessions).map(([k, s]) => [k, (s.history || []).map(redactEntry)]),
    ),
  }
}

export const REDACTED = '<redacted>'
const SENSITIVE_HEADER = /auth|token|secret|passw|cookie|session|key/i

const redactEntry = (entry) =>
  typeof entry?.headers === 'string' && entry.headers
    ? { ...entry, headers: redactHeaders(entry.headers) }
    : entry

// Works on the headers *text* (as typed in the editor), so it keeps the
// formatting and still catches values when the JSON doesn't fully parse.
export function redactHeaders(text) {
  return text.replace(
    /("((?:[^"\\]|\\.)*)"\s*:\s*)("(?:[^"\\]|\\.)*"|[^,}\s][^,}\n]*)/g,
    (m, lead, name) => (SENSITIVE_HEADER.test(name) ? `${lead}"${REDACTED}"` : m),
  )
}

// Merge an export into `sessions` by entry id: entries already there are
// skipped, so importing the same file twice is harmless. Each solution keeps
// its newest `max`. Throws if `data` isn't an export.
export function mergeImport(sessions, data, max) {
  if (data?.app !== 'hr-api-tester' || !data.history || typeof data.history !== 'object') {
    throw new Error('not an API Tester history export')
  }
  const next = { ...sessions }
  let added = 0
  for (const [key, entries] of Object.entries(data.history)) {
    if (!next[key] || !Array.isArray(entries)) continue
    const have = new Set((next[key].history || []).map((h) => h.id))
    const fresh = entries.filter((e) => e?.id && e.ts && !have.has(e.id))
    if (!fresh.length) continue
    added += fresh.length
    const history = [...(next[key].history || []), ...fresh]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, max)
    next[key] = { ...next[key], history }
  }
  return { sessions: next, added }
}
