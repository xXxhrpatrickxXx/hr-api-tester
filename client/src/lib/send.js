import { buildSummary } from './history.js'
import { hasContentType, sendsBody, withLogTag } from './request.js'

export const REQUEST_TIMEOUT_MS = 30000

// The headers editor's text as an object. Blank means no headers; throws
// (with the JSON error) when it doesn't parse.
export function parseHeaders(text) {
  return text.trim() ? JSON.parse(text) : {}
}

// The request as it is about to be sent, which becomes an immutable history
// entry once its response (or error) is attached.
export function snapshotRequest(req, logTag, ts = Date.now()) {
  const snapshot = {
    id: `${ts}-${Math.random().toString(36).slice(2, 7)}`,
    ts,
    method: req.method,
    url: req.url,
    sentUrl: withLogTag(req.url, logTag.trim()), // url plus apiLogTag, as actually fetched
    pagesKey: req.pagesKey,
    body: req.body,
    headers: req.headers,
    locked: false, // locked entries survive "clear all"
  }
  snapshot.summary = buildSummary(snapshot)
  return snapshot
}

// Fetch `snapshot` and return it as a history entry: with `resp` on any HTTP
// answer (errors included), or with `error` when there was none (network /
// CORS failure, timeout, cancel). Never throws. `signal` aborted with reason
// 'timeout' reads as a timeout, any other abort as a cancel.
export async function performRequest(snapshot, headers, { signal, timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const started = performance.now()
  try {
    const init = { method: snapshot.method, headers: { ...headers }, signal }
    if (sendsBody(snapshot.method, snapshot.body)) {
      init.body = snapshot.body
      if (!hasContentType(init.headers)) init.headers['Content-Type'] = 'application/json'
    }
    const r = await fetchImpl(snapshot.sentUrl, init)
    const text = await r.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    const resp = {
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      durationMs: Math.round(performance.now() - started),
      requestUrl: snapshot.sentUrl,
      headers: Object.fromEntries(r.headers.entries()),
      json,
      text: json == null ? text : undefined,
    }
    return { ...snapshot, resp, error: null }
  } catch (e) {
    const error = signal?.aborted
      ? signal.reason === 'timeout'
        ? `Timed out after ${timeoutMs / 1000}s`
        : 'Cancelled'
      : `${e?.message || e} (network/CORS error)`
    return { ...snapshot, resp: null, error }
  }
}
