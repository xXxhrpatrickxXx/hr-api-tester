import { describe, expect, it, vi } from 'vitest'
import { parseHeaders, performRequest, snapshotRequest } from './send.js'

const req = {
  method: 'POST',
  url: 'https://core.helloretail.com/serve/search',
  pagesKey: '',
  body: '{"query":"shoe"}',
  headers: '',
}

const response = (body, { status = 200, statusText = 'OK', headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText,
  headers: new Headers(headers),
  text: async () => body,
})

describe('parseHeaders', () => {
  it('reads JSON, and blank as no headers', () => {
    expect(parseHeaders('  ')).toEqual({})
    expect(parseHeaders('{"X-A":"1"}')).toEqual({ 'X-A': '1' })
  })

  it('throws on invalid JSON', () => {
    expect(() => parseHeaders('{nope')).toThrow()
  })
})

describe('snapshotRequest', () => {
  it('records the request, the URL actually sent and a summary', () => {
    const s = snapshotRequest(req, ' pl-test ', 1000)
    expect(s).toMatchObject({
      ts: 1000,
      method: 'POST',
      url: req.url,
      sentUrl: `${req.url}?apiLogTag=pl-test`,
      body: req.body,
      locked: false,
      summary: '“shoe”',
    })
    expect(s.id).toMatch(/^1000-/)
  })
})

describe('performRequest', () => {
  const snap = snapshotRequest(req, '', 1)

  it('sends the body as JSON and keeps the parsed response', async () => {
    const fetchImpl = vi.fn(async () => response('{"a":1}', { headers: { 'x-test': 'y' } }))
    const entry = await performRequest(snap, {}, { fetchImpl })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(snap.sentUrl)
    expect(init.body).toBe(req.body)
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(entry.error).toBeNull()
    expect(entry.resp).toMatchObject({ ok: true, status: 200, json: { a: 1 }, text: undefined })
    expect(entry.resp.headers['x-test']).toBe('y')
  })

  it('keeps an explicit content type and sends no body on GET', async () => {
    const fetchImpl = vi.fn(async () => response('{}'))
    await performRequest(snap, { 'content-type': 'text/plain' }, { fetchImpl })
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ 'content-type': 'text/plain' })
    await performRequest({ ...snap, method: 'GET' }, {}, { fetchImpl })
    expect(fetchImpl.mock.calls[1][1].body).toBeUndefined()
  })

  it('keeps non-JSON answers as text, error statuses included', async () => {
    const fetchImpl = async () => response('Bad gateway', { status: 502, statusText: 'Bad Gateway' })
    const entry = await performRequest(snap, {}, { fetchImpl })
    expect(entry.resp).toMatchObject({ ok: false, status: 502, json: null, text: 'Bad gateway' })
  })

  it('reports network failures, timeouts and cancels as errors', async () => {
    const fail = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect((await performRequest(snap, {}, { fetchImpl: fail })).error).toBe(
      'Failed to fetch (network/CORS error)',
    )

    const timedOut = new AbortController()
    timedOut.abort('timeout')
    const t = await performRequest(snap, {}, { fetchImpl: fail, signal: timedOut.signal, timeoutMs: 5000 })
    expect(t).toMatchObject({ resp: null, error: 'Timed out after 5s' })

    const cancelled = new AbortController()
    cancelled.abort()
    expect((await performRequest(snap, {}, { fetchImpl: fail, signal: cancelled.signal })).error).toBe(
      'Cancelled',
    )
  })
})
